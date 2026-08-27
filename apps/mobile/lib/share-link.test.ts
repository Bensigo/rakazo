import * as SecureStore from "expo-secure-store";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearShareLink, loadShareLink, saveShareLink } from "./share-link.js";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

describe("share-link storage", () => {
  afterEach(() => {
    vi.mocked(SecureStore.getItemAsync).mockReset();
    vi.mocked(SecureStore.setItemAsync).mockReset();
    vi.mocked(SecureStore.deleteItemAsync).mockReset();
  });

  it("persists and restores a share link for a bot", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(
      JSON.stringify({ token: "tok", url: "https://example.test/share/tok" }),
    );
    await saveShareLink("bot-1", { token: "tok", url: "https://example.test/share/tok" });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "rakazo.share_link.bot-1",
      JSON.stringify({ token: "tok", url: "https://example.test/share/tok" }),
    );
    await expect(loadShareLink("bot-1")).resolves.toEqual({
      token: "tok",
      url: "https://example.test/share/tok",
    });
  });

  it("clears a stored share link", async () => {
    await clearShareLink("bot-1");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("rakazo.share_link.bot-1");
  });
});
