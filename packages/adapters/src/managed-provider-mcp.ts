import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  AdapterContext,
  ConnectorCall,
  ConnectorCatalogItem,
  ConnectorEvent,
  ConnectorTool,
  ManagedConnectorProvider,
  MessagingPlatformDescriptor,
  MessagingSendRequest,
  MessagingSendResult,
  MessagingSurface,
  NotificationMessage,
  NotificationProvider,
  TransactionalEmail,
  TransactionalEmailProvider,
} from "@rakazo/adapter-kit";
import { z } from "zod";

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_ID = 200;

export interface ManagedProviderMcpConfig {
  providerId: "composio" | "pipedream";
  endpoint: string;
  token: string;
  allowInternalHttp?: boolean;
  fetch?: typeof globalThis.fetch;
}

function validateConfig(config: ManagedProviderMcpConfig): URL {
  if (!config.token || config.token.length < 32)
    throw new Error("Managed provider MCP token is invalid");
  const url = new URL(config.endpoint);
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && (loopback || config.allowInternalHttp))
  ) {
    throw new Error("Managed provider MCP endpoint must use HTTPS unless loopback");
  }
  if (url.username || url.password || url.hash)
    throw new Error("Managed provider MCP endpoint is invalid");
  return url;
}

function context(input: AdapterContext): Record<string, unknown> {
  const fields = [input.operationId, input.traceId, input.spaceId, input.userId];
  if (fields.some((value) => !value || value.length > MAX_ID))
    throw new Error("Managed provider context is invalid");
  return {
    operationId: input.operationId,
    traceId: input.traceId,
    spaceId: input.spaceId,
    userId: input.userId,
    ...(input.botId ? { botId: input.botId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.connectedConnections ? { connectedConnections: input.connectedConnections } : {}),
  };
}

export class ManagedProviderMcpClient implements ManagedConnectorProvider {
  private readonly endpoint: URL;
  constructor(private readonly config: ManagedProviderMcpConfig) {
    this.endpoint = validateConfig(config);
  }

  describe() {
    return {
      id: this.config.providerId,
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { discover: true, oauth: true, secretsBrokered: true },
    };
  }
  async capabilities(signal = new AbortController().signal): Promise<{
    messaging: boolean;
    email: boolean;
    push: boolean;
    composio: boolean;
    pipedream: boolean;
  }> {
    return parse(
      z.object({
        messaging: z.boolean(),
        email: z.boolean(),
        push: z.boolean(),
        composio: z.boolean(),
        pipedream: z.boolean(),
      }),
      await this.call("capabilities", {}, signal),
    );
  }

  async catalog(ctx: AdapterContext, query?: string): Promise<ConnectorCatalogItem[]> {
    return this.call(
      "catalog",
      { provider: this.config.providerId, context: context(ctx), query },
      ctx.signal,
    ).then((value) =>
      parse(
        z.array(
          z.object({
            connectorId: z.string(),
            slug: z.string(),
            name: z.string(),
            logo: z.string().nullable(),
            connected: z.boolean(),
            noAuth: z.boolean(),
          }),
        ),
        value,
      ),
    );
  }
  async warmDirectory(): Promise<void> {}
  async listConnectedSlugs(userId: string): Promise<string[]> {
    return this.listConnectedExternalIds({
      operationId: "catalog",
      traceId: "catalog",
      spaceId: "managed",
      userId,
      signal: new AbortController().signal,
    });
  }
  async listConnectedExternalIds(ctx: AdapterContext): Promise<string[]> {
    return this.call(
      "list_connected",
      { provider: this.config.providerId, context: context(ctx) },
      ctx.signal,
    ).then((value) => parse(z.array(z.string()), value));
  }
  async discoverTools(ctx: AdapterContext): Promise<ConnectorTool[]> {
    return this.call(
      "discover",
      { provider: this.config.providerId, context: context(ctx) },
      ctx.signal,
    ).then((value) =>
      parse(
        z.array(
          z.object({
            name: z.string(),
            description: z.string(),
            inputSchema: z.record(z.string(), z.unknown()),
            readOnly: z.boolean().optional(),
            route: z
              .object({
                connectorId: z.string(),
                toolName: z.string(),
                resourceId: z.string().optional(),
              })
              .optional(),
          }),
        ),
        value,
      ),
    );
  }
  async connectionReady(ctx: AdapterContext, externalId: string): Promise<boolean> {
    return this.call(
      "connection_ready",
      { provider: this.config.providerId, context: context(ctx), externalId },
      ctx.signal,
    ).then((value) => parse(z.boolean(), value));
  }
  async begin(
    request: { provider: string; redirectUrl: string },
    ctx: AdapterContext,
  ): Promise<{ authorizationUrl: string | null; state: string }> {
    return this.call(
      "begin",
      { provider: this.config.providerId, context: context(ctx), request },
      ctx.signal,
    ).then((value) =>
      parse(
        z.object({ authorizationUrl: z.string().url().nullable(), state: z.string().min(1) }),
        value,
      ),
    );
  }
  async complete(
    request: { state: string; code?: string },
    ctx: AdapterContext,
  ): Promise<{ connectionRef: string }> {
    return this.call(
      "complete",
      { provider: this.config.providerId, context: context(ctx), request },
      ctx.signal,
    ).then((value) => parse(z.object({ connectionRef: z.string().min(1) }), value));
  }
  async revoke(connectionRef: string, ctx: AdapterContext): Promise<void> {
    await this.call(
      "revoke",
      { provider: this.config.providerId, context: context(ctx), externalId: connectionRef },
      ctx.signal,
    );
  }
  async *execute(call: ConnectorCall, ctx: AdapterContext): AsyncIterable<ConnectorEvent> {
    const result = parse(
      z.object({
        events: z.array(
          z.union([
            z.object({ type: z.literal("log"), message: z.string() }),
            z.object({ type: z.literal("result"), data: z.unknown() }),
            z.object({ type: z.literal("error"), message: z.string() }),
          ]),
        ),
      }),
      await this.call(
        "execute",
        { provider: this.config.providerId, context: context(ctx), call },
        ctx.signal,
      ),
    );
    for (const event of result.events) yield event;
  }

  async call(tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const transport = new StreamableHTTPClientTransport(this.endpoint, {
      requestInit: {
        headers: { authorization: `Bearer ${this.config.token}` },
        redirect: "manual",
        signal,
      },
      fetch: this.config.fetch ?? globalThis.fetch,
    });
    const client = new Client(
      { name: "rakazo-managed-provider-proxy", version: "0.1.0" },
      { capabilities: {} },
    );
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: tool, arguments: args }, undefined, { signal });
      if (result.isError) throw new Error(readText(result.content) ?? "Managed provider failed");
      const value =
        (result.structuredContent as { value?: unknown } | undefined)?.value ??
        result.structuredContent;
      const serialized = JSON.stringify(value);
      if (serialized === undefined || serialized.length > MAX_RESPONSE_BYTES)
        throw new Error("Managed provider response is invalid or too large");
      return value;
    } catch (error) {
      throw sanitizeManagedProviderError(error, signal);
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  }
}

