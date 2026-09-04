import type { LogEvent, LogSink } from "./types.js";

export interface TestSink extends LogSink {
  events: LogEvent[];
  reset(): void;
}

export function createTestSink(): TestSink {
  const events: LogEvent[] = [];
  return {
    events,
    write(event) {
      events.push(event);
    },
    flush() {},
    reset() {
      events.length = 0;
    },
  };
}
