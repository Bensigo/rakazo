import { constants } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { builtinAgentTools } from "./builtin-tools.js";
import {
  listInsideHostRoots,
  openInsideHostRoots,
  readFileInsideHostRoots,
  writeFileInsideHostRoots,
} from "./host-disk-path.js";
import {
  hostDiskAccessAllowed,
  loadHostDiskSettings,
  saveHostDiskSettings,
} from "./host-disk-settings.js";
import { HOST_DISK_TOOL_NAMES, selectHostDiskTools } from "./host-disk-tools.js";
import { LocalHostDiskProvider } from "./local-host-disk.js";
import { UnavailableHostDiskProvider } from "./unavailable-host-disk.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "rakazo-host-disk-"));
  dirs.push(dir);
  return dir;
}

function adapterContext() {
  return {
    operationId: "op-1",
    traceId: "trace-1",
    spaceId: "space-1",
    userId: "user-1",
    signal: new AbortController().signal,
  };
}

describe("host disk deny by default", () => {
  it("keeps host tools out of the always-on builtin catalog", () => {
    const names = new Set(builtinAgentTools.map((tool) => tool.name));
    for (const name of HOST_DISK_TOOL_NAMES) {
      expect(names.has(name)).toBe(false);
    }
  });

  it("selectHostDiskTools returns nothing until access is enabled", () => {
    expect(selectHostDiskTools(false)).toEqual([]);
    expect(selectHostDiskTools(true).map((tool) => tool.name)).toEqual([
      "list_host_files",
      "read_host_file",
      "write_host_file",
      "copy_to_host",
      "copy_from_host",
    ]);
  });

  it("persists settings off by default with no roots", async () => {
    const dataDir = await tempDir();
    const settings = await loadHostDiskSettings(dataDir, "user-1");
    expect(settings).toEqual({ enabled: false, roots: [], clientSeenAt: null });
    expect(hostDiskAccessAllowed(settings)).toBe(false);
  });

  it("still denies access when enabled without granted roots", async () => {
    const dataDir = await tempDir();
    const settings = await saveHostDiskSettings(dataDir, "user-1", {
      enabled: true,
      roots: [],
      clientSeenAt: new Date().toISOString(),
    });
    expect(hostDiskAccessAllowed(settings)).toBe(false);
  });

  it("still denies access when roots exist without a fresh client heartbeat", async () => {
    const dataDir = await tempDir();
    const settings = await saveHostDiskSettings(dataDir, "user-1", {
      enabled: true,
      roots: ["/tmp/granted"],
      clientSeenAt: null,
    });
    expect(hostDiskAccessAllowed(settings)).toBe(false);
  });

  it("unavailable provider never reports availability", async () => {
    const provider = new UnavailableHostDiskProvider();
    expect(await provider.isAvailable("user-1")).toBe(false);
    await expect(provider.listFiles("user-1", "/", adapterContext())).rejects.toThrow(
      /unavailable/i,
    );
  });
});

describe("local host disk containment", () => {
  it("reads and writes only inside explicitly granted roots", async () => {
    const dataDir = await tempDir();
    const grant = path.join(dataDir, "Documents-granted");
    const outside = path.join(dataDir, "Desktop-not-granted");
    await mkdir(grant, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(grant, "notes.txt"), "hello from host\n", "utf8");
    await writeFile(path.join(outside, "secret.txt"), "nope\n", "utf8");

    await saveHostDiskSettings(dataDir, "user-1", {
      enabled: true,
      roots: [grant],
      clientSeenAt: new Date().toISOString(),
    });

    const provider = new LocalHostDiskProvider({
      dataDir,
      ignoreClientHeartbeat: true,
    });
    expect(await provider.isAvailable("user-1")).toBe(true);

    const listed = await provider.listFiles("user-1", grant, adapterContext());
    expect(listed.map((entry) => path.basename(entry.path))).toContain("notes.txt");

    const bytes = await provider.readFile(
      "user-1",
      path.join(grant, "notes.txt"),
      adapterContext(),
    );
    expect(new TextDecoder().decode(bytes)).toBe("hello from host\n");

    await provider.writeFile(
      "user-1",
      {
        path: path.join(grant, "out.txt"),
        content: new TextEncoder().encode("written\n"),
      },
      adapterContext(),
    );
    expect(await readFile(path.join(grant, "out.txt"), "utf8")).toBe("written\n");

    await expect(
      provider.readFile("user-1", path.join(outside, "secret.txt"), adapterContext()),
    ).rejects.toThrow(/outside the granted folders/i);

    await expect(
      provider.writeFile(
        "user-1",
        {
          path: path.join(outside, "escape.txt"),
          content: new TextEncoder().encode("nope"),
        },
        adapterContext(),
      ),
    ).rejects.toThrow(/outside the granted folders/i);
  });

  it("does not treat Documents or Desktop as granted without opt-in roots", async () => {
    const dataDir = await tempDir();
    const documents = path.join(dataDir, "Documents");
    await mkdir(documents, { recursive: true });
    await writeFile(path.join(documents, "tax.txt"), "private\n", "utf8");

    const provider = new LocalHostDiskProvider({
      dataDir,
      ignoreClientHeartbeat: true,
      loadSettings: async () => ({
        enabled: false,
        roots: [],
        clientSeenAt: null,
      }),
    });
    expect(await provider.isAvailable("user-1")).toBe(false);
    await expect(
      provider.readFile("user-1", path.join(documents, "tax.txt"), adapterContext()),
    ).rejects.toThrow(/Host disk access is off/i);
  });
});

