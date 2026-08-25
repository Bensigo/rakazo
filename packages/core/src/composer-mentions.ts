import { formatCron } from "./cron.js";
import { hasMentionToken } from "./group-mentions.js";

export const COMPOSER_MENTION_KINDS = ["bot", "group", "routine", "connector", "everyone"] as const;

export type ComposerMentionKind = (typeof COMPOSER_MENTION_KINDS)[number];

/** Chip selected in the composer `@` picker. */
export type ComposerMention = {
  kind: ComposerMentionKind;
  id: string;
  name: string;
  subtitle?: string;
  color?: string;
  /** Owning bot for routine chips (test-run lands on that bot). */
  botId?: string;
  /** Connected connection row id when kind is connector + connected. */
  connectionId?: string;
  authStatus?: "connected" | "needs_auth";
};

export type MentionPickerBot = { id: string; name: string; color?: string };
export type MentionPickerGroup = { id: string; name: string };
export type MentionPickerRoutine = {
  id: string;
  name: string;
  crons: string[];
  botId: string;
  botName?: string;
};
export type MentionPickerConnector = {
  id: string;
  name: string;
  authStatus: "connected" | "needs_auth";
  connectionId?: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mentionChipKey(mention: Pick<ComposerMention, "kind" | "id">): string {
  return `${mention.kind}:${mention.id}`;
}

export function stripMentionToken(text: string, mentionName: string): string {
  const normalized = mentionName.trim();
  if (!normalized) return text.trim();
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_-])@${escapeRegExp(normalized)}(?![\\p{L}\\p{N}_-])`,
    "giu",
  );
  return text
    .replace(pattern, (_match, prefix: string) => prefix ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripMentionKinds(
  text: string,
  mentions: readonly Pick<ComposerMention, "kind" | "name">[],
  kinds: readonly ComposerMentionKind[],
): string {
  let result = text;
  for (const mention of mentions) {
    if (kinds.includes(mention.kind)) {
      result = stripMentionToken(result, mention.name);
    }
  }
  return result.trim();
}

export function partitionComposerMentions(mentions: readonly ComposerMention[]) {
  const bots: ComposerMention[] = [];
  const groups: ComposerMention[] = [];
  const routines: ComposerMention[] = [];
  const connectors: ComposerMention[] = [];
  let everyone = false;
  for (const mention of mentions) {
    if (mention.kind === "bot") bots.push(mention);
    else if (mention.kind === "group") groups.push(mention);
    else if (mention.kind === "routine") routines.push(mention);
    else if (mention.kind === "connector") connectors.push(mention);
    else if (mention.kind === "everyone") everyone = true;
  }
  return { bots, groups, routines, connectors, everyone };
}

/** Payload entries for `threads/send` mentions (legacy bare bot ids still accepted). */
export function toThreadMentionPayload(
  mentions: readonly ComposerMention[],
): Array<string | { kind: "bot" | "group" | "routine" | "connector"; id: string }> {
  const payload: Array<string | { kind: "bot" | "group" | "routine" | "connector"; id: string }> =
    [];
  for (const mention of mentions) {
    if (mention.kind === "everyone") continue;
    if (mention.kind === "bot") {
      payload.push({ kind: "bot", id: mention.id });
      continue;
    }
    if (mention.kind === "group") {
      payload.push({ kind: "group", id: mention.id });
      continue;
    }
    if (mention.kind === "routine") {
      payload.push({ kind: "routine", id: mention.id });
      continue;
    }
    if (mention.kind === "connector") {
      const connectionId = mention.connectionId ?? mention.id;
      if (mention.authStatus === "needs_auth" && !mention.connectionId) continue;
      if (!connectionId || connectionId.startsWith("catalog:")) continue;
      payload.push({ kind: "connector", id: connectionId });
    }
  }
  return payload;
}

export function connectorIntentLine(names: readonly string[]): string {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (unique.length === 0) return "";
  return `Use these connectors if relevant: ${unique.join(", ")}.`;
}

/** Names that need a client-side connector line (not yet a owned connection row). */
export function needsAuthConnectorNames(mentions: readonly ComposerMention[]): string[] {
  return mentions
    .filter((mention) => mention.kind === "connector" && mention.authStatus === "needs_auth")
    .map((mention) => mention.name);
}

export function appendConnectorIntent(text: string, names: readonly string[]): string {
  const line = connectorIntentLine(names);
  if (!line) return text.trim();
  const trimmed = text.trim();
  return trimmed ? `${trimmed}\n\n${line}` : line;
}

export function routineScheduleSubtitle(crons: readonly string[], botName?: string): string {
  const schedule = crons.map((cron) => formatCron(cron)).join(" · ");
  if (botName?.trim()) return `${schedule} · ${botName.trim()}`;
  return schedule;
}

export function buildComposerMentionOptions(input: {
  query: string;
  bots: readonly MentionPickerBot[];
  groups: readonly MentionPickerGroup[];
  routines: readonly MentionPickerRoutine[];
  connectors: readonly MentionPickerConnector[];
  currentGroupId?: string | null;
  includeEveryone?: boolean;
  limit?: number;
}): ComposerMention[] {
  const query = input.query.trim().toLowerCase();
  const limit = input.limit ?? 12;
  const options: ComposerMention[] = [];

  const matches = (name: string) => !query || name.toLowerCase().startsWith(query);

  if (input.includeEveryone && matches("everyone")) {
    options.push({
      kind: "everyone",
      id: "everyone",
      name: "everyone",
      subtitle: "Everyone in this group",
      color: "#85858A",
    });
  }

  for (const bot of input.bots) {
    if (!matches(bot.name)) continue;
    options.push({
      kind: "bot",
      id: bot.id,
      name: bot.name,
      subtitle: "Bot",
      color: bot.color,
    });
  }

  for (const group of input.groups) {
    if (input.currentGroupId && group.id === input.currentGroupId) continue;
    if (!matches(group.name)) continue;
    options.push({
      kind: "group",
      id: group.id,
      name: group.name,
      subtitle: "Group",
    });
  }

  const routineNameCounts = new Map<string, number>();
  for (const routine of input.routines) {
    const key = routine.name.toLowerCase();
    routineNameCounts.set(key, (routineNameCounts.get(key) ?? 0) + 1);
  }
  for (const routine of input.routines) {
    if (!matches(routine.name)) continue;
    const duplicate = (routineNameCounts.get(routine.name.toLowerCase()) ?? 0) > 1;
    options.push({
      kind: "routine",
      id: routine.id,
      name: routine.name,
      botId: routine.botId,
      subtitle: routineScheduleSubtitle(routine.crons, duplicate ? routine.botName : undefined),
    });
  }

  for (const connector of input.connectors) {
    if (!matches(connector.name)) continue;
    options.push({
      kind: "connector",
      id: connector.id,
      name: connector.name,
      connectionId: connector.connectionId,
      authStatus: connector.authStatus,
      subtitle: connector.authStatus === "connected" ? "Connected" : "Needs auth",
    });
  }

  return options.slice(0, limit);
}

export function mentionStillInPrompt(
  text: string,
  mention: Pick<ComposerMention, "name">,
): boolean {
  return hasMentionToken(text, mention.name);
}
