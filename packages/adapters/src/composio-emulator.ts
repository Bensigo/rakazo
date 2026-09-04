import type {
  AdapterContext,
  ConnectorCall,
  ConnectorEvent,
  ConnectorTool,
} from "@rakazo/adapter-kit";
import {
  type ComposioCatalogItem,
  type ComposioProvider,
  filterCatalog,
} from "./composio-connector.js";

const DEFAULT_CATALOG: ReadonlyArray<Omit<ComposioCatalogItem, "connected">> = [
  { slug: "GMAIL", name: "Gmail", logo: null, noAuth: false },
  { slug: "GOOGLECALENDAR", name: "Google Calendar", logo: null, noAuth: false },
  { slug: "GOOGLEDRIVE", name: "Google Drive", logo: null, noAuth: false },
  { slug: "SLACK", name: "Slack", logo: null, noAuth: false },
  { slug: "GITHUB", name: "GitHub", logo: null, noAuth: false },
  { slug: "NOTION", name: "Notion", logo: null, noAuth: false },
];

type MailMessage = {
  messageId: string;
  threadId: string;
  subject: string;
  sender: string;
  to: string;
  snippet: string;
  messageText: string;
  labelIds: string[];
  internalDate: string;
};

type MailDraft = {
  draftId: string;
  messageId: string;
  threadId: string;
  recipientEmail: string;
  subject: string;
  body: string;
};

type Mailbox = {
  messages: MailMessage[];
  drafts: MailDraft[];
  nextMessageSeq: number;
  nextDraftSeq: number;
};

const SYSTEM_LABELS = [
  { id: "INBOX", name: "INBOX", type: "system" },
  { id: "UNREAD", name: "UNREAD", type: "system" },
  { id: "SENT", name: "SENT", type: "system" },
  { id: "DRAFT", name: "DRAFT", type: "system" },
  { id: "STARRED", name: "STARRED", type: "system" },
  { id: "IMPORTANT", name: "IMPORTANT", type: "system" },
  { id: "SPAM", name: "SPAM", type: "system" },
  { id: "TRASH", name: "TRASH", type: "system" },
] as const;

const GMAIL_TOOLS: ConnectorTool[] = [
  {
    name: "GMAIL_FETCH_EMAILS",
    description: "Fetch email messages from the connected Gmail mailbox",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Gmail search query" },
        max_results: {
          type: "integer",
          description: "Maximum number of messages to return",
          minimum: 1,
          maximum: 500,
        },
        label_ids: {
          type: "array",
          items: { type: "string" },
          description: "Label IDs that messages must include",
        },
        include_spam_trash: { type: "boolean" },
        ids_only: { type: "boolean" },
      },
    },
  },
  {
    name: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
    description: "Fetch a single Gmail message by message id",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string", description: "Gmail message id" },
        format: {
          type: "string",
          enum: ["minimal", "metadata", "full", "raw"],
        },
      },
      required: ["message_id"],
    },
  },
  {
    name: "GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
    description: "Fetch messages belonging to a Gmail thread",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: { type: "string", description: "Gmail thread id" },
      },
      required: ["thread_id"],
    },
  },
  {
    name: "GMAIL_SEND_EMAIL",
    description: "Send an email through the connected Gmail account",
    inputSchema: {
      type: "object",
      properties: {
        recipient_email: { type: "string", description: "Primary recipient" },
        to: { type: "string", description: "Alias for recipient_email" },
        subject: { type: "string" },
        body: { type: "string" },
        cc: { type: "array", items: { type: "string" } },
        bcc: { type: "array", items: { type: "string" } },
        is_html: { type: "boolean" },
      },
      required: ["subject"],
    },
  },
  {
    name: "GMAIL_CREATE_EMAIL_DRAFT",
    description: "Create a Gmail draft, optionally as a reply in a thread",
    inputSchema: {
      type: "object",
      properties: {
        recipient_email: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        thread_id: {
          type: "string",
          description: "Existing thread to draft a reply in",
        },
        is_html: { type: "boolean" },
      },
    },
  },
  {
    name: "GMAIL_LIST_LABELS",
    description: "List system and user labels for the connected Gmail account",
    inputSchema: {
      type: "object",
      properties: {
        include_details: { type: "boolean" },
      },
    },
  },
];

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asPositiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    if (parsed > 0) return parsed;
  }
  return fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function seedMailbox(): Mailbox {
  const base = Date.UTC(2024, 0, 15, 12, 0, 0);
  return {
    messages: [
      {
        messageId: "18c5f5d1a2b3c4d5",
        threadId: "18c5f5d1a2b3c4d5",
        subject: "Welcome to Rakazo",
        sender: "hello@rakazo.test",
        to: "me@example.test",
        snippet: "Your inbox is ready for agent workflows.",
        messageText: "Your inbox is ready for agent workflows.\n\n— Rakazo",
        labelIds: ["INBOX", "UNREAD"],
        internalDate: String(base),
      },
      {
        messageId: "18c5f5d1a2b3c4d6",
        threadId: "18c5f5d1a2b3c4d6",
        subject: "Quarterly planning notes",
        sender: "teammate@example.test",
        to: "me@example.test",
        snippet: "Here are the notes from Monday's planning session.",
        messageText:
          "Here are the notes from Monday's planning session.\n\nAction items attached.",
        labelIds: ["INBOX"],
        internalDate: String(base + 86_400_000),
      },
      {
        messageId: "18c5f5d1a2b3c4d7",
        threadId: "18c5f5d1a2b3c4d6",
        subject: "Re: Quarterly planning notes",
        sender: "me@example.test",
        to: "teammate@example.test",
        snippet: "Thanks — I'll update the timeline today.",
        messageText: "Thanks — I'll update the timeline today.",
        labelIds: ["SENT"],
        internalDate: String(base + 90_000_000),
      },
    ],
    drafts: [],
    nextMessageSeq: 1,
    nextDraftSeq: 1,
  };
}

