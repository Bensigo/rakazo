import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHostDiskGrantStore } from "./host-disk-grants.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "rakazo-host-grants-"));
  dirs.push(dir);
  return dir;
}

describe("host disk grant store", () => {
  it("does not resurrect a root revoked while the grants file is still loading", async () => {
    const dir = await tempDir();
    const grantsFilePath = path.join(dir, "host-disk-grants.json");
    const granted = path.join(dir, "Documents");
    await mkdir(granted);
    await writeFile(grantsFilePath, `${JSON.stringify([granted], null, 2)}\n`, "utf8");

    // Start load without awaiting; revoke records intent first then waits on ready.
    const store = createHostDiskGrantStore({ grantsFilePath });
    await expect(store.revoke(granted)).resolves.toBe(true);
    await store.ready;
    expect(store.list()).not.toContain(path.resolve(granted));

    const persisted = JSON.parse(await readFile(grantsFilePath, "utf8")) as unknown[];
    expect(persisted).toEqual([]);
  });

  it("always persists revoke even when the root was not yet in memory", async () => {
    const dir = await tempDir();
    const grantsFilePath = path.join(dir, "host-disk-grants.json");
    const granted = path.join(dir, "Projects");
    await mkdir(granted);
    await writeFile(grantsFilePath, `${JSON.stringify([granted], null, 2)}\n`, "utf8");

    const store = createHostDiskGrantStore({ grantsFilePath });
    await store.revoke(granted);
    expect(store.list()).toEqual([]);
    const persisted = JSON.parse(await readFile(grantsFilePath, "utf8")) as unknown[];
    expect(persisted).toEqual([]);
  });

  it("returns false when revoking a path that was never granted", async () => {
    const dir = await tempDir();
    const grantsFilePath = path.join(dir, "host-disk-grants.json");
    await writeFile(grantsFilePath, `${JSON.stringify([], null, 2)}\n`, "utf8");

    const store = createHostDiskGrantStore({ grantsFilePath });
    await store.ready;
    await expect(store.revoke(path.join(dir, "never-granted"))).resolves.toBe(false);
  });

  it("serializes concurrent add/revoke so disk matches the final in-memory set", async () => {
    const dir = await tempDir();
    const grantsFilePath = path.join(dir, "host-disk-grants.json");
    const granted = path.join(dir, "Workspace");
    await mkdir(granted);

    const store = createHostDiskGrantStore({ grantsFilePath });
    await store.ready;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await store.add(granted);
      await Promise.all([store.add(granted), store.revoke(granted)]);
      const persisted = JSON.parse(await readFile(grantsFilePath, "utf8")) as Array<{
        path: string;
      }>;
      const listed = store.list();
      expect(persisted.map((entry) => path.resolve(entry.path)).sort()).toEqual([...listed].sort());
    }
  });

  it("does not authorize a grant pathname replaced by a symlink to an ungranted folder", async () => {
    const dir = await tempDir();
    const grantsFilePath = path.join(dir, "host-disk-grants.json");
    const granted = path.join(dir, "Granted");
    const outside = path.join(dir, "Outside");
    await mkdir(granted);
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "nope\n", "utf8");

    const store = createHostDiskGrantStore({ grantsFilePath });
    await store.ready;
    const added = await store.add(granted);
    const { realpath } = await import("node:fs/promises");
    expect(await store.authorizedRealRoots()).toEqual([await realpath(granted)]);
    expect(store.list()).toEqual([added]);

    const backup = path.join(dir, "Granted-original");
    await rename(granted, backup);
    await symlink(outside, granted);

    // Pathname remains listed, but authorization must not follow the symlink.
    expect(store.list()).toEqual([added]);
    expect(await store.authorizedRealRoots()).toEqual([]);
  });

  it("does not let a mid-check root pathname swap poison authorizedRealRoots", async () => {
    // After the grant fd identity is verified, replacing the pathname with a
    // symlink to an outside directory must not make that outside path an
    // authorized root. The allowlist path comes from the open fd.
    const dir = await tempDir();
    const grantsFilePath = path.join(dir, "host-disk-grants.json");
    const granted = path.join(dir, "Granted");
    const outside = path.join(dir, "Outside");
    await mkdir(granted);
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "nope\n", "utf8");

    const backup = path.join(dir, "Granted-original");
    const store = createHostDiskGrantStore({
      grantsFilePath,
      afterAuthorizedIdentityVerified: async () => {
        await rename(granted, backup);
        await symlink(outside, granted);
      },
    });
    await store.ready;
    await store.add(granted);

    const { realpath } = await import("node:fs/promises");
    const roots = await store.authorizedRealRoots();
    expect(roots).toEqual([await realpath(backup)]);
    expect(roots).not.toContain(await realpath(outside));
  });
});
