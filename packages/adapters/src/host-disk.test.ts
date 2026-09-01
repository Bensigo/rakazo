import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { builtinAgentTools } from "./builtin-tools.js";
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
});