function matchesQuery(message: MailMessage, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  const haystack = [
    message.subject,
    message.sender,
    message.to,
    message.snippet,
    message.messageText,
    message.labelIds.join(" "),
  ]
    .join("\n")
    .toLowerCase();
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .every((token) => {
      const labeled = token.match(/^(from|to|subject|label):(.*)$/);
      if (!labeled) return haystack.includes(token);
      const [, field, value] = labeled;
      if (!value) return true;
      if (field === "from") return message.sender.toLowerCase().includes(value);
      if (field === "to") return message.to.toLowerCase().includes(value);
      if (field === "subject") return message.subject.toLowerCase().includes(value);
      if (field === "label") return message.labelIds.some((id) => id.toLowerCase() === value);
      return haystack.includes(token);
    });
}

function summarizeMessage(message: MailMessage, idsOnly: boolean) {
  if (idsOnly) {
    return { messageId: message.messageId, threadId: message.threadId };
  }
  return {
    messageId: message.messageId,
    threadId: message.threadId,
    subject: message.subject,
    sender: message.sender,
    to: message.to,
    snippet: message.snippet,
    labelIds: [...message.labelIds],
    internalDate: message.internalDate,
  };
}

function thinEmulatedTool(slug: string): ConnectorTool {
  return {
    name: `${slug}_EMULATED_ACTION`,
    description: `Run a deterministic ${slug} action`,
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
    },
  };
}

/** Deterministic, offline Composio catalog and connection emulator for product tests. */
export class ComposioEmulator implements ComposioProvider {
  private readonly connectedByUser = new Map<string, Set<string>>();
  private readonly mailboxesByUser = new Map<string, Mailbox>();
  readonly executions: Array<{
    userId: string;
    tool: string;
    args: Record<string, unknown>;
  }> = [];

  constructor(
    private readonly directory: ReadonlyArray<
      Omit<ComposioCatalogItem, "connected">
    > = DEFAULT_CATALOG,
  ) {}

  describe() {
    return {
      id: "composio",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { discover: true, oauth: true, secretsBrokered: true },
    };
  }

  async catalog(context: AdapterContext, query?: string) {
    const connected = this.connectedByUser.get(context.userId) ?? new Set<string>();
    return filterCatalog(
      this.directory.map((item) => ({ ...item, connected: connected.has(item.slug) })),
      query ?? "",
    ).map((item) => ({ ...item, connectorId: "composio" }));
  }

  async warmDirectory(): Promise<void> {}

  async listConnectedSlugs(userId: string): Promise<string[]> {
    return [...(this.connectedByUser.get(userId) ?? [])];
  }

  async listConnectedExternalIds(context: AdapterContext): Promise<string[]> {
    return this.listConnectedSlugs(context.userId);
  }

