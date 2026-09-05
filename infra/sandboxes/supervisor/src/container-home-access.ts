import { randomUUID } from "node:crypto";
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
  name?: string;
  signal?: AbortSignal;
  user: string;
}): Docker.ContainerCreateOptions {
  return {
    name: input.name,
    abortSignal: input.signal,
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

function isNotFound(error: unknown): boolean {
  return (error as { statusCode?: number }).statusCode === 404;
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
  options: {
    cleanupTimeoutMs?: number;
    onLateCleanupError?: (error: unknown) => void;
    timeoutMs?: number;
  } = {},
): Promise<boolean> {
  const boundedTimeoutMs = Math.max(
    1,
    Math.min(options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS, MAX_PROBE_TIMEOUT_MS),
  );
  const boundedCleanupTimeoutMs = Math.max(
    1,
    Math.min(options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS, DEFAULT_CLEANUP_TIMEOUT_MS),
  );
  const name = `rakazo-home-access-probe-${randomUUID()}`;
  const controller = new AbortController();
  const createPromise = docker.createContainer(
    computerHomeAccessProbeOptions({ ...input, name, signal: controller.signal }),
  );
  let container: Docker.Container;
  try {
    container = await withTimeout(
      createPromise,
      boundedTimeoutMs,
      `computer home access probe creation timed out after ${boundedTimeoutMs}ms`,
    );
  } catch (error) {
    controller.abort();
    // A Docker response can arrive after the bounded request has failed. The
    // unique name fences this probe from every other request, while this
    // continuation removes an eventual successful create by its returned handle.
    void createPromise.then(
      async (lateContainer) => {
        try {
          await withTimeout(
            lateContainer.remove({ force: true }),
            boundedCleanupTimeoutMs,
            `late computer home access probe cleanup timed out after ${boundedCleanupTimeoutMs}ms`,
          );
        } catch (lateError) {
          if (options.onLateCleanupError) options.onLateCleanupError(lateError);
          else {
            const detail = lateError instanceof Error ? lateError.message : String(lateError);
            process.emitWarning(`late computer home access probe cleanup failed: ${detail}`, {
              code: "RAKAZO_HOME_PROBE_CLEANUP",
            });
          }
        }
      },
      () => undefined,
    );
    try {
      await withTimeout(
        docker.getContainer(name).remove({ force: true }),
        boundedCleanupTimeoutMs,
        `computer home access probe cleanup timed out after ${boundedCleanupTimeoutMs}ms`,
      );
    } catch (cleanupError) {
      if (!isNotFound(cleanupError)) {
        throw new AggregateError(
          [error, cleanupError],
          "computer home access probe failed and named cleanup did not complete",
        );
      }
    }
    throw error;
  }
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
