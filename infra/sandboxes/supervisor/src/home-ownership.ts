import { constants, type Stats } from "node:fs";
import { type FileHandle, lstat, open, opendir, readlink } from "node:fs/promises";
import path from "node:path";

const DIRECTORY_OPEN_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

const DEFAULT_VISIBILITY_WAIT_MS = 2_000;
const DEFAULT_VISIBILITY_RETRY_MS = 100;

class ComputerHomeVisibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComputerHomeVisibilityError";
  }
}

function hasPermissions(stat: Stats, uid: number, gid: number, required: number): boolean {
  const shift = stat.uid === uid ? 6 : stat.gid === gid ? 3 : 0;
  return ((stat.mode >> shift) & required) === required;
}

function isMissingOrNotDirectory(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ELOOP" || code === "ENOTDIR";
}

function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

async function resolveFdPath(fd: number): Promise<string> {
  return readlink(`/proc/self/fd/${fd}`);
}

async function assertFdBeneathRoot(handle: FileHandle, rootPath: string): Promise<void> {
  const currentPath = await resolveFdPath(handle.fd);
  if (!isPathInside(rootPath, currentPath)) {
    throw new Error(`computer home check escaped validated root ${rootPath}; saw ${currentPath}`);
  }
}

function writabilityError(target: string, root: string, uid: number, gid: number): Error {
  return new ComputerHomeVisibilityError(
    `computer home entry ${target} is not writable by uid ${uid}; run sudo chown -R ${uid}:${gid} ${JSON.stringify(root)} or use Compose data-init`,
  );
}

function missingHomeError(root: string): Error {
  return new ComputerHomeVisibilityError(`computer home ${root} does not exist`);
}

/** Pathname walk for non-Linux hosts without /proc/self/fd containment. */
async function assertWritableEntry(
  target: string,
  root: string,
  uid: number,
  gid: number,
  isRoot = false,
): Promise<void> {
  let stat: Stats;
  try {
    stat = await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !isRoot) return;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw missingHomeError(root);
    }
    throw error;
  }
  if (stat.isSymbolicLink()) {
    if (isRoot) throw new Error(`computer home ${root} must not be a symbolic link`);
    return;
  }
  if (isRoot && !stat.isDirectory()) {
    throw new Error(`computer home ${root} must be a directory`);
  }

  const required = stat.isDirectory() ? 0b111 : 0b010;
  if (!hasPermissions(stat, uid, gid, required)) {
    throw writabilityError(target, root, uid, gid);
  }
  if (!stat.isDirectory()) return;

  const directory = await opendir(target);
  for await (const entry of directory) {
    await assertWritableEntry(path.join(target, entry.name), root, uid, gid);
  }
}

