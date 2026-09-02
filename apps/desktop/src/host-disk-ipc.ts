import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain } from "electron";

/** Roots granted via the native folder picker. Renderer-supplied roots are ignored. */
const grantedRoots = new Set<string>();

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

function grantsFilePath() {
  return path.join(app.getPath("userData"), "host-disk-grants.json");
}

async function loadGrantedRoots() {
  try {
    const raw = JSON.parse(await readFile(grantsFilePath(), "utf8")) as unknown;
    if (!Array.isArray(raw)) return;
    for (const item of raw) {
      if (typeof item === "string" && item.length > 0) {
        grantedRoots.add(path.resolve(item));
      }
    }
  } catch {
    // First run or unreadable file: start with an empty grant set.
  }
}

async function saveGrantedRoots() {
  await mkdir(path.dirname(grantsFilePath()), { recursive: true });
  await writeFile(grantsFilePath(), `${JSON.stringify([...grantedRoots], null, 2)}\n`, "utf8");
}

function isLexicallyInside(target: string, roots: string[]) {
  const resolved = path.resolve(target);
  return roots.some((root) => {
    const relative = path.relative(path.resolve(root), resolved);
    return (
      relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  });
}

async function realGrantedRoots() {
  const roots = [...grantedRoots];
  if (roots.length === 0) throw new Error("No host folders are granted");
  const realRoots: string[] = [];
  for (const root of roots) {
    realRoots.push(await realpath(root));
  }
  return realRoots;
}

async function resolveInsideGrants(target: string) {
  const roots = [...grantedRoots];
  if (roots.length === 0) throw new Error("No host folders are granted");
  const lexicalTarget = path.resolve(typeof target === "string" ? target : "");
  if (!isLexicallyInside(lexicalTarget, roots)) {
    throw new Error("Host path is outside the granted folders");
  }

  const realRoots = await realGrantedRoots();

  let probe = lexicalTarget;
  for (;;) {
    try {
      const real = await realpath(probe);
      if (!isLexicallyInside(real, realRoots)) {
        throw new Error("Host path is outside the granted folders");
      }
      if (probe === lexicalTarget) return real;
      const rest = path.relative(probe, lexicalTarget);
      if (
        rest === "" ||
        rest === ".." ||
        rest.startsWith(`..${path.sep}`) ||
        path.isAbsolute(rest)
      ) {
        throw new Error("Host path is outside the granted folders");
      }
      const finalPath = path.join(real, rest);
      if (!isLexicallyInside(finalPath, realRoots)) {
        throw new Error("Host path is outside the granted folders");
      }
      return finalPath;
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      if (code !== "ENOENT") {
        if (error instanceof Error && /outside the granted folders/i.test(error.message)) {
          throw error;
        }
        throw error;
      }
      const parent = path.dirname(probe);
      if (parent === probe) {
        throw new Error("Host path is outside the granted folders");
      }
      probe = parent;
    }
  }
}

/** Open + re-validate so a directory→symlink swap cannot escape after resolve. */
async function openInsideGrants(target: string, flags: number) {
  const realRoots = await realGrantedRoots();
  const resolved = await resolveInsideGrants(target);
  const handle = await open(resolved, flags | NOFOLLOW);
  try {
    const opened = await handle.stat();
    const again = await realpath(resolved);
    if (!isLexicallyInside(again, realRoots)) {
      throw new Error("Host path is outside the granted folders");
    }
    const againStat = await lstat(again);
    if (againStat.isSymbolicLink()) {
      throw new Error("Host path is outside the granted folders");
    }
    if (opened.dev !== againStat.dev || opened.ino !== againStat.ino) {
      throw new Error("Host path is outside the granted folders");
    }
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

export function registerHostDiskIpc() {
  void loadGrantedRoots();

  ipcMain.handle("desktop.hostDisk.pickFolder", async (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    const chosen = result.filePaths[0];
    if (!chosen) return null;
    const resolved = await realpath(path.resolve(chosen));
    grantedRoots.add(resolved);
    await saveGrantedRoots();
    return resolved;
  });

  ipcMain.handle("desktop.hostDisk.revokeRoot", async (_event, root: unknown) => {
    if (typeof root !== "string" || root.length === 0) return false;
    const resolved = path.resolve(root);
    let removed = grantedRoots.delete(resolved);
    try {
      removed = grantedRoots.delete(await realpath(resolved)) || removed;
    } catch {
      // Root may already be gone from disk.
    }
    if (removed) await saveGrantedRoots();
    return removed;
  });

  ipcMain.handle("desktop.hostDisk.listGrantedRoots", async () => {
    return [...grantedRoots].sort((left, right) => left.localeCompare(right));
  });

  ipcMain.handle("desktop.hostDisk.list", async (_event, requestPath: unknown) => {
    const roots = [...grantedRoots];
    if (roots.length === 0) throw new Error("No host folders are granted");
    const trimmed = typeof requestPath === "string" ? requestPath.trim() : "";
    if (!trimmed) {
      return roots.map((root) => ({
        path: root,
        kind: "dir" as const,
        size: 0,
      }));
    }
    const resolved = await resolveInsideGrants(trimmed);
    const entries = await readdir(resolved, { withFileTypes: true });
    const listed: Array<{ path: string; kind: "file" | "dir"; size: number }> = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(resolved, entry.name);
      try {
        await resolveInsideGrants(full);
      } catch {
        continue;
      }
      if (entry.isDirectory()) {
        listed.push({ path: full, kind: "dir", size: 0 });
      } else if (entry.isFile()) {
        const info = await stat(full);
        listed.push({ path: full, kind: "file", size: info.size });
      }
    }
    return listed.sort((left, right) => left.path.localeCompare(right.path));
  });

  ipcMain.handle(
    "desktop.hostDisk.read",
    async (_event, requestPath: unknown, maxBytes: unknown) => {
      const handle = await openInsideGrants(String(requestPath ?? ""), constants.O_RDONLY);
      try {
        const info = await handle.stat();
        if (!info.isFile()) throw new Error("Host path is not a file");
        if (typeof maxBytes === "number" && info.size > maxBytes) {
          throw new Error(`file exceeds ${maxBytes} bytes`);
        }
        const bytes = await handle.readFile();
        return bytes.toString("base64");
      } finally {
        await handle.close();
      }
    },
  );

  ipcMain.handle(
    "desktop.hostDisk.write",
    async (_event, requestPath: unknown, contentBase64: unknown) => {
      if (typeof contentBase64 !== "string") throw new Error("Missing file content");
      const target = await resolveInsideGrants(String(requestPath ?? ""));
      await mkdir(path.dirname(target), { recursive: true });
      const parent = await resolveInsideGrants(path.dirname(target));
      const tempPath = path.join(
        parent,
        `.rakazo-host-disk-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
      );
      try {
        const tempHandle = await openInsideGrants(
          tempPath,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_TRUNC,
        );
        try {
          await tempHandle.writeFile(Buffer.from(contentBase64, "base64"));
        } finally {
          await tempHandle.close();
        }
        const destination = await resolveInsideGrants(target);
        await rename(tempPath, destination);
        const realRoots = await realGrantedRoots();
        const finalReal = await realpath(destination);
        if (!isLexicallyInside(finalReal, realRoots)) {
          await rm(destination, { force: true }).catch(() => undefined);
          throw new Error("Host path is outside the granted folders");
        }
        const finalStat = await lstat(destination);
        if (finalStat.isSymbolicLink()) {
          await rm(destination, { force: true }).catch(() => undefined);
          throw new Error("Host path is outside the granted folders");
        }
      } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
      return true;
    },
  );
}
