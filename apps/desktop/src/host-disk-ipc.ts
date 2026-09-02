import { constants } from "node:fs";
import { mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain } from "electron";
import { createHostDiskGrantStore, type HostDiskGrantStore } from "./host-disk-grants.js";

/** Roots granted via the native folder picker. Renderer-supplied roots are ignored. */
let grantStore: HostDiskGrantStore | null = null;

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

function grants(): HostDiskGrantStore {
  if (!grantStore) throw new Error("Host disk IPC is not registered");
  return grantStore;
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
  const roots = grants().list();
  if (roots.length === 0) throw new Error("No host folders are granted");
  const realRoots: string[] = [];
  for (const root of roots) {
    realRoots.push(await realpath(root));
  }
  return realRoots;
}

async function resolveInsideGrants(target: string) {
  const roots = grants().list();
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

async function realpathOfFd(fd: number): Promise<string> {
  for (const candidate of [`/proc/self/fd/${fd}`, `/dev/fd/${fd}`]) {
    try {
      return await realpath(candidate);
    } catch {
      // Try the next platform path.
    }
  }
  throw new Error("Host path is outside the granted folders");
}

function fdDirPath(fd: number) {
  return process.platform === "linux" ? `/proc/self/fd/${fd}` : `/dev/fd/${fd}`;
}

/** Open + re-validate via fd realpath so a directory→symlink swap cannot escape. */
async function openInsideGrants(target: string, flags: number) {
  const realRoots = await realGrantedRoots();
  const resolved = await resolveInsideGrants(target);
  const handle = await open(resolved, flags | NOFOLLOW);
  try {
    await handle.stat();
    const fdReal = await realpathOfFd(handle.fd);
    if (!isLexicallyInside(fdReal, realRoots)) {
      throw new Error("Host path is outside the granted folders");
    }
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function mkdirInsideGrants(target: string) {
  const realRoots = await realGrantedRoots();
  const resolved = await resolveInsideGrants(target);
  if (realRoots.some((root) => root === resolved)) return resolved;

  const containingRoot = realRoots.find((root) => isLexicallyInside(resolved, [root]));
  if (!containingRoot) throw new Error("Host path is outside the granted folders");

  const relative = path.relative(containingRoot, resolved);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Host path is outside the granted folders");
  }

  const dirFlags = constants.O_RDONLY | (constants.O_DIRECTORY ?? 0);
  let parentHandle = await openInsideGrants(containingRoot, dirFlags);
  try {
    for (const segment of relative.split(path.sep)) {
      if (!segment || segment === "." || segment === "..") {
        throw new Error("Host path is outside the granted folders");
      }
      const childViaFd = path.join(fdDirPath(parentHandle.fd), segment);
      try {
        const next = await open(childViaFd, dirFlags | NOFOLLOW);
        await parentHandle.close().catch(() => undefined);
        parentHandle = next;
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code: unknown }).code)
            : "";
        if (code !== "ENOENT") throw error;
        await mkdir(childViaFd);
        const next = await open(childViaFd, dirFlags | NOFOLLOW);
        await parentHandle.close().catch(() => undefined);
        parentHandle = next;
      }
      const fdReal = await realpathOfFd(parentHandle.fd);
      if (!isLexicallyInside(fdReal, realRoots)) {
        throw new Error("Host path is outside the granted folders");
      }
    }
    return await realpathOfFd(parentHandle.fd);
  } finally {
    await parentHandle.close().catch(() => undefined);
  }
}

