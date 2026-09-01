import { createHash } from "node:crypto";
import type { NormalizedRoutineEvent } from "@rakazo/core";
import {
  coalesceRoutineEventTriggers,
  matchingEventTriggers,
  normalizeRepoEventPayload,
} from "@rakazo/core";

export type RoutineEventWakeResult = {
  routineId: string;
  runId: string;
  threadId: string;
};

export type RoutineEventDispatchDeps = {
  prisma: {
    routine: {
      findMany(args: {
        where: {
          botId: string;
          spaceId: string;
          active: boolean;
          OR: Array<Record<string, unknown>>;
        };
        select: {
          id: true;
          eventTriggers: true;
          webhookEnabled: true;
        };
        orderBy: { updatedAt: "desc" };
      }): Promise<
        Array<{
          id: string;
          eventTriggers: unknown;
          webhookEnabled: boolean;
        }>
      >;
    };
  };
  wakeRoutineFromEvent(
    routineId: string,
    event: NormalizedRoutineEvent,
    options?: { idempotencyKey?: string },
  ): Promise<{ runId: string; threadId: string } | null>;
};

/**
 * Find active routines on a bot whose event triggers match, and wake each one.
 * Returns the wake results (empty when nothing matched).
 */
export async function dispatchRoutineEvents(input: {
  deps: RoutineEventDispatchDeps;
  botId: string;
  spaceId: string;
  events: NormalizedRoutineEvent[];
  idempotencyKey?: string;
}): Promise<RoutineEventWakeResult[]> {
  const routines = await input.deps.prisma.routine.findMany({
    where: {
      botId: input.botId,
      spaceId: input.spaceId,
      active: true,
      OR: [{ webhookEnabled: true }, { NOT: { eventTriggers: { equals: [] } } }],
    },
    select: {
      id: true,
      eventTriggers: true,
      webhookEnabled: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const results: RoutineEventWakeResult[] = [];
  const woken = new Set<string>();

  for (const routine of routines) {
    const triggers = coalesceRoutineEventTriggers(routine.eventTriggers, routine.webhookEnabled);
    if (triggers.length === 0) continue;

    const matched = input.events.some((event) => matchingEventTriggers(triggers, event).length > 0);
    if (!matched || woken.has(routine.id)) continue;

    const promptEvent = pickPromptEvent(triggers, input.events);
    const idempotencyKey = input.idempotencyKey
      ? routineEventIdempotencyKey(routine.id, input.idempotencyKey)
      : undefined;
    const wake = await input.deps.wakeRoutineFromEvent(routine.id, promptEvent, {
      idempotencyKey,
    });
    if (!wake) continue;
    woken.add(routine.id);
    results.push({ routineId: routine.id, runId: wake.runId, threadId: wake.threadId });
  }

  return results;
}

/** Prefer a matching repo event over a generic webhook event for the prompt. */
export function pickPromptEvent(
  triggers: ReturnType<typeof coalesceRoutineEventTriggers>,
  events: NormalizedRoutineEvent[],
): NormalizedRoutineEvent {
  const matching = events.filter((event) => matchingEventTriggers(triggers, event).length > 0);
  const repo = matching.find((event) => event.source === "repo");
  if (repo) return repo;
  return matching[0] ?? events[0]!;
}

export function routineEventIdempotencyKey(routineId: string, eventKey: string): string {
  const digest = createHash("sha256").update(`${routineId}:${eventKey}`).digest("base64url");
  return `routine-event:${digest}`;
}

/** Build the webhook + optional repo events from an inbound HTTP payload. */
export function eventsFromWebhookPayload(
  payload: Record<string, unknown>,
  headers: { eventName?: string | null } = {},
): NormalizedRoutineEvent[] {
  const events: NormalizedRoutineEvent[] = [{ source: "webhook", payload }];
  const repo = normalizeRepoEventPayload(payload, headers);
  if (repo) events.push(repo);
  return events;
}

export function webhookDeliveryIdempotencyKey(input: {
  botId: string;
  headers: Headers | { get(name: string): string | null };
  payload: Record<string, unknown>;
  /** Exact request body when available; used when no explicit delivery id is present. */
  rawBody?: string;
}): string {
  const explicit =
    input.headers.get("idempotency-key")?.trim() ||
    input.headers.get("x-idempotency-key")?.trim() ||
    (typeof input.payload.id === "string" ? input.payload.id.trim() : "") ||
    (typeof input.payload.event_id === "string" ? input.payload.event_id.trim() : "") ||
    "";
  const material = explicit || input.rawBody?.trim() || JSON.stringify(input.payload);
  return `webhook:${input.botId}:${createHash("sha256").update(material).digest("base64url")}`;
}
