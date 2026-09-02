import {
  close as closeCb,
  fstat as fstatCb,
  readFile as readFileCb,
  writeFile as writeFileCb,
} from "node:fs";
import { promisify } from "node:util";
import koffi from "koffi";

const closeFd = promisify(closeCb);
const fstatFd = promisify(fstatCb);
const readFileFd = promisify(readFileCb) as (fd: number) => Promise<Buffer>;
const writeFileFd = promisify(writeFileCb) as (
  fd: number,
  data: string | Uint8Array,
) => Promise<void>;

/**
 * fd-relative POSIX helpers (openat/mkdirat/renameat/unlinkat).
 *
 * macOS cannot traverse `/dev/fd/<n>/child` the way Linux `/proc/self/fd/<n>/child`
 * works. Desktop host-disk IPC must use these *at APIs for pinned-dir children.
 */

type PosixAtApi = {
  openat: (dirfd: number, pathname: string, flags: number, mode: number) => number;
  mkdirat: (dirfd: number, pathname: string, mode: number) => number;
  renameat: (olddirfd: number, oldpath: string, newdirfd: number, newpath: string) => number;
  unlinkat: (dirfd: number, pathname: string, flags: number) => number;
};

let cached: PosixAtApi | null | undefined;

function errnoCode(): string {
  const errno = koffi.errno();
  switch (errno) {
    case 2:
      return "ENOENT";
    case 13:
      return "EACCES";
    case 17:
      return "EEXIST";
    case 20:
      return "ENOTDIR";
    case 40:
    case 62:
      return "ELOOP";
    default:
      return "EINVAL";
  }
}

function fail(code: string, message: string): never {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  throw error;
}

function assertLeafName(name: string) {
  if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\0")) {
    fail("EINVAL", "Host path is outside the granted folders");
  }
}

function loadPosixAt(): PosixAtApi {
  if (cached === null) fail("ENOSYS", "POSIX *at APIs unavailable");
  if (cached) return cached;
  if (process.platform === "win32") {
    cached = null;
    fail("ENOSYS", "POSIX *at APIs unavailable");
  }
  try {
    const lib =
      process.platform === "darwin" ? koffi.load("libSystem.B.dylib") : koffi.load("libc.so.6");
    cached = {
      openat: lib.func("int openat(int dirfd, const char *pathname, int flags, uint32_t mode)"),
      mkdirat: lib.func("int mkdirat(int dirfd, const char *pathname, uint32_t mode)"),
      renameat: lib.func(
        "int renameat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath)",
      ),
      unlinkat: lib.func("int unlinkat(int dirfd, const char *pathname, int flags)"),
    };
    return cached;
  } catch {
    cached = null;
    fail("ENOSYS", "POSIX *at APIs unavailable");
  }
}

export function fileHandleFromFd(fd: number) {
  return {
    fd,
    stat: (opts?: { bigint?: boolean }) => fstatFd(fd, opts as never),
    readFile: () => readFileFd(fd),
    writeFile: (data: string | Uint8Array) => writeFileFd(fd, data),
    close: () => closeFd(fd),
  };
}

export type PosixAtFileHandle = ReturnType<typeof fileHandleFromFd>;

export function openatChild(
  dirFd: number,
  name: string,
  flags: number,
  mode = 0,
): PosixAtFileHandle {
  assertLeafName(name);
  const api = loadPosixAt();
  const fd = api.openat(dirFd, name, flags, mode);
  if (fd < 0) fail(errnoCode(), `openat failed for ${name}`);
  return fileHandleFromFd(fd);
}

export function mkdiratChild(dirFd: number, name: string, mode = 0o755) {
  assertLeafName(name);
  const api = loadPosixAt();
  const rc = api.mkdirat(dirFd, name, mode);
  if (rc !== 0) fail(errnoCode(), `mkdirat failed for ${name}`);
}

export function renameatChild(dirFd: number, fromName: string, toName: string) {
  assertLeafName(fromName);
  assertLeafName(toName);
  const api = loadPosixAt();
  const rc = api.renameat(dirFd, fromName, dirFd, toName);
  if (rc !== 0) fail(errnoCode(), `renameat failed for ${fromName} -> ${toName}`);
}

export function unlinkatChild(dirFd: number, name: string, flags = 0) {
  assertLeafName(name);
  const api = loadPosixAt();
  const rc = api.unlinkat(dirFd, name, flags);
  if (rc !== 0) fail(errnoCode(), `unlinkat failed for ${name}`);
}