export function registerHostDiskIpc() {
  grantStore = createHostDiskGrantStore({
    grantsFilePath: path.join(app.getPath("userData"), "host-disk-grants.json"),
  });

  ipcMain.handle("desktop.hostDisk.pickFolder", async (event: IpcMainInvokeEvent) => {
    await grants().ready;
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
    return grants().add(chosen);
  });

  ipcMain.handle("desktop.hostDisk.revokeRoot", async (_event, root: unknown) => {
    await grants().ready;
    if (typeof root !== "string" || root.length === 0) return false;
    // Revoke records intent before/while load and always persists so a late load
    // cannot resurrect the folder.
    return grants().revoke(root);
  });

  ipcMain.handle("desktop.hostDisk.listGrantedRoots", async () => {
    await grants().ready;
    return grants().list();
  });

  ipcMain.handle("desktop.hostDisk.list", async (_event, requestPath: unknown) => {
    await grants().ready;
    const roots = grants().list();
    if (roots.length === 0) throw new Error("No host folders are granted");
    const trimmed = typeof requestPath === "string" ? requestPath.trim() : "";
    if (!trimmed) {
      return roots.map((root) => ({
        path: root,
        kind: "dir" as const,
        size: 0,
      }));
    }
    const realRoots = await realGrantedRoots();
    const dirFlags = constants.O_RDONLY | (constants.O_DIRECTORY ?? 0);
    const handle = await openInsideGrants(trimmed, dirFlags);
    try {
      const opened = await handle.stat();
      if (!opened.isDirectory()) throw new Error("Host path is outside the granted folders");
      const fdReal = await realpathOfFd(handle.fd);
      if (!isLexicallyInside(fdReal, realRoots)) {
        throw new Error("Host path is outside the granted folders");
      }
      const names = await readdir(fdDirPath(handle.fd));
      const listed: Array<{ path: string; kind: "file" | "dir"; size: number }> = [];
      for (const name of names) {
        if (name === "." || name === "..") continue;
        const full = path.join(fdReal, name);
        try {
          const entryHandle = await openInsideGrants(full, constants.O_RDONLY);
          try {
            const info = await entryHandle.stat();
            if (info.isDirectory()) {
              listed.push({ path: full, kind: "dir", size: 0 });
            } else if (info.isFile()) {
              listed.push({ path: full, kind: "file", size: info.size });
            }
          } finally {
            await entryHandle.close();
          }
        } catch {
          // Skip escaping, vanished, or symlink entries.
        }
      }
      return listed.sort((left, right) => left.path.localeCompare(right.path));
    } finally {
      await handle.close();
    }
  });

  ipcMain.handle(
    "desktop.hostDisk.read",
    async (_event, requestPath: unknown, maxBytes: unknown) => {
      await grants().ready;
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
      await grants().ready;
      if (typeof contentBase64 !== "string") throw new Error("Missing file content");
      const target = await resolveInsideGrants(String(requestPath ?? ""));
      await mkdirInsideGrants(path.dirname(target));

      const realRoots = await realGrantedRoots();
      const baseName = path.basename(target);
      if (!baseName || baseName === "." || baseName === "..") {
        throw new Error("Host path is outside the granted folders");
      }

      const parentPath = await resolveInsideGrants(path.dirname(target));
      const dirFlags = constants.O_RDONLY | (constants.O_DIRECTORY ?? 0);
      const parentHandle = await openInsideGrants(parentPath, dirFlags);
      const tempName = `.rakazo-host-disk-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
      let tempViaFd: string | undefined;
      let destViaFd: string | undefined;
      try {
        const parentFdReal = await realpathOfFd(parentHandle.fd);
        if (!isLexicallyInside(parentFdReal, realRoots)) {
          throw new Error("Host path is outside the granted folders");
        }

        tempViaFd = path.join(fdDirPath(parentHandle.fd), tempName);
        destViaFd = path.join(fdDirPath(parentHandle.fd), baseName);

        const tempHandle = await open(
          tempViaFd,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_TRUNC | NOFOLLOW,
        );
        try {
          const tempFdReal = await realpathOfFd(tempHandle.fd);
          if (!isLexicallyInside(tempFdReal, realRoots)) {
            throw new Error("Host path is outside the granted folders");
          }
          if (path.dirname(tempFdReal) !== parentFdReal) {
            throw new Error("Host path is outside the granted folders");
          }
          await tempHandle.writeFile(Buffer.from(contentBase64, "base64"));
        } finally {
          await tempHandle.close();
        }

        await rename(tempViaFd, destViaFd);
        tempViaFd = undefined;

        const finalHandle = await open(destViaFd, constants.O_RDONLY | NOFOLLOW);
        try {
          const fdReal = await realpathOfFd(finalHandle.fd);
          if (!isLexicallyInside(fdReal, realRoots)) {
            await rm(destViaFd, { force: true }).catch(() => undefined);
            throw new Error("Host path is outside the granted folders");
          }
          if (path.dirname(fdReal) !== parentFdReal) {
            await rm(destViaFd, { force: true }).catch(() => undefined);
            throw new Error("Host path is outside the granted folders");
          }
        } finally {
          await finalHandle.close().catch(() => undefined);
        }
      } catch (error) {
        if (tempViaFd) await rm(tempViaFd, { force: true }).catch(() => undefined);
        throw error;
      } finally {
        await parentHandle.close().catch(() => undefined);
      }
      return true;
    },
  );
}
