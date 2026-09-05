import type Docker from "dockerode";
import { describe, expect, it, vi } from "vitest";
import {
  computerHomeAccessProbeOptions,
  probeContainerHomeAccess,
} from "./container-home-access.js";

function dockerWithProbe(input: {
  remove?: () => Promise<unknown>;
  start?: () => Promise<unknown>;
  wait: () => Promise<{ StatusCode: number }>;
}) {
  const container = {
    start: vi.fn(input.start ?? (async () => undefined)),
    wait: vi.fn(input.wait),
    remove: vi.fn(input.remove ?? (async () => undefined)),
  };
  const docker = {
    createContainer: vi.fn(async () => container),
  } as unknown as Docker;
  return { container, docker };
}

describe("container home access probe", () => {
  it("uses the exact computer image, user, structured bind, and a locked-down runtime", () => {
    expect(
      computerHomeAccessProbeOptions({
        homePath: "/host/data/homes/team-a",
        image: "computer:release",
        user: "1000:1000",
      }),
    ).toMatchObject({
      Image: "computer:release",
      User: "1000:1000",
      NetworkDisabled: true,
      HostConfig: {
        Mounts: [
          {
            Type: "bind",
            Source: "/host/data/homes/team-a",
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
    });
  });

  it("accepts only a successful target-user access check and always removes the probe", async () => {
    const success = dockerWithProbe({ wait: async () => ({ StatusCode: 0 }) });
    await expect(
      probeContainerHomeAccess(success.docker, {
        homePath: "/host/home",
        image: "computer:test",
        user: "1000:1000",
      }),
    ).resolves.toBe(true);
    expect(success.container.remove).toHaveBeenCalledWith({ force: true });

    const denied = dockerWithProbe({ wait: async () => ({ StatusCode: 1 }) });
    await expect(
      probeContainerHomeAccess(denied.docker, {
        homePath: "/host/home",
        image: "computer:test",
        user: "1000:1000",
      }),
    ).resolves.toBe(false);
    expect(denied.container.remove).toHaveBeenCalledWith({ force: true });
  });

  it("fails closed on timeout and force-removes the probe", async () => {
    const pending = dockerWithProbe({
      wait: () => new Promise<{ StatusCode: number }>(() => undefined),
    });
    await expect(
      probeContainerHomeAccess(
        pending.docker,
        { homePath: "/host/home", image: "computer:test", user: "1000:1000" },
        5,
      ),
    ).rejects.toThrow(/timed out/);
    expect(pending.container.remove).toHaveBeenCalledWith({ force: true });
  });

  it("fails closed on start rejection and still force-removes the probe", async () => {
    const startFailure = dockerWithProbe({
      start: async () => {
        throw new Error("daemon rejected start");
      },
      wait: async () => ({ StatusCode: 0 }),
    });
    await expect(
      probeContainerHomeAccess(startFailure.docker, {
        homePath: "/host/home",
        image: "computer:test",
        user: "1000:1000",
      }),
    ).rejects.toThrow(/daemon rejected start/);
    expect(startFailure.container.wait).not.toHaveBeenCalled();
    expect(startFailure.container.remove).toHaveBeenCalledWith({ force: true });
  });

  it("bounds a hung cleanup and fails closed", async () => {
    const cleanupHang = dockerWithProbe({
      wait: async () => ({ StatusCode: 0 }),
      remove: () => new Promise<unknown>(() => undefined),
    });
    await expect(
      probeContainerHomeAccess(
        cleanupHang.docker,
        { homePath: "/host/home", image: "computer:test", user: "1000:1000" },
        50,
        5,
      ),
    ).rejects.toThrow(/cleanup timed out after 5ms/);
    expect(cleanupHang.container.remove).toHaveBeenCalledWith({ force: true });
  });

  it("fails closed when cleanup cannot prove that the probe was removed", async () => {
    const cleanupFailure = dockerWithProbe({
      wait: async () => ({ StatusCode: 0 }),
      remove: async () => {
        throw new Error("remove failed");
      },
    });
    await expect(
      probeContainerHomeAccess(cleanupFailure.docker, {
        homePath: "/host/home",
        image: "computer:test",
        user: "1000:1000",
      }),
    ).rejects.toThrow(/remove failed/);
  });
});
