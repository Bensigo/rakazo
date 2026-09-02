import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHostDiskGrantStore } from "./host-disk-grants.js";

const dirs: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
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
    await writeFile(grantsFilePath, `${JSON.stringify([granted], null, 2)}\n`, "utf8");

    // Start load without awaiting; revoke records intent first then waits on ready.
    const store = createHostDiskGrantStore({ grantsFilePath });
    await expect(store.revoke(granted)).resolves.toBe(true);
    await store.ready;
    expect(store.list()).not.toContain(path.resolve(granted));

    const persisted = JSON.parse(await readFile(grantsFilePath, "utf8")) as string[];
    expect(persisted.map((item) => path.resolve(item))).not.toContain(path.resolve(granted));
  });

  it("always persists revoke even when the root was not yet in memory", async () => {
    const dir = await tempDir();
    const grantsFilePath = path.join(dir, "host-disk-grants.json");
    const granted = path.join(dir, "Projects");
    await writeFile(grantsFilePath, `${JSON.stringify([granted], null, 2)}\n`, "utf8");

    const store = createHostDiskGrantStore({ grantsFilePath });
    await store.revoke(granted);
    expect(store.list()).toEqual([]);
    const persisted = JSON.parse(await readFile(grantsFilePath, "utf8")) as string[];
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
});
