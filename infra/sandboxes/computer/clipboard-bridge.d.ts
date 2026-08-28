/** Host → sandbox paste helpers for the chrome-less noVNC embed. */

export const KEYSYM: {
  Control_L: number;
  Control_R: number;
  Super_L: number;
  Super_R: number;
  v: number;
};

export function isPasteChord(event: {
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  code?: string;
  key?: string;
}): boolean;

export function clipboardTextFromPaste(event: {
  clipboardData?: { getData: (type: string) => string } | null;
}): string;

export function releaseModifierKeys(
  sendKey: (keysym: number, code: string, down?: boolean) => void,
): void;

export function sendRemotePaste(
  sendKey: (keysym: number, code: string, down?: boolean) => void,
): void;

export function pasteHostText(
  rfb: {
    viewOnly?: boolean;
    clipboardPasteFrom?: (text: string) => void;
    sendKey?: (keysym: number, code: string, down?: boolean) => void;
  },
  text: string,
): boolean;

type EventTargetLike = {
  addEventListener: (
    type: string,
    listener: (event: object) => void,
    options?: boolean | { capture?: boolean },
  ) => void;
  removeEventListener: (
    type: string,
    listener: (event: object) => void,
    options?: boolean | { capture?: boolean },
  ) => void;
};

export function attachHostClipboardPaste(
  rfb: {
    viewOnly?: boolean;
    clipboardPasteFrom?: (text: string) => void;
    sendKey?: (keysym: number, code: string, down?: boolean) => void;
  },
  options?: { target?: EventTargetLike },
): () => void;
