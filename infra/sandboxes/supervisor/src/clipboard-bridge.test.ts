import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  attachHostClipboardPaste,
  clipboardTextFromPaste,
  isPasteChord,
  pasteHostText,
  releaseModifierKeys,
  sendRemotePaste,
} from "../../computer/clipboard-bridge.js";

describe("host clipboard paste bridge", () => {
  it("detects Ctrl/Cmd+V and ignores other chords", () => {
    expect(isPasteChord({ ctrlKey: true, code: "KeyV", key: "v" })).toBe(true);
    expect(isPasteChord({ metaKey: true, code: "KeyV", key: "v" })).toBe(true);
    expect(isPasteChord({ ctrlKey: true, metaKey: true, code: "KeyV", key: "V" })).toBe(true);
    expect(isPasteChord({ ctrlKey: true, code: "KeyC", key: "c" })).toBe(false);
    expect(isPasteChord({ altKey: true, ctrlKey: true, code: "KeyV", key: "v" })).toBe(false);
    expect(isPasteChord({ ctrlKey: true, repeat: true, code: "KeyV", key: "v" })).toBe(false);
    expect(isPasteChord({ code: "KeyV", key: "v" })).toBe(false);
  });

  it("reads plain text from a paste event", () => {
    expect(
      clipboardTextFromPaste({
        clipboardData: {
          getData: (type: string) => (type === "text/plain" ? "secret" : ""),
        } as DataTransfer,
      }),
    ).toBe("secret");
    expect(
      clipboardTextFromPaste({
        clipboardData: {
          getData: (type: string) => (type === "text" ? "fallback" : ""),
        } as DataTransfer,
      }),
    ).toBe("fallback");
    expect(clipboardTextFromPaste({})).toBe("");
  });

  it("releases host modifiers then pastes with Linux Ctrl+V", () => {
    const keys: Array<[number, string, boolean | undefined]> = [];
    const sendKey = (keysym: number, code: string, down?: boolean) => {
      keys.push([keysym, code, down]);
    };
    releaseModifierKeys(sendKey);
    expect(keys).toEqual([
      [0xffe3, "ControlLeft", false],
      [0xffe4, "ControlRight", false],
      [0xffeb, "MetaLeft", false],
      [0xffec, "MetaRight", false],
    ]);
    keys.length = 0;
    sendRemotePaste(sendKey);
    expect(keys).toEqual([
      [0xffe3, "ControlLeft", true],
      [0x76, "KeyV", true],
      [0x76, "KeyV", false],
      [0xffe3, "ControlLeft", false],
    ]);
  });

  it("syncs host text into RFB then sends a remote paste", () => {
    const keys: Array<[number, string, boolean | undefined]> = [];
    const rfb = {
      viewOnly: false,
      clipboardPasteFrom: vi.fn(),
      sendKey: (keysym: number, code: string, down?: boolean) => {
        keys.push([keysym, code, down]);
      },
    };
    expect(pasteHostText(rfb, "agent-password")).toBe(true);
    expect(rfb.clipboardPasteFrom).toHaveBeenCalledWith("agent-password");
    expect(keys[0]).toEqual([0xffe3, "ControlLeft", false]);
    expect(keys.at(-4)).toEqual([0xffe3, "ControlLeft", true]);
    expect(keys.at(-3)).toEqual([0x76, "KeyV", true]);
    expect(pasteHostText({ ...rfb, viewOnly: true }, "x")).toBe(false);
    expect(pasteHostText(rfb, "")).toBe(false);
  });

  it("intercepts paste chords and applies host clipboard text", () => {
    const listeners = new Map<string, EventListener>();
    const target = {
      addEventListener: (type: string, listener: EventListener) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
    };
    const rfb = {
      viewOnly: false,
      clipboardPasteFrom: vi.fn(),
      sendKey: vi.fn(),
    };
    const detach = attachHostClipboardPaste(rfb, { target: target as unknown as EventTarget });

    const keydown = listeners.get("keydown");
    const paste = listeners.get("paste");
    expect(keydown).toBeTypeOf("function");
    expect(paste).toBeTypeOf("function");

    const stopPropagation = vi.fn();
    keydown?.(
      {
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        repeat: false,
        code: "KeyV",
        key: "v",
        stopPropagation,
      } as unknown as Event,
    );
    expect(stopPropagation).toHaveBeenCalledOnce();

    const preventDefault = vi.fn();
    const pasteStop = vi.fn();
    paste?.(
      {
        clipboardData: {
          getData: (type: string) => (type === "text/plain" ? "from-host" : ""),
        },
        preventDefault,
        stopPropagation: pasteStop,
      } as unknown as Event,
    );
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(pasteStop).toHaveBeenCalledOnce();
    expect(rfb.clipboardPasteFrom).toHaveBeenCalledWith("from-host");
    expect(rfb.sendKey).toHaveBeenCalled();

    detach();
    expect(listeners.size).toBe(0);
  });

  it("ships the bridge next to embed.html in the computer image", () => {
    const root = path.resolve(import.meta.dirname, "../../computer");
    const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8");
    const embed = readFileSync(path.join(root, "embed.html"), "utf8");
    const start = readFileSync(path.join(root, "start.sh"), "utf8");
    expect(dockerfile).toMatch(/clipboard-bridge\.js/);
    expect(embed).toMatch(/attachHostClipboardPaste/);
    expect(embed).toMatch(/clipboard-bridge\.js/);
    expect(start).toMatch(/clipboard-bridge\.js/);
  });
});
