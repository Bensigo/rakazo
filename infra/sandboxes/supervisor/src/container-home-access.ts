import type Docker from "dockerode";

const DEFAULT_PROBE_TIMEOUT_MS = 3_000;
const MAX_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_CLEANUP_TIMEOUT_MS = 1_000;

const ACCESS_PROBE = `
import os
import sys

root = "/home/rakazo"
if not os.path.isdir(root) or os.path.islink(root):
    sys.exit(1)

for directory, names, files in os.walk(root, topdown=True, followlinks=False):
    if not os.access(directory, os.W_OK | os.X_OK, effective_ids=True):
        sys.exit(1)
    names[:] = [name for name in names if not os.path.islink(os.path.join(directory, name))]
    for name in files:
        target = os.path.join(directory, name)
        if not os.path.islink(target) and not os.access(target, os.W_OK, effective_ids=True):
            sys.exit(1)
`;

export function computerHomeAccessProbeOptions(input: {
  homePath: string;
  image: string;
  user: string;
}): Docker.ContainerCreateOptions {
  return {
    Image: input.image,
    User: input.user,
    Cmd: ["python3", "-c", ACCESS_PROBE],
    NetworkDisabled: true,
    HostConfig: {
      Mounts: [
        {
          Type: "bind",
          Source: input.homePath,
          Target: "/home/rakazo",
          ReadOnly: false,
        },
      ],
      NetworkMode: "none",
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      PidsLimit: 32,
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Ask Docker's target mount namespace whether the exact computer uid can use the home. */
export async function probeContainerHomeAccess(
  docker: Docker,
  input: { homePath: string; image: string; user: string },
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  cleanupTimeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
): Promise<boolean> {
  const boundedTimeoutMs = Math.max(1, Math.min(timeoutMs, MAX_PROBE_TIMEOUT_MS));
  const boundedCleanupTimeoutMs = Math.max(
    1,
    Math.min(cleanupTimeoutMs, DEFAULT_CLEANUP_TIMEOUT_MS),
  );
  const container = await withTimeout(
    docker.createContainer(computerHomeAccessProbeOptions(input)),
    boundedTimeoutMs,
    `computer home access probe creation timed out after ${boundedTimeoutMs}ms`,
  );
  try {
    await withTimeout(
      container.start(),
      boundedTimeoutMs,
      `computer home access probe start timed out after ${boundedTimeoutMs}ms`,
    );
    const result = await withTimeout(
      container.wait(),
      boundedTimeoutMs,
      `computer home access probe timed out after ${boundedTimeoutMs}ms`,
    );
    return result.StatusCode === 0;
  } finally {
    await withTimeout(
      container.remove({ force: true }),
      boundedCleanupTimeoutMs,
      `computer home access probe cleanup timed out after ${boundedCleanupTimeoutMs}ms`,
    );
  }
}
