/**
 * Host → sandbox paste for the chrome-less noVNC embed.
 *
 * Debian noVNC 1.3 only syncs clipboard from the full vnc.html panel.
 * Without this bridge, Ctrl/Cmd+V only sends keys: on macOS Cmd+V becomes
 * Super+V (no paste on Linux), and the remote CLIPBOARD stays empty.
 */

export const KEYSYM = {
  Control_L: 0xffe3,
  Control_R: 0xffe4,
  Super_L: 0xffeb,
  Super_R: 0xffec,
  v: 0x76,
};

/** @param {{ ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, code?: string, key?: string }} event */
export function isPasteChord(event) {
  if (!event || event.altKey) return false;
  if (!(event.ctrlKey || event.metaKey)) return false;
  return event.code === "KeyV" || event.key === "v" || event.key === "V";
}

/** @param {{ clipboardData?: DataTransfer | null }} event */
export function clipboardTextFromPaste(event) {
  const data = event?.clipboardData;
  if (!data) return "";
  return data.getData("text/plain") || data.getData("text") || "";
}

/** @param {(keysym: number, code: string, down?: boolean) => void} sendKey */
export function releaseModifierKeys(sendKey) {
  sendKey(KEYSYM.Control_L, "ControlLeft", false);
  sendKey(KEYSYM.Control_R, "ControlRight", false);
  sendKey(KEYSYM.Super_L, "MetaLeft", false);
  sendKey(KEYSYM.Super_R, "MetaRight", false);
}

/** Send Linux Ctrl+V so the focused remote app pastes from CLIPBOARD. */
export function sendRemotePaste(sendKey) {
  sendKey(KEYSYM.Control_L, "ControlLeft", true);
  sendKey(KEYSYM.v, "KeyV", true);
  sendKey(KEYSYM.v, "KeyV", false);
  sendKey(KEYSYM.Control_L, "ControlLeft", false);
}

/**
 * Sync host paste into the RFB session, then paste into the remote desktop.
 * @param {{ viewOnly?: boolean, clipboardPasteFrom?: (text: string) => void, sendKey?: Function }} rfb
 * @param {string} text
 */
export function pasteHostText(rfb, text) {
  if (!rfb || rfb.viewOnly || !text) return false;
  const sendKey = rfb.sendKey?.bind(rfb);
  if (!sendKey || typeof rfb.clipboardPasteFrom !== "function") return false;
  releaseModifierKeys(sendKey);
  rfb.clipboardPasteFrom(text);
  sendRemotePaste(sendKey);
  return true;
}

/**
 * @param {{ viewOnly?: boolean, clipboardPasteFrom?: (text: string) => void, sendKey?: Function }} rfb
 * @param {{ target?: EventTarget }} [options]
 * @returns {() => void} detach
 */
export function attachHostClipboardPaste(rfb, options = {}) {
  const target = options.target ?? globalThis;
  const onKeyDown = (event) => {
    if (rfb.viewOnly || !isPasteChord(event)) return;
    // Keep default so the browser still fires `paste` with clipboardData.
    event.stopPropagation();
  };
  const onKeyUp = (event) => {
    if (rfb.viewOnly || !isPasteChord(event)) return;
    event.stopPropagation();
  };
  const onPaste = (event) => {
    if (rfb.viewOnly) return;
    const text = clipboardTextFromPaste(event);
    if (!text) return;
    event.preventDefault();
    event.stopPropagation();
    pasteHostText(rfb, text);
  };

  target.addEventListener("keydown", onKeyDown, true);
  target.addEventListener("keyup", onKeyUp, true);
  target.addEventListener("paste", onPaste, true);
  return () => {
    target.removeEventListener("keydown", onKeyDown, true);
    target.removeEventListener("keyup", onKeyUp, true);
    target.removeEventListener("paste", onPaste, true);
  };
}
