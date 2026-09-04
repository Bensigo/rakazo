import { describe, expect, it } from "vitest";
import { type AxiomIngestClient, createAxiomSink } from "./axiom.js";
import { createConsoleSink } from "./console-sink.js";
import { createLogger } from "./logger.js";
import { createNoopSink } from "./noop-sink.js";
import { createTestSink } from "./test-sink.js";
import type { LogEvent, LogSink } from "./types.js";

function sample(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    timestamp: "2026-01-02T03:04:05.678Z",
    level: "info",
    message: "conformance",
    "service.name": "rakazo-api",
    "request.id": "req-1",
    ...overrides,
  };
}

describe.each([
  [
    "test",
    () => {
      const sink = createTestSink();
      return {
        sink,
        events: () => sink.events,
      };
    },
  ],
  [
    "noop",
    () => ({
      sink: createNoopSink(),
      events: () => [],
    }),
  ],
  [
    "console",
    () => ({
      sink: createConsoleSink({ format: "json" }),
      events: () => [],
    }),
  ],
  [
    "axiom",
    () => {
      const client: AxiomIngestClient = {
        ingest() {},
        async flush() {},
      };
      return {
        sink: createAxiomSink({ dataset: "logs", client }),
        events: () => [],
      };
    },
  ],
] as Array<[string, () => { sink: LogSink; events: () => LogEvent[] }]>)(
  "%s sink conformance",
  (_name, factory) => {
    it("accepts a well-formed event without throwing", () => {
      const { sink } = factory();
      expect(() => sink.write(sample())).not.toThrow();
      expect(() =>
        sink.write(
          sample({
            error: { name: "Error", message: "nope", cause: { name: "Error", message: "root" } },
          }),
        ),
      ).not.toThrow();
    });

    it("flushes when idle", async () => {
      const { sink } = factory();
      await expect(sink.flush?.() ?? Promise.resolve()).resolves.toBeUndefined();
    });

    it("can be used as a logger sink", () => {
      const { sink } = factory();
      const logger = createLogger({ service: "rakazo-api", sinks: [sink] });
      expect(() => logger.info("conformance")).not.toThrow();
    });
  },
);
