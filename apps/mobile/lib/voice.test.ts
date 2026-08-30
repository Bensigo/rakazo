import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authHeaders, rpc, selectedPrivateSpaceId } from "./api";
import { speakText } from "./voice";

vi.mock("expo-file-system", () => ({ File: class {}, Paths: {} }));
vi.mock("./api", () => ({
  authHeaders: vi.fn(),
  currentApiBase: vi.fn(() => "https://api.example"),
  rpc: vi.fn(),
  selectedPrivateSpaceId: vi.fn(),
}));

class FakeAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";

  async play() {
    setTimeout(() => this.onended?.(), 0);
  }

  pause() {}
}

describe("mobile speech", () => {
  beforeEach(() => {
    vi.mocked(selectedPrivateSpaceId).mockReturnValue("space-support");
    vi.mocked(authHeaders).mockImplementation(
      async (privateSpaceId): Promise<Record<string, string>> => {
        if (!privateSpaceId) return {};
        return { "x-rakazo-workspace-id": privateSpaceId };
      },
    );
    vi.mocked(rpc).mockImplementation(async () => {
      vi.mocked(selectedPrivateSpaceId).mockReturnValue("space-finance");
      return { ready: true, utterances: ["First", "Second"] } as never;
    });
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps every request on the space captured before preparation", async () => {
    await expect(speakText("Read this", { botId: "bot-1" })).resolves.toBe(true);

    expect(rpc).toHaveBeenCalledWith(
      "voice/prepare",
      { text: "Read this", voiceId: undefined, botId: "bot-1" },
      { privateSpaceId: "space-support" },
    );
    expect(selectedPrivateSpaceId).toHaveBeenCalledTimes(1);
    expect(authHeaders).toHaveBeenCalledTimes(2);
    expect(authHeaders).toHaveBeenNthCalledWith(1, "space-support");
    expect(authHeaders).toHaveBeenNthCalledWith(2, "space-support");
  });
});