  async discoverTools(context: AdapterContext): Promise<ConnectorTool[]> {
    const connected =
      context.connectedConnections
        ?.filter((connection) => connection.connectorId === "composio")
        .map((connection) => connection.externalId) ??
      context.connectedProviders ??
      [];
    const tools: ConnectorTool[] = [];
    for (const slug of new Set(connected)) {
      if (slug === "GMAIL") {
        this.ensureMailbox(context.userId);
        tools.push(...GMAIL_TOOLS);
        continue;
      }
      tools.push(thinEmulatedTool(slug));
    }
    return tools;
  }

  async *execute(call: ConnectorCall, context: AdapterContext): AsyncIterable<ConnectorEvent> {
    this.executions.push({ userId: context.userId, tool: call.tool, args: call.args });
    if (call.tool.startsWith("GMAIL_")) {
      yield { type: "result", data: this.executeGmail(call.tool, call.args ?? {}, context.userId) };
      return;
    }
    yield { type: "result", data: { ok: true, tool: call.tool, args: call.args } };
  }

  async begin(
    request: { provider: string; redirectUrl: string },
    context: AdapterContext,
  ): Promise<{ authorizationUrl: string | null; state: string }> {
    const connected = this.connectedByUser.get(context.userId) ?? new Set<string>();
    connected.add(request.provider);
    this.connectedByUser.set(context.userId, connected);
    if (request.provider === "GMAIL") this.ensureMailbox(context.userId);
    return { authorizationUrl: null, state: request.provider };
  }

  async connectionReady(context: AdapterContext, slug: string): Promise<boolean> {
    return this.connectedByUser.get(context.userId)?.has(slug) ?? false;
  }

  async complete(
    request: { state: string; code?: string },
    _context: AdapterContext,
  ): Promise<{ connectionRef: string }> {
    return { connectionRef: request.state };
  }

  async revoke(connectionRef: string, context: AdapterContext): Promise<void> {
    this.connectedByUser.get(context.userId)?.delete(connectionRef);
    if (connectionRef === "GMAIL") this.mailboxesByUser.delete(context.userId);
  }

  /** Test helper: inspect the in-memory mailbox for a user. */
  mailboxFor(userId: string): Mailbox | undefined {
    return this.mailboxesByUser.get(userId);
  }

  private ensureMailbox(userId: string): Mailbox {
    const existing = this.mailboxesByUser.get(userId);
    if (existing) return existing;
    const seeded = seedMailbox();
    this.mailboxesByUser.set(userId, seeded);
    return seeded;
  }

  private nextIds(mailbox: Mailbox): { messageId: string; threadId: string } {
    const seq = mailbox.nextMessageSeq++;
    const hex = (0x18c5f5e0 + seq).toString(16);
    return { messageId: hex, threadId: hex };
  }