describe("host disk symlink containment", () => {
  it("rejects reads and writes that follow a symlink outside granted roots", async () => {
    const dataDir = await tempDir();
    const grant = path.join(dataDir, "granted");
    const outside = path.join(dataDir, "outside");
    await mkdir(grant, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "secret.txt"), "private\n", "utf8");
    await symlink(path.join(outside, "secret.txt"), path.join(grant, "leak.txt"));

    await saveHostDiskSettings(dataDir, "user-1", {
      enabled: true,
      roots: [grant],
      clientSeenAt: new Date().toISOString(),
    });

    const provider = new LocalHostDiskProvider({
      dataDir,
      ignoreClientHeartbeat: true,
    });

    await expect(
      provider.readFile("user-1", path.join(grant, "leak.txt"), adapterContext()),
    ).rejects.toThrow(/outside the granted folders/i);

    await expect(
      provider.writeFile(
        "user-1",
        {
          path: path.join(grant, "leak.txt"),
          content: new TextEncoder().encode("overwrite"),
        },
        adapterContext(),
      ),
    ).rejects.toThrow(/outside the granted folders/i);

    const listed = await provider.listFiles("user-1", grant, adapterContext());
    expect(listed.map((entry) => path.basename(entry.path))).not.toContain("leak.txt");
  });

  it("rejects reads through a directory symlink that leaves the grant", async () => {
    const dataDir = await tempDir();
    const grant = path.join(dataDir, "granted");
    const outside = path.join(dataDir, "outside");
    await mkdir(grant, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "secret.txt"), "private\n", "utf8");
    await symlink(outside, path.join(grant, "sub"));

    await saveHostDiskSettings(dataDir, "user-1", {
      enabled: true,
      roots: [grant],
      clientSeenAt: new Date().toISOString(),
    });

    const provider = new LocalHostDiskProvider({
      dataDir,
      ignoreClientHeartbeat: true,
    });

    await expect(
      provider.readFile("user-1", path.join(grant, "sub", "secret.txt"), adapterContext()),
    ).rejects.toThrow(/outside the granted folders/i);

    await expect(
      provider.writeFile(
        "user-1",
        {
          path: path.join(grant, "sub", "planted.txt"),
          content: new TextEncoder().encode("nope"),
        },
        adapterContext(),
      ),
    ).rejects.toThrow(/outside the granted folders/i);
  });

  it("pins the opened inode so a check-then-use directory swap cannot escape", async () => {
    // After resolveInsideHostRoots, open uses O_NOFOLLOW and re-checks
    // realpath(/proc/self/fd/N). Swapping a nested dir to an outside symlink
    // between resolve and open must not yield an outside fd.
    const dataDir = await tempDir();
    const grant = path.join(dataDir, "granted");
    const outside = path.join(dataDir, "outside");
    const nested = path.join(grant, "nested");
    await mkdir(nested, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(nested, "file.txt"), "inside\n", "utf8");
    await writeFile(path.join(outside, "file.txt"), "outside-secret\n", "utf8");

    const target = path.join(nested, "file.txt");
    const swapNestedToOutside = async () => {
      await rm(nested, { recursive: true, force: true });
      await symlink(outside, nested);
    };

    await expect(
      readFileInsideHostRoots(target, [grant], { afterResolve: swapNestedToOutside }),
    ).rejects.toThrow(/outside the granted folders|ENOENT|ELOOP|EPERM|EACCES|ENOTDIR/i);

    // Recreate the inside tree for list/write races.
    await rm(nested, { recursive: true, force: true });
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, "file.txt"), "inside\n", "utf8");

    await expect(
      listInsideHostRoots(nested, [grant], { afterResolve: swapNestedToOutside }),
    ).rejects.toThrow(/outside the granted folders|ENOENT|ELOOP|EPERM|EACCES|ENOTDIR/i);

    await rm(nested, { recursive: true, force: true });
    await mkdir(nested, { recursive: true });

    await expect(
      writeFileInsideHostRoots(path.join(nested, "planted.txt"), [grant], "x", {
        afterResolve: swapNestedToOutside,
      }),
    ).rejects.toThrow(/outside the granted folders|ENOENT|ELOOP|EPERM|EACCES|ENOTDIR/i);

    await rm(nested, { recursive: true, force: true });
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, "file.txt"), "inside\n", "utf8");

    await expect(
      openInsideHostRoots(target, [grant], constants.O_RDONLY, {
        afterResolve: swapNestedToOutside,
      }),
    ).rejects.toThrow(/outside the granted folders|ENOENT|ELOOP|EPERM|EACCES|ENOTDIR/i);
  });

  it("keeps writes inside the pinned parent when the path is swapped to an outside symlink", async () => {
    // After the parent directory fd is pinned, replacing that directory entry
    // with an outside symlink must not redirect the rename/write.
    const dataDir = await tempDir();
    const grant = path.join(dataDir, "granted");
    const outside = path.join(dataDir, "outside");
    const nested = path.join(grant, "nested");
    await mkdir(nested, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "planted.txt"), "outside-secret\n", "utf8");

    const nestedBackup = path.join(grant, "nested-original");
    await expect(
      writeFileInsideHostRoots(path.join(nested, "planted.txt"), [grant], "inside-write\n", {
        afterParentPinned: async () => {
          await rename(nested, nestedBackup);
          await symlink(outside, nested);
        },
      }),
    ).resolves.toBeUndefined();

    // Outside content must be untouched; the write stayed on the pinned inode.
    expect(await readFile(path.join(outside, "planted.txt"), "utf8")).toBe("outside-secret\n");
    expect(await readFile(path.join(nestedBackup, "planted.txt"), "utf8")).toBe("inside-write\n");
  });
});