async function assertWritableDirectory(
  handle: FileHandle,
  rootPath: string,
  root: string,
  uid: number,
  gid: number,
): Promise<void> {
  await assertFdBeneathRoot(handle, rootPath);
  const stat = await handle.stat();
  const displayPath = await resolveFdPath(handle.fd);
  if (!hasPermissions(stat, uid, gid, 0b111)) {
    throw writabilityError(displayPath, root, uid, gid);
  }

  const descriptorPath = `/proc/self/fd/${handle.fd}`;
  const directory = await opendir(descriptorPath);
  for await (const entry of directory) {
    const childPath = path.join(descriptorPath, entry.name);
    let childDir: FileHandle | undefined;
    try {
      childDir = await open(childPath, DIRECTORY_OPEN_FLAGS);
    } catch (error) {
      if (!isMissingOrNotDirectory(error)) throw error;
    }
    if (childDir) {
      try {
        await assertFdBeneathRoot(childDir, rootPath);
        await assertWritableDirectory(childDir, rootPath, root, uid, gid);
      } finally {
        await childDir.close();
      }
      continue;
    }

    let childStat: Stats;
    try {
      childStat = await lstat(childPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (childStat.isSymbolicLink()) continue;
    if (childStat.isDirectory()) {
      throw new Error(`computer home ${root} changed during validation; retry the request`);
    }
    if (!hasPermissions(childStat, uid, gid, 0b010)) {
      throw writabilityError(path.join(displayPath, entry.name), root, uid, gid);
    }
  }

  await assertFdBeneathRoot(handle, rootPath);
}

async function assertDirectoryStructure(handle: FileHandle, rootPath: string) {
  await assertFdBeneathRoot(handle, rootPath);
  const descriptorPath = `/proc/self/fd/${handle.fd}`;
  const directory = await opendir(descriptorPath);
  for await (const entry of directory) {
    const childPath = path.join(descriptorPath, entry.name);
    let childDir: FileHandle | undefined;
    try {
      childDir = await open(childPath, DIRECTORY_OPEN_FLAGS);
    } catch (error) {
      if (!isMissingOrNotDirectory(error)) throw error;
    }
    if (!childDir) continue;
    try {
      await assertFdBeneathRoot(childDir, rootPath);
      await assertDirectoryStructure(childDir, rootPath);
    } finally {
      await childDir.close();
    }
  }
  await assertFdBeneathRoot(handle, rootPath);
}

async function assertWritableLinux(root: string, uid: number, gid: number): Promise<void> {
  let rootStat: Stats;
  try {
    rootStat = await lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw missingHomeError(root);
    }
    throw error;
  }
  if (rootStat.isSymbolicLink()) {
    throw new Error(`computer home ${root} must not be a symbolic link`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`computer home ${root} must be a directory`);
  }

  let handle: FileHandle;
  try {
    handle = await open(root, DIRECTORY_OPEN_FLAGS);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw missingHomeError(root);
    if (code === "ELOOP") throw new Error(`computer home ${root} must not be a symbolic link`);
    if (code === "ENOTDIR") throw new Error(`computer home ${root} must be a directory`);
    throw error;
  }
  try {
    const rootPath = await resolveFdPath(handle.fd);
    await assertWritableDirectory(handle, rootPath, root, uid, gid);
  } finally {
    await handle.close();
  }
}

/**
 * Validate the home tree's type and fd containment without inferring access
 * from uid/mode bits. Docker Desktop bind mounts can expose synthetic stat
 * ownership that differs from the access decision in a child container.
 */
export async function assertComputerHomeStructure(root: string): Promise<void> {
  let rootStat: Stats;
  try {
    rootStat = await lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw missingHomeError(root);
    throw error;
  }
  if (rootStat.isSymbolicLink()) {
    throw new Error(`computer home ${root} must not be a symbolic link`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`computer home ${root} must be a directory`);
  }
  if (process.platform !== "linux") return;

  let handle: FileHandle;
  try {
    handle = await open(root, DIRECTORY_OPEN_FLAGS);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw missingHomeError(root);
    if (code === "ELOOP") throw new Error(`computer home ${root} must not be a symbolic link`);
    if (code === "ENOTDIR") throw new Error(`computer home ${root} must be a directory`);
    throw error;
  }
  try {
    const rootPath = await resolveFdPath(handle.fd);
    await assertDirectoryStructure(handle, rootPath);
  } finally {
    await handle.close();
  }
}

/** Validate structure locally, then ask the target uid's mount namespace for access. */
export async function assertComputerHomeWritableInContainer(
  root: string,
  uid: number,
  gid: number,
  verifyEffectiveAccess: () => Promise<boolean>,
): Promise<void> {
  await assertComputerHomeStructure(root);
  if (!(await verifyEffectiveAccess())) throw writabilityError(root, root, uid, gid);
}

/** Validate without privileged mutation before a computer receives the home bind mount. */
export async function assertComputerHomeWritable(
  root: string,
  uid: number,
  gid: number,
): Promise<void> {
  if (process.platform === "linux") {
    await assertWritableLinux(root, uid, gid);
    return;
  }
  await assertWritableEntry(root, root, uid, gid, true);
}

/**
 * Docker Desktop can briefly expose stale bind-mount ownership to a second
 * container immediately after the worker creates a home. Recheck only missing
 * or non-writable entries; path type, symlink, and containment failures remain
 * immediate hard failures.
 */
export async function assertComputerHomeWritableAfterVisibilityDelay(
  root: string,
  uid: number,
  gid: number,
  options: {
    maxWaitMs?: number;
    now?: () => number;
    retryMs?: number;
    wait?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<void> {
  const maxWaitMs = Math.max(0, Math.min(options.maxWaitMs ?? DEFAULT_VISIBILITY_WAIT_MS, 2_000));
  const retryMs = Math.max(1, options.retryMs ?? DEFAULT_VISIBILITY_RETRY_MS);
  const now = options.now ?? Date.now;
  const wait =
    options.wait ??
    ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + maxWaitMs;
  while (true) {
    try {
      await assertComputerHomeWritable(root, uid, gid);
      return;
    } catch (error) {
      if (!(error instanceof ComputerHomeVisibilityError)) throw error;
      const remaining = deadline - now();
      if (remaining <= 0) throw error;
      await wait(Math.min(retryMs, remaining));
    }
  }
}

/** Exported for regression coverage of the moved-directory escape check. */
export async function assertOpenedDirectoryBeneathRoot(
  handle: FileHandle,
  rootPath: string,
): Promise<void> {
  await assertFdBeneathRoot(handle, rootPath);
}
