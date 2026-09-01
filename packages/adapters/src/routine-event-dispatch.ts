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
        };
        select: {
          id: true;
          eventTriggers: true;
          webhookEnabled: true;
        };
        orderBy: { updatedAt: "desc" };
        take: number;
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
  limit?: number;
}): Promise<RoutineEventWakeResult[]> {
  const routines = await input.deps.prisma.routine.findMany({
    where: {
      botId: input.botId,
      spaceId: input.spaceId,
      active: true,
    },
    select: {
      id: true,
      eventTriggers: true,
      webhookEnabled: true,
    },
    orderBy: { updatedAt: "desc" },
    take: input.limit ?? 25,
  });

  const results: RoutineEventWakeResult[] = [];
  const woken = new Set<string>();

  for (const routine of routines) {
    const triggers = coalesceRoutineEventTriggers(routine.eventTriggers, routine.webhookEnabled);
    if (triggers.length === 0) continue;

    const matched = input.events.some((event) => matchingEventTriggers(triggers, event).length > 0);
    if (!matched || woken.has(routine.id)) continue;

    const wake = await input.deps.wakeRoutineFromEvent(
      routine.id,
      // Prefer the most specific matching event for the prompt payload.
      pickPromptEvent(triggers, input.events),
    );
    if (!wake) continue;
    woken.add(routine.id);
    results.push({ routineId: routine.id, runId: wake.runId, threadId: wake.threadId });
  }

  return results;
}

function pickPromptEvent(
  triggers: ReturnType<typeof coalesceRoutineEventTriggers>,
  events: NormalizedRoutineEvent[],
): NormalizedRoutineEvent {
  for (const event of events) {
    if (matchingEventTriggers(triggers, event).length > 0) return event;
  }
  return events[0]!;
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
