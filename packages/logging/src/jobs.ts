import { randomUUID } from "node:crypto";
import { getLogContext, runWithLogContext } from "./context.js";
import { generateSpanId, generateTraceId } from "./ids.js";
import { getLogger } from "./logger.js";
import type { JobCorrelation, LogBindings } from "./types.js";
import { JOB_CORRELATION_VERSION } from "./types.js";

interface JobEnvelope {
  v: typeof JOB_CORRELATION_VERSION;
  correlation: JobCorrelation;
  payload: unknown;
}

const PAYLOAD_IDS: Record<string, string> = {
  runId: "run.id",
  computerId: "computer.id",
  threadId: "thread.id",
  routineId: "routine.id",
  skillId: "skill.id",
  botId: "bot.id",
  spaceId: "space.id",
  userId: "user.id",
  jobId: "job.id",
};

export function createJobCorrelation(): JobCorrelation {
  const ctx = getLogContext();
  const traceId =
    typeof ctx["trace.id"] === "string" && ctx["trace.id"].length === 32
      ? ctx["trace.id"]
      : generateTraceId();
  const parentSpanId = typeof ctx["span.id"] === "string" ? ctx["span.id"] : undefined;
  return {
    jobId: randomUUID(),
    traceId,
    ...(parentSpanId ? { parentSpanId } : {}),
  };
}

export function wrapJobPayload(payload: unknown, correlation = createJobCorrelation()): unknown {
  return {
    v: JOB_CORRELATION_VERSION,
    correlation,
    payload,
  } satisfies JobEnvelope;
}

export function unwrapJobPayload(stored: unknown): {
  payload: unknown;
  correlation?: JobCorrelation;
} {
  if (!isEnvelope(stored)) return { payload: stored };
  return { payload: stored.payload, correlation: stored.correlation };
}

export function jobPayloadBindings(payload: unknown): LogBindings {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return {};
  const bindings: LogBindings = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const field = PAYLOAD_IDS[key];
    if (field && typeof value === "string" && value.length > 0) bindings[field] = value;
  }
  return bindings;
}

export async function runCorrelatedJob<T>(options: {
  name: string;
  payload: unknown;
  correlation?: JobCorrelation;
  run: () => Promise<T>;
}): Promise<T> {
  const logger = getLogger();
  const correlation = options.correlation ?? createJobCorrelation();
  const started = performance.now();
  const bindings: LogBindings = {
    "job.id": correlation.jobId,
    "job.type": options.name,
    "trace.id": correlation.traceId,
    "span.id": generateSpanId(),
    ...jobPayloadBindings(options.payload),
  };
  if (correlation.parentSpanId) bindings["parent.span.id"] = correlation.parentSpanId;
  return runWithLogContext(bindings, async () => {
    try {
      const result = await options.run();
      logger.info("job.completed", {
        "job.duration_ms": Math.round(performance.now() - started),
        "job.outcome": "ok",
      });
      return result;
    } catch (error) {
      logger.error("job.completed", error, {
        "job.duration_ms": Math.round(performance.now() - started),
        "job.outcome": "error",
      });
      throw error;
    }
  });
}

function isEnvelope(value: unknown): value is JobEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<JobEnvelope>;
  if (candidate.v !== JOB_CORRELATION_VERSION) return false;
  const correlation = candidate.correlation;
  if (!correlation || typeof correlation !== "object") return false;
  return (
    typeof correlation.jobId === "string" &&
    typeof correlation.traceId === "string" &&
    "payload" in candidate
  );
}