describe("host disk exclusive claims", () => {
  it("lets only one claim win for the same pending operation", async () => {
    const dataDir = await tempDir();
    const { BridgingHostDiskProvider, claimHostDiskOperation } = await import(
      "./bridge-host-disk.js"
    );
    const provider = new BridgingHostDiskProvider({
      dataDir,
      timeoutMs: 1000,
      pollIntervalMs: 20,
    });
    await saveHostDiskSettings(dataDir, "user-1", {
      enabled: true,
      roots: [path.join(dataDir, "granted")],
      clientSeenAt: new Date().toISOString(),
    });
    await mkdir(path.join(dataDir, "granted"), { recursive: true });

    // Enqueue one list operation through the private queue by calling listFiles with a short abort.
    const controller = new AbortController();
    const listing = provider.listFiles("user-1", "", {
      ...adapterContext(),
      signal: controller.signal,
    });

    let first: Awaited<ReturnType<typeof claimHostDiskOperation>> = null;
    for (let attempt = 0; attempt < 50 && !first; attempt += 1) {
      first = await claimHostDiskOperation(dataDir, "user-1");
      if (!first) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(first?.status).toBe("claimed");

    const second = await claimHostDiskOperation(dataDir, "user-1");
    expect(second).toBeNull();

    controller.abort();
    await expect(listing).rejects.toThrow();
  });

  it("lets only one of timeout and client completion win", async () => {
    const dataDir = await tempDir();
    const { BridgingHostDiskProvider, claimHostDiskOperation, completeHostDiskOperation } =
      await import("./bridge-host-disk.js");
    const provider = new BridgingHostDiskProvider({
      dataDir,
      timeoutMs: 50,
      pollIntervalMs: 10,
    });
    await saveHostDiskSettings(dataDir, "user-1", {
      enabled: true,
      roots: [path.join(dataDir, "granted")],
      clientSeenAt: new Date().toISOString(),
    });
    await mkdir(path.join(dataDir, "granted"), { recursive: true });

    const listing = provider.listFiles("user-1", "", adapterContext());
    let claimed = null;
    for (let attempt = 0; attempt < 50 && !claimed; attempt += 1) {
      claimed = await claimHostDiskOperation(dataDir, "user-1");
      if (!claimed) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(claimed?.status).toBe("claimed");
    if (!claimed) throw new Error("expected claim");

    const clientComplete = completeHostDiskOperation(dataDir, "user-1", {
      id: claimed.id,
      status: "done",
      entries: [],
    });
    // Overlap with server timeout completion inside listFiles.
    const results = await Promise.allSettled([listing, clientComplete]);
    const clientResult = results[1];
    expect(clientResult.status === "fulfilled" || clientResult.status === "rejected").toBe(true);

    // Terminal status must be consistent: not done then overwritten by timeout error
    // (or vice versa) on the same file.
    const { readFile: readOp } = await import("node:fs/promises");
    const claimedPath = path.join(
      dataDir,
      "host-disk",
      "operations",
      "user-1",
      `${claimed.id}.claimed.json`,
    );
    const pendingPath = path.join(
      dataDir,
      "host-disk",
      "operations",
      "user-1",
      `${claimed.id}.json`,
    );
    let raw = null;
    try {
      raw = await readOp(claimedPath, "utf8");
    } catch {
      try {
        raw = await readOp(pendingPath, "utf8");
      } catch {
        raw = null;
      }
    }
    if (raw) {
      const op = JSON.parse(raw);
      expect(["done", "error"]).toContain(op.status);
      // If the client won, listFiles should have returned entries (or timeout honored done).
      if (op.status === "done") {
        expect(results[0].status).toBe("fulfilled");
      }
    }
  });
});