function abortedError(): Error {
  const error = new Error("Managed provider request aborted");
  error.name = "AbortError";
  return error;
}

export function sanitizeManagedProviderError(error: unknown, signal: AbortSignal): Error {
  if (signal.aborted) return abortedError();
  const message = error instanceof Error ? error.message : "";
  const safeMessages = new Set([
    "Managed provider operation failed",
    "Managed provider request failed",
    "Managed provider response is invalid or too large",
    "Managed provider returned an invalid execute event",
    "Managed delivery operation failed",
  ]);
  if (
    safeMessages.has(message) ||
    /^Managed provider returned invalid [a-z_]+ response$/.test(message)
  ) {
    return new Error(message);
  }
  return new Error("Managed provider request failed");
}

export class ManagedMessagingMcpClient implements MessagingSurface {
  private descriptors: MessagingPlatformDescriptor[] = [];
  private sink?: (event: import("@rakazo/adapter-kit").MessagingInboundEvent) => Promise<void>;
  constructor(private readonly rpc: ManagedProviderMcpClient) {}
  describe() {
    return {
      id: "managed-messaging-mcp",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { providers: this.descriptors.map(({ provider }) => provider) },
    };
  }
  platforms(): MessagingPlatformDescriptor[] {
    return this.descriptors;
  }
  async refreshPlatforms(signal = new AbortController().signal): Promise<void> {
    this.descriptors = parse(
      z.array(
        z.object({
          provider: z.string(),
          capabilities: z.object({ direct: z.boolean(), groups: z.boolean(), typing: z.boolean() }),
        }),
      ),
      await this.rpc.call("messaging_platforms", {}, signal),
    );
  }
  onInbound(
    sink: (event: import("@rakazo/adapter-kit").MessagingInboundEvent) => Promise<void>,
  ): void {
    this.sink = sink;
  }
  handleWebhook(provider: string, request: Request): Promise<Response> | null {
    return this.forwardWebhook(provider, request);
  }
  private async forwardWebhook(provider: string, request: Request): Promise<Response> {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const result = parse(
      z.object({
        status: z.number().int().min(100).max(599),
        headers: z.record(z.string(), z.string()),
        bodyBase64: z.string(),
        events: z.array(z.unknown()),
      }),
      await this.rpc.call(
        "messaging_webhook",
        {
          provider,
          method: request.method,
          url: request.url,
          headers: Object.fromEntries(request.headers),
          bodyBase64: Buffer.from(bytes).toString("base64"),
        },
        request.signal,
      ),
    );
    for (const event of result.events) {
      const parsed = parse(
        z.union([
          z.object({ type: z.literal("message") }).passthrough(),
          z.object({ type: z.literal("status") }).passthrough(),
        ]),
        event,
      );
      try {
        await this.sink?.(parsed as unknown as import("@rakazo/adapter-kit").MessagingInboundEvent);
      } catch (error) {
        if (request.signal.aborted) throw error;
        throw new Error("Managed delivery operation failed");
      }
    }
    return new Response(Buffer.from(result.bodyBase64, "base64"), {
      status: result.status,
      headers: result.headers,
    });
  }
  async sendToThread(
    request: MessagingSendRequest,
    context: AdapterContext,
  ): Promise<MessagingSendResult> {
    return parse(
      z.object({ handle: z.string() }),
      await this.rpc.call(
        "messaging_send",
        { request, context: contextPayload(context) },
        context.signal,
      ),
    );
  }
  async openDirectThread(
    provider: string,
    address: string,
    context: AdapterContext,
  ): Promise<string> {
    return parse(
      z.string(),
      await this.rpc.call(
        "messaging_open_direct",
        { provider, address, context: contextPayload(context) },
        context.signal,
      ),
    );
  }
  async sendTyping(threadId: string, context: AdapterContext): Promise<void> {
    await this.rpc.call(
      "messaging_typing",
      { threadId, context: contextPayload(context) },
      context.signal,
    );
  }
}

