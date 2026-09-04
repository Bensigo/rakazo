import type { LogSink } from "./types.js";

export function createNoopSink(): LogSink {
  return {
    write() {},
    flush() {},
  };
}
