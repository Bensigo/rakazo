import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import type { RakazoDesktop } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";

describe("desktop preload bridge", () => {
  it("exposes only the platform, the four window operations, and the OAuth bridge", async () => {
    const invoke = vi.fn(async (channel: string) => ({ channel }));
    const exposeInMainWorld = vi.fn();
    const on = vi.fn();
    const off = vi.fn();
    const source = readFileSync(path.join(import.meta.dirname, "preload.cjs"), "utf8");

    vm.runInNewContext(source, {
      process: { platform: "linux" },
      require(moduleName: string) {
        if (moduleName !== "electron") throw new Error(`Unexpected preload import: ${moduleName}`);
        return { contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke, on, off } };
      },
    });

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    const [globalName, bridge] = exposeInMainWorld.mock.calls[0] as [string, RakazoDesktop];
    expect(globalName).toBe("rakazoDesktop");
    expect(bridge.platform).toBe("linux");
    expect(Object.keys(bridge).sort()).toEqual(["oauth", "platform", "window"]);
    expect(Object.keys(bridge.window).sort()).toEqual([
      "close",
      "minimize",
      "state",
      "toggleMaximize",
    ]);

    await bridge.window.close();
    await bridge.window.minimize();
    await bridge.window.toggleMaximize();
    await bridge.window.state();
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "desktop.window.close",
      "desktop.window.minimize",
      "desktop.window.toggleMaximize",
      "desktop.window.state",
    ]);
  });

  it("forwards captured codes without leaking the IPC event to the renderer", () => {
    const listeners: Array<(event: unknown, callback: unknown) => void> = [];
    const on = vi.fn((_channel: string, handler: (event: unknown, callback: unknown) => void) => {
      listeners.push(handler);
    });
    const off = vi.fn();
    const exposeInMainWorld = vi.fn();
    const source = readFileSync(path.join(import.meta.dirname, "preload.cjs"), "utf8");

    vm.runInNewContext(source, {
      process: { platform: "linux" },
      require: () => ({
        contextBridge: { exposeInMainWorld },
        ipcRenderer: { invoke: vi.fn(), on, off },
      }),
    });

    const [, bridge] = exposeInMainWorld.mock.calls[0] as [string, RakazoDesktop];
    const received: unknown[] = [];
    const unsubscribe = bridge.oauth.onCallback((callback) => received.push(callback));

    expect(on).toHaveBeenCalledWith("desktop.oauth.callback", expect.any(Function));
    listeners[0]?.({ sender: "ipc-event" }, { code: "ac_123", state: "verifier_456" });
    expect(received).toEqual([{ code: "ac_123", state: "verifier_456" }]);

    unsubscribe();
    expect(off).toHaveBeenCalledWith("desktop.oauth.callback", expect.any(Function));
  });
});
