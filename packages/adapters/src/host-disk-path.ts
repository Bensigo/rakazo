import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";

type PathOperations = Pick<typeof path, "isAbsolute" | "relative" | "resolve" | "sep">;

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

/** Lexical containment (no symlink resolution). */
export function isLexicallyInsideRoots(
  target: string,
  roots: string[],
  pathOperations: PathOperations = path,
) {
  const resolved = pathOperations.resolve(target);
  return roots.some((root) => {
    const relative = pathOperations.relative(pathOperations.resolve(root), resolved);
    return (
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith(`..${pathOperations.sep}`) &&
        !pathOperations.isAbsolute(relative))
    );
  });
}

async function realRootsOf(roots: string[]) {
  if (roots.length === 0) throw new Error("Host path is outside the granted folders");
  const realRoots: string[] = [];
  for (const root of roots.map((item) => path.resolve(item))) {
    try {
      realRoots.push(await realpath(root));
    } catch {
      throw new Error("Host path is outside the granted folders");
    }
  }
  return realRoots;
}

/**
 * Resolve a host path and require it to stay inside granted roots after
 * symlink resolution. For new paths, the nearest existing ancestor must be
 * inside a granted root and the remainder must not escape.
 */
export async function resolveInsideHostRoots(target: string, roots: string[]): Promise<string> {
  const lexicalRoots = roots.map((root) => path.resolve(root));
  const lexicalTarget = path.resolve(target);
  if (!isLexicallyInsideRoots(lexicalTarget, lexicalRoots)) {
    throw new Error("Host path is outside the granted folders");
  }

  const realRoots = await realRootsOf(roots);

  let probe = lexicalTarget;
  for (;;) {
    try {
      const real = await realpath(probe);
      if (!isLexicallyInsideRoots(real, realRoots)) {
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
      if (!isLexicallyInsideRoots(finalPath, realRoots)) {
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

/** True when a directory entry is a symlink whose real path leaves the roots. */
export async function hostEntryEscapesRoots(entryPath: string, roots: string[]) {
  try {
    const info = await lstat(entryPath);
    if (!info.isSymbolicLink()) {
      await resolveInsideHostRoots(entryPath, roots);
      return false;
    }
    await resolveInsideHostRoots(entryPath, roots);
    return false;
  } catch {
    return true;
  }
}

/** Real path of an open fd (Linux /proc, macOS /dev/fd). */
export async function realpathOfFd(fd: number): Promise<string> {
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
  // Prefer Linux; fall back for macOS Electron. Same inode as the open dir fd.
  return process.platform === "linux" ? `/proc/self/fd/${fd}` : `/dev/fd/${fd}`;
}

export type OpenInsideHostRootsOptions = {
  /** Test-only: run after resolve and before open (path-swap race). */
  afterResolve?: () => Promise<void>;
};

/**
 * Open a path only if it stays inside granted roots, pinning the fd against
 * symlink path swaps between resolve and open (re-validate via fd realpath).
 */
export async function openInsideHostRoots(
  target: string,
  roots: string[],
  flags: number,
  options?: OpenInsideHostRootsOptions,
) {
  const realRoots = await realRootsOf(roots);
  const resolved = await resolveInsideHostRoots(target, roots);
  if (options?.afterResolve) await options.afterResolve();
  // Open the validated realpath with O_NOFOLLOW so the final component cannot
  // be a symlink. Intermediate swaps are caught by the fd realpath check.
  const handle = await open(resolved, flags | NOFOLLOW);
  try {
    await handle.stat();
    const fdReal = await realpathOfFd(handle.fd);
    if (!isLexicallyInsideRoots(fdReal, realRoots)) {
      throw new Error("Host path is outside the granted folders");
    }
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

export async function readFileInsideHostRoots(
  target: string,
  roots: string[],
  options?: { maxBytes?: number; afterResolve?: () => Promise<void> },
) {
  const handle = await openInsideHostRoots(target, roots, constants.O_RDONLY, {
    afterResolve: options?.afterResolve,
  });
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Host path is not a file");
    if (options?.maxBytes !== undefined && info.size > options.maxBytes) {
      throw new Error(`file exceeds ${options.maxBytes} bytes`);
    }
    return new Uint8Array(await handle.readFile());
  } finally {
    await handle.close();
  }
}

/**
 * List a directory inside granted roots. The directory is opened with
 * O_NOFOLLOW and re-validated via fd realpath; entries are listed through
 * the pinned fd (not the original path string) and each entry is opened
 * the same way so a swapped symlink cannot be followed for type/size.
 */
export async function listInsideHostRoots(
  target: string,
  roots: string[],
  options?: OpenInsideHostRootsOptions,
) {
  const realRoots = await realRootsOf(roots);
  const dirFlags = constants.O_RDONLY | (constants.O_DIRECTORY ?? 0);
  const handle = await openInsideHostRoots(target, roots, dirFlags, options);
  try {
    const opened = await handle.stat();
    if (!opened.isDirectory()) throw new Error("Host path is outside the granted folders");
    const fdReal = await realpathOfFd(handle.fd);
    if (!isLexicallyInsideRoots(fdReal, realRoots)) {
      throw new Error("Host path is outside the granted folders");
    }
    const names = await readdir(fdDirPath(handle.fd));
    const listed: Array<{ path: string; kind: "file" | "dir"; size: number }> = [];
    for (const name of names) {
      if (name === "." || name === "..") continue;
      const full = path.join(fdReal, name);
      try {
        const entryHandle = await openInsideHostRoots(full, roots, constants.O_RDONLY | NOFOLLOW);
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
        // Skip entries that escape, vanish, or are symlinks (O_NOFOLLOW).
      }
    }
    return listed.sort((left, right) => left.path.localeCompare(right.path));
  } finally {
    await handle.close();
  }
}

export async function writeFileInsideHostRoots(
  target: string,
  roots: string[],
  content: Uint8Array | Buffer | string,
  options?: OpenInsideHostRootsOptions,
) {
  const resolved = await resolveInsideHostRoots(target, roots);
  if (options?.afterResolve) await options.afterResolve();
  await mkdir(path.dirname(resolved), { recursive: true });
  // Write via a temp file inside the same parent, then rename into place after
  // re-validating the destination so a swapped symlink cannot retain the write.
  const parent = path.dirname(resolved);
  const verifiedParent = await resolveInsideHostRoots(parent, roots);
  const tempPath = path.join(
    verifiedParent,
    `.rakazo-host-disk-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    const tempHandle = await openInsideHostRoots(
      tempPath,
      roots,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_TRUNC,
    );
    try {
      await tempHandle.writeFile(content);
    } finally {
      await tempHandle.close();
    }
    const destination = await resolveInsideHostRoots(resolved, roots);
    await rename(tempPath, destination);
    // Final pin: destination inode (via path open) must still resolve inside roots.
    const realRoots = await realRootsOf(roots);
    const finalHandle = await open(destination, constants.O_RDONLY | NOFOLLOW);
    try {
      const fdReal = await realpathOfFd(finalHandle.fd);
      if (!isLexicallyInsideRoots(fdReal, realRoots)) {
        await rm(destination, { force: true }).catch(() => undefined);
        throw new Error("Host path is outside the granted folders");
      }
      const finalStat = await lstat(destination);
      if (finalStat.isSymbolicLink()) {
        await rm(destination, { force: true }).catch(() => undefined);
        throw new Error("Host path is outside the granted folders");
      }
    } finally {
      await finalHandle.close().catch(() => undefined);
    }
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
