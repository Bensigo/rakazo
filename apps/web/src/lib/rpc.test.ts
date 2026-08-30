import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPrivateSpaceSelection, selectedPrivateSpaceId, selectPrivateSpace } from "./rpc.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("private space selection storage", () => {
  it("swallows localStorage write failures so callers can keep navigating", () => {
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

    expect(() => selectPrivateSpace("space-support")).not.toThrow();
    expect(() => clearPrivateSpaceSelection()).not.toThrow();
    expect(selectedPrivateSpaceId()).toBeNull();
  });
});
