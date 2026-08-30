import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPrivateSpaceSelection, selectedPrivateSpaceId, selectPrivateSpace } from "./rpc.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("private space selection storage", () => {
  it("reports localStorage write failures without throwing", () => {
    const localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => {
        throw new Error("quota exceeded");
      },
    };
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("localStorage", localStorage);

    expect(selectPrivateSpace("space-support")).toBe(false);
    expect(() => clearPrivateSpaceSelection()).not.toThrow();
    expect(selectedPrivateSpaceId()).toBeNull();
  });

  it("reports when a private-space selection was persisted", () => {
    const setItem = vi.fn();
    const localStorage = { getItem: () => null, setItem, removeItem: vi.fn() };
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("localStorage", localStorage);

    expect(selectPrivateSpace("space-support")).toBe(true);
    expect(setItem).toHaveBeenCalledWith("rakazo:private-space-id", "space-support");
  });
});
