import { randomUUID } from "node:crypto";
import { getLogContext, runWithLogContext } from "./context.js";
import { generateSpanId, generateTraceId } from "./ids.js";
import { getLogger } from "./logger.js";
import type { JobCorrelation, LogBindings } from "./types.js";
import { JOB_CORRELATION_VERSION } from "./types.js";

const CORRELATION_FIELD = "__rakazoLog";

interface JobCorrelationMeta {
  v: typeof JOB_CORRELATION_VERSION;
  correlation: JobCorrelation;
}

interface NestedJobEnvelope extends JobCorrelationMeta {
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
  const meta: JobCorrelationMeta = {
    v: JOB_CORRELATION_VERSION,
    correlation,
  };
  if (isSidecarPayload(payload)) {
    return { ...payload, [CORRELATION_FIELD]: meta };
  }
  return { ...meta, payload } satisfies NestedJobEnvelope;
}

export function unwrapJobPayload(stored: unknown): {
  payload: unknown;
  correlation?: JobCorrelation;
} {
  const sidecar = sidecarMeta(stored);
  if (sidecar) {
    const { [CORRELATION_FIELD]: _meta, ...payload } = stored as Record<string, unknown>;
    return { payload, correlation: sidecar.correlation };
  }
  if (isNestedEnvelope(stored)) {
    return { payload: stored.payload, correlation: stored.correlation };
  }
  return { payload: stored };
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

function isSidecarPayload(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return !Object.hasOwn(value, CORRELATION_FIELD);
}

function sidecarMeta(value: unknown): JobCorrelationMeta | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return asCorrelationMeta((value as Record<string, unknown>)[CORRELATION_FIELD]);
}

function isNestedEnvelope(value: unknown): value is NestedJobEnvelope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (CORRELATION_FIELD in value) return false;
  const candidate = value as Partial<NestedJobEnvelope>;
  return asCorrelationMeta(candidate) !== undefined && "payload" in candidate;
}

function asCorrelationMeta(value: unknown): JobCorrelationMeta | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<JobCorrelationMeta>;
  if (candidate.v !== JOB_CORRELATION_VERSION) return undefined;
  const correlation = candidate.correlation;
  if (!correlation || typeof correlation !== "object") return undefined;
  if (typeof correlation.jobId !== "string" || typeof correlation.traceId !== "string") {
    return undefined;
  }
  return { v: JOB_CORRELATION_VERSION, correlation };
}