export class ManagedEmailMcpClient implements TransactionalEmailProvider {
  constructor(private readonly rpc: ManagedProviderMcpClient) {}
  describe() {
    return {
      id: "managed-email-mcp",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { transactional: true },
    };
  }
  async send(message: TransactionalEmail): Promise<void> {
    await this.rpc.call("email_send", { message }, new AbortController().signal);
  }
  async drain(): Promise<void> {
    await this.rpc.call("email_drain", {}, new AbortController().signal);
  }
}

export class ManagedNotificationMcpClient implements NotificationProvider {
  constructor(
    private readonly rpc: ManagedProviderMcpClient,
    private readonly token: (userId: string) => Promise<string | undefined>,
  ) {}
  describe() {
    return {
      id: "managed-notification-mcp",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { push: true, email: false },
    };
  }
  async send(message: NotificationMessage, context: AdapterContext): Promise<void> {
    const token = await this.token(context.userId);
    if (!token) return;
    await this.rpc.call("notification_send", { token, message }, context.signal);
  }
}

function contextPayload(input: AdapterContext): Record<string, unknown> {
  return {
    operationId: input.operationId,
    traceId: input.traceId,
    spaceId: input.spaceId,
    userId: input.userId,
    ...(input.botId ? { botId: input.botId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
  };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("Managed provider returned an invalid response");
  return parsed.data;
}

function readText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.find((item): item is { text: string } =>
    Boolean(
      item &&
        typeof item === "object" &&
        "text" in item &&
        typeof (item as { text?: unknown }).text === "string",
    ),
  )?.text;
}
