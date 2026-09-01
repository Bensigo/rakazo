import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, dialog, type IpcMainInvokeEvent, ipcMain } from "electron";

function isInsideRoots(target: string, roots: string[]) {
  const resolved = path.resolve(target);
  return roots.some((root) => {
    const relative = path.relative(path.resolve(root), resolved);
    return (
      relative === "" ||
      (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  });
}

function assertInside(target: unknown, roots: unknown) {
  const allowed = Array.isArray(roots)
    ? roots.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
  if (allowed.length === 0) throw new Error("No host folders are granted");
  const pathText = typeof target === "string" ? target : "";
  const resolved = path.resolve(pathText);
  if (!isInsideRoots(resolved, allowed)) {
    throw new Error("Host path is outside the granted folders");
  }
  return { resolved, roots: allowed.map((root) => path.resolve(root)) };
}

export function registerHostDiskIpc() {
  ipcMain.handle("desktop.hostDisk.pickFolder", async (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("desktop.hostDisk.list", async (_event, requestPath: unknown, roots: unknown) => {
    const allowedRoots = Array.isArray(roots)
      ? roots.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
    if (allowedRoots.length === 0) throw new Error("No host folders are granted");
    const trimmed = typeof requestPath === "string" ? requestPath.trim() : "";
    if (!trimmed) {
      return allowedRoots.map((root) => ({
        path: path.resolve(root),
        kind: "dir" as const,
        size: 0,
      }));
    }
    const { resolved } = assertInside(trimmed, allowedRoots);
    const entries = await readdir(resolved, { withFileTypes: true });
    const listed: Array<{ path: string; kind: "file" | "dir"; size: number }> = [];
    for (const entry of entries) {
      const full = path.join(resolved, entry.name);
      if (
        !isInsideRoots(
          full,
          allowedRoots.map((root) => path.resolve(root)),
        )
      ) {
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
    async (_event, requestPath: unknown, roots: unknown, maxBytes: unknown) => {
      const { resolved } = assertInside(requestPath, roots);
      const info = await stat(resolved);
      if (!info.isFile()) throw new Error("Host path is not a file");
      if (typeof maxBytes === "number" && info.size > maxBytes) {
        throw new Error(`file exceeds ${maxBytes} bytes`);
      }
      const bytes = await readFile(resolved);
      return bytes.toString("base64");
    },
  );

  ipcMain.handle(
    "desktop.hostDisk.write",
    async (_event, requestPath: unknown, contentBase64: unknown, roots: unknown) => {
      const { resolved, roots: allowed } = assertInside(requestPath, roots);
      if (typeof contentBase64 !== "string") throw new Error("Missing file content");
      await mkdir(path.dirname(resolved), { recursive: true });
      if (!isInsideRoots(resolved, allowed)) {
        throw new Error("Host path is outside the granted folders");
      }
      await writeFile(resolved, Buffer.from(contentBase64, "base64"));
      return true;
    },
  );
}
