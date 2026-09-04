import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";
import { createTestSink } from "./test-sink.js";

describe("logger", () => {
  it("filters levels including off", () => {
    const sink = createTestSink();
    const logger = createLogger({ service: "rakazo-api", level: "warn", sinks: [sink] });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(sink.events.map((event) => event.message)).toEqual(["w", "e"]);

    const silent = createLogger({ service: "rakazo-api", level: "off", sinks: [sink] });
    silent.error("never");
    expect(sink.events.map((event) => event.message)).toEqual(["w", "e"]);
  });

  it("merges child bindings under call-site bindings", () => {
    const sink = createTestSink();
    const logger = createLogger({
      service: "rakazo-api",
      sinks: [sink],
      bindings: { "service.role": "api" },
    });
    logger.child({ "job.type": "run.continue" }).info("hello", { "job.type": "override" });
    expect(sink.events[0]).toMatchObject({
      message: "hello",
      "service.name": "rakazo-api",
      "service.role": "api",
      "job.type": "override",
    });
  });

  it("prefers explicit bindings over async context", () => {
    const sink = createTestSink();
    const logger = createLogger({ service: "rakazo-api", sinks: [sink] });
    logger.withContext({ "request.id": "als" }, () => {
      logger.info("ctx", { "request.id": "call" });
    });
    expect(sink.events[0]?.["request.id"]).toBe("call");
  });

  it("isolates concurrent async contexts", async () => {
    const sink = createTestSink();
    const logger = createLogger({ service: "rakazo-api", sinks: [sink] });
    let releaseFirst!: () => void;
    const firstHold = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = logger.withContext({ "request.id": "a" }, async () => {
      await firstHold;
      logger.info("first");
    });
    const second = logger.withContext({ "request.id": "b" }, async () => {
      logger.info("second");
      releaseFirst();
    });
    await Promise.all([first, second]);
    expect(sink.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "first", "request.id": "a" }),
        expect.objectContaining({ message: "second", "request.id": "b" }),
      ]),
    );
  });

  it("forwards events to an injected custom sink", () => {
    const writes: string[] = [];
    const logger = createLogger({
      service: "rakazo-api",
      sinks: [
        {
          write(event) {
            writes.push(event.message);
          },
        },
      ],
    });
    logger.info("custom");
    expect(writes).toEqual(["custom"]);
  });

  it("keeps logging when a sink throws", () => {
    const sink = createTestSink();
    const logger = createLogger({
      service: "rakazo-api",
      sinks: [
        {
          write() {
            throw new Error("sink down");
          },
        },
        sink,
      ],
    });
    expect(() => logger.info("still works")).not.toThrow();
    expect(sink.events).toHaveLength(1);
  });

  it("flushes sinks and respects a timeout", async () => {
    let flushed = false;
    const logger = createLogger({
      service: "rakazo-api",
      sinks: [
        {
          write() {},
          async flush() {
            flushed = true;
          },
        },
      ],
    });
    await logger.flush({ timeoutMs: 50 });
    expect(flushed).toBe(true);

    const hanging = createLogger({
      service: "rakazo-api",
      sinks: [
        {
          write() {},
          flush() {
            return new Promise(() => undefined);
          },
        },
      ],
    });
    await expect(hanging.flush({ timeoutMs: 20 })).resolves.toBeUndefined();
  });

  it("uses a test clock for timestamps", () => {
    const sink = createTestSink();
    const logger = createLogger({
      service: "rakazo-api",
      sinks: [sink],
      now: () => new Date("2026-01-02T03:04:05.000Z"),
    });
    logger.info("timed");
    expect(sink.events[0]?.timestamp).toBe("2026-01-02T03:04:05.000Z");
  });
});

describe("error serialization", () => {
  it("records cause chains", async () => {
    const { serializeError } = await import("./serialize-error.js");
    const error = new Error("outer", { cause: new Error("inner", { cause: new Error("root") }) });
    expect(serializeError(error)).toMatchObject({
      message: "outer",
      cause: { message: "inner", cause: { message: "root" } },
    });
  });
});
