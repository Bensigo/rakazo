import { describe, expect, it, vi } from "vitest";
import { dispatchRoutineEvents, eventsFromWebhookPayload } from "./routine-event-dispatch.js";

describe("routine event dispatch", () => {
  it("normalizes webhook payloads into webhook and repo events when possible", () => {
    const events = eventsFromWebhookPayload(
      {
        action: "opened",
        pull_request: { merged: false },
        repository: { full_name: "acme/app" },
      },
      { eventName: "pull_request" },
    );
    expect(events.map((event) => event.source)).toEqual(["webhook", "repo"]);
    expect(events[1]).toMatchObject({ source: "repo", repo: "acme/app", event: "pr_opened" });
  });

  it("wakes matching routines once per event batch", async () => {
    const wakeRoutineFromEvent = vi.fn(async (routineId: string) => ({
      runId: `run-${routineId}`,
      threadId: "thread-1",
    }));
    const deps = {
      prisma: {
        routine: {
          findMany: vi.fn(async () => [
            {
              id: "routine-webhook",
              webhookEnabled: true,
              eventTriggers: [{ id: "w1", kind: "webhook" }],
            },
            {
              id: "routine-repo",
              webhookEnabled: false,
              eventTriggers: [
                {
                  id: "r1",
                  kind: "repo",
                  repo: "acme/app",
                  events: ["pr_opened"],
                },
              ],
            },
            {
              id: "routine-other",
              webhookEnabled: false,
              eventTriggers: [
                {
                  id: "r2",
                  kind: "repo",
                  repo: "acme/other",
                  events: ["push"],
                },
              ],
            },
          ]),
        },
      },
      wakeRoutineFromEvent,
    };

    const results = await dispatchRoutineEvents({
      deps,
      botId: "bot-1",
      spaceId: "space-1",
      events: eventsFromWebhookPayload(
        {
          action: "opened",
          pull_request: { merged: false },
          repository: { full_name: "acme/app" },
        },
        { eventName: "pull_request" },
      ),
    });

    expect(results.map((row) => row.routineId).sort()).toEqual(["routine-repo", "routine-webhook"]);
    expect(wakeRoutineFromEvent).toHaveBeenCalledTimes(2);
  });
});