  private executeGmail(
    tool: string,
    args: Record<string, unknown>,
    userId: string,
  ): Record<string, unknown> {
    const mailbox = this.ensureMailbox(userId);
    switch (tool) {
      case "GMAIL_FETCH_EMAILS": {
        const query = asString(args.query);
        const maxResults = Math.min(asPositiveInt(args.max_results, 10), 500);
        const labelIds = asStringArray(args.label_ids);
        const includeSpamTrash = args.include_spam_trash === true;
        const idsOnly = args.ids_only === true;
        const messages = mailbox.messages
          .filter((message) => {
            if (
              !includeSpamTrash &&
              message.labelIds.some((id) => id === "SPAM" || id === "TRASH")
            ) {
              return false;
            }
            if (labelIds.length > 0 && !labelIds.every((id) => message.labelIds.includes(id))) {
              return false;
            }
            return matchesQuery(message, query);
          })
          .slice(0, maxResults)
          .map((message) => summarizeMessage(message, idsOnly));
        return {
          successful: true,
          data: {
            messages,
            resultSizeEstimate: messages.length,
          },
        };
      }
      case "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID": {
        const messageId = asString(args.message_id);
        const message = mailbox.messages.find((item) => item.messageId === messageId);
        if (!message) {
          return {
            successful: false,
            error: `Message not found: ${messageId}`,
            data: null,
          };
        }
        return {
          successful: true,
          data: {
            messageId: message.messageId,
            threadId: message.threadId,
            subject: message.subject,
            sender: message.sender,
            to: message.to,
            snippet: message.snippet,
            messageText: message.messageText,
            labelIds: [...message.labelIds],
            internalDate: message.internalDate,
          },
        };
      }
      case "GMAIL_FETCH_MESSAGE_BY_THREAD_ID": {
        const threadId = asString(args.thread_id);
        const messages = mailbox.messages
          .filter((message) => message.threadId === threadId)
          .map((message) => ({
            messageId: message.messageId,
            threadId: message.threadId,
            subject: message.subject,
            sender: message.sender,
            to: message.to,
            snippet: message.snippet,
            messageText: message.messageText,
            labelIds: [...message.labelIds],
            internalDate: message.internalDate,
          }));
        if (messages.length === 0) {
          return {
            successful: false,
            error: `Thread not found: ${threadId}`,
            data: { messages: [] },
          };
        }
        return { successful: true, data: { messages } };
      }
      case "GMAIL_SEND_EMAIL": {
        const recipient =
          asString(args.recipient_email) || asString(args.to) || asStringArray(args.cc)[0] || "";
        const subject = asString(args.subject);
        const body = asString(args.body);
        if (!recipient) {
          return {
            successful: false,
            error: "recipient_email (or to/cc/bcc) is required",
            data: null,
          };
        }
        if (!subject && !body) {
          return {
            successful: false,
            error: "subject or body is required",
            data: null,
          };
        }
        const ids = this.nextIds(mailbox);
        const message: MailMessage = {
          messageId: ids.messageId,
          threadId: ids.threadId,
          subject: subject || "(no subject)",
          sender: "me@example.test",
          to: recipient,
          snippet: body.slice(0, 120),
          messageText: body,
          labelIds: ["SENT"],
          internalDate: String(Date.UTC(2024, 5, 1, 15, 0, 0) + mailbox.nextMessageSeq * 1000),
        };
        mailbox.messages.push(message);
        return {
          successful: true,
          data: {
            messageId: message.messageId,
            threadId: message.threadId,
            labelIds: [...message.labelIds],
          },
        };
      }
      case "GMAIL_CREATE_EMAIL_DRAFT": {
        const recipient = asString(args.recipient_email);
        const subject = asString(args.subject);
        const body = asString(args.body);
        const replyThreadId = asString(args.thread_id);
        const ids = this.nextIds(mailbox);
        const threadId =
          replyThreadId && mailbox.messages.some((message) => message.threadId === replyThreadId)
            ? replyThreadId
            : ids.threadId;
        const draftId = `r${1_000_000_000 + mailbox.nextDraftSeq++}`;
        const draft: MailDraft = {
          draftId,
          messageId: ids.messageId,
          threadId,
          recipientEmail: recipient,
          subject,
          body,
        };
        mailbox.drafts.push(draft);
        mailbox.messages.push({
          messageId: draft.messageId,
          threadId: draft.threadId,
          subject: subject || "(no subject)",
          sender: "me@example.test",
          to: recipient,
          snippet: body.slice(0, 120),
          messageText: body,
          labelIds: ["DRAFT"],
          internalDate: String(Date.UTC(2024, 5, 1, 16, 0, 0) + mailbox.nextDraftSeq * 1000),
        });
        return {
          successful: true,
          data: {
            draft_id: draft.draftId,
            id: draft.draftId,
            message: {
              id: draft.messageId,
              threadId: draft.threadId,
            },
          },
        };
      }
      case "GMAIL_LIST_LABELS": {
        const includeDetails = args.include_details === true;
        const labels = SYSTEM_LABELS.map((label) => {
          if (!includeDetails) return { ...label };
          const matching = mailbox.messages.filter((message) =>
            message.labelIds.includes(label.id),
          );
          return {
            ...label,
            messagesTotal: matching.length,
            messagesUnread: matching.filter((message) => message.labelIds.includes("UNREAD"))
              .length,
            threadsTotal: new Set(matching.map((message) => message.threadId)).size,
            threadsUnread: new Set(
              matching
                .filter((message) => message.labelIds.includes("UNREAD"))
                .map((message) => message.threadId),
            ).size,
          };
        });
        return { successful: true, data: { labels } };
      }
      default:
        return {
          successful: false,
          error: `Unknown Gmail tool: ${tool}`,
          data: null,
        };
    }
  }
}
