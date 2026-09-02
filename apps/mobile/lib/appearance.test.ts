import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
});

vi.mock("react-native", () => ({
  Appearance: {
    getColorScheme: () => "dark",
    addChangeListener: () => ({ remove() {} }),
  },
}));

describe("mobile appearance", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("defaults to system and resolves light or dark from the scheme", async () => {
    const {
      getCachedAppearancePreference,
      resolveMobileAppearance,
      setAppearancePreference,
    } = await import("./appearance");
    expect(getCachedAppearancePreference()).toBe("system");
    expect(resolveMobileAppearance("system", "light")).toBe("light");
    expect(resolveMobileAppearance("system", "dark")).toBe("dark");
    await setAppearancePreference("light");
    expect(getCachedAppearancePreference()).toBe("light");
    expect(resolveMobileAppearance("light", "dark")).toBe("light");
    await setAppearancePreference("system");
  });
});
