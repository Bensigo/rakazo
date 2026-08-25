import { describe, expect, it } from "vitest";

import {
  appendConnectorIntent,
  buildComposerMentionOptions,
  connectorIntentLine,
  mentionChipKey,
  partitionComposerMentions,
  routineScheduleSubtitle,
  stripMentionKinds,
  stripMentionToken,
  toThreadMentionPayload,
} from "./composer-mentions.js";

describe("buildComposerMentionOptions", () => {
  it("lists bots groups routines connectors and everyone", () => {
    const options = buildComposerMentionOptions({
      query: "",
      includeEveryone: true,
      bots: [{ id: "b1", name: "Chief", color: "#111" }],
      groups: [{ id: "g1", name: "Planning" }],
      routines: [
        { id: "r1", name: "Daily digest", crons: ["0 9 * * 1-5"], botId: "b1", botName: "Chief" },
      ],
      connectors: [
        { id: "c1", name: "Gmail", authStatus: "connected", connectionId: "c1" },
        { id: "catalog:stripe", name: "Stripe", authStatus: "needs_auth" },
      ],
    });
    expect(options.map((option) => option.kind)).toEqual([
      "everyone",
      "bot",
      "group",
      "routine",
      "connector",
      "connector",
    ]);
    expect(options.find((option) => option.kind === "bot")?.subtitle).toBe("Bot");
    expect(options.find((option) => option.name === "Gmail")?.subtitle).toBe("Connected");
    expect(options.find((option) => option.name === "Stripe")?.subtitle).toBe("Needs auth");
    expect(options.find((option) => option.kind === "routine")?.subtitle).toMatch(/Weekdays/i);
  });

  it("disambiguates same-name routines with bot name", () => {
    const options = buildComposerMentionOptions({
      query: "daily",
      bots: [],
      groups: [],
      routines: [
        { id: "r1", name: "Daily", crons: ["0 9 * * *"], botId: "b1", botName: "Chief" },
        { id: "r2", name: "Daily", crons: ["0 10 * * *"], botId: "b2", botName: "Writer" },
      ],
      connectors: [],
    });
    expect(options).toHaveLength(2);
    expect(options[0]?.subtitle).toContain("Chief");
    expect(options[1]?.subtitle).toContain("Writer");
    expect(mentionChipKey(options[0]!)).toBe("routine:r1");
    expect(mentionChipKey(options[1]!)).toBe("routine:r2");
  });

  it("skips the current group", () => {
    const options = buildComposerMentionOptions({
      query: "",
      currentGroupId: "g1",
      bots: [],
      groups: [
        { id: "g1", name: "Here" },
        { id: "g2", name: "Elsewhere" },
      ],
      routines: [],
      connectors: [],
    });
    expect(options.map((option) => option.id)).toEqual(["g2"]);
  });
});

describe("partition and payload", () => {
  it("partitions typed mentions", () => {
    const parts = partitionComposerMentions([
      { kind: "bot", id: "b1", name: "Chief" },
      { kind: "group", id: "g1", name: "Planning" },
      { kind: "routine", id: "r1", name: "Digest" },
      { kind: "connector", id: "c1", name: "Gmail", authStatus: "connected", connectionId: "c1" },
      { kind: "everyone", id: "everyone", name: "everyone" },
    ]);
    expect(parts.bots).toHaveLength(1);
    expect(parts.groups).toHaveLength(1);
    expect(parts.routines).toHaveLength(1);
    expect(parts.connectors).toHaveLength(1);
    expect(parts.everyone).toBe(true);
  });

  it("omits needs-auth catalog connectors from API payload", () => {
    expect(
      toThreadMentionPayload([
        { kind: "bot", id: "b1", name: "Chief" },
        {
          kind: "connector",
          id: "catalog:stripe",
          name: "Stripe",
          authStatus: "needs_auth",
        },
        {
          kind: "connector",
          id: "c1",
          name: "Gmail",
          authStatus: "connected",
          connectionId: "c1",
        },
      ]),
    ).toEqual([
      { kind: "bot", id: "b1" },
      { kind: "connector", id: "c1" },
    ]);
  });
});

describe("strip and connector intent", () => {
  it("strips selected mention kinds from prompt text", () => {
    expect(
      stripMentionKinds(
        "@Planning @Chief check this",
        [
          { kind: "group", name: "Planning" },
          { kind: "bot", name: "Chief" },
        ],
        ["group"],
      ),
    ).toBe("@Chief check this");
  });

  it("strips multi-word mention tokens", () => {
    expect(stripMentionToken("Ask @Draft team please", "Draft team")).toBe("Ask please");
  });

  it("builds connector intent lines", () => {
    expect(connectorIntentLine(["Gmail", "Stripe"])).toBe(
      "Use these connectors if relevant: Gmail, Stripe.",
    );
    expect(appendConnectorIntent("check inbox", ["Gmail"])).toBe(
      "check inbox\n\nUse these connectors if relevant: Gmail.",
    );
    expect(appendConnectorIntent("", ["Gmail"])).toBe("Use these connectors if relevant: Gmail.");
  });

  it("formats routine subtitles", () => {
    expect(routineScheduleSubtitle(["0 9 * * 1-5"])).toMatch(/Weekdays/i);
    expect(routineScheduleSubtitle(["0 9 * * 1-5"], "Chief")).toContain("Chief");
  });
});
