import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AdapterContext, ConnectorEvent, ManagedConnectorProvider, MessagingSurface, NotificationMessage, NotificationProvider, TransactionalEmail, TransactionalEmailProvider } from "@rakazo/adapter-kit";
import { ComposioConnector, isComposioEnabled, isPipedreamEnabled, PipedreamConnector, pipedreamConfigFromEnv } from "@rakazo/adapters";
import { z } from "zod";

const MAX_ID = 200;
const MAX_JSON = 1_000_000;
const ContextSchema = z.object({
  operationId: z.string().min(1).max(MAX_ID), traceId: z.string().min(1).max(MAX_ID),
  spaceId: z.string().min(1).max(MAX_ID), userId: z.string().min(1).max(MAX_ID),
  botId: z.string().max(MAX_ID).optional(), runId: z.string().max(MAX_ID).optional(),
  connectedConnections: z.array(z.object({ id: z.string().min(1).max(MAX_ID), connectorId: z.string().min(1).max(MAX_ID), externalId: z.string().min(1).max(MAX_ID), displayName: z.string().max(MAX_ID), providerRef: z.string().max(MAX_ID).optional() })).max(100).optional(),
});
const ProviderSchema = z.enum(["composio", "pipedream"]);
const ToolSchema = z.object({ provider: ProviderSchema, context: ContextSchema, query: z.string().max(200).optional() });
const ExecuteSchema = z.object({ provider: ProviderSchema, context: ContextSchema, call: z.object({ tool: z.string().min(1).max(MAX_ID), args: z.record(z.string(), z.unknown()).default({}), connectionId: z.string().max(MAX_ID).optional(), executionId: z.string().min(1).max(MAX_ID), route: z.object({ connectorId: z.string().max(MAX_ID), toolName: z.string().max(MAX_ID), resourceId: z.string().max(MAX_ID).optional() }).optional() }) });
const LifecycleSchema = z.object({ provider: ProviderSchema, context: ContextSchema, externalId: z.string().min(1).max(MAX_ID).optional() });
const BeginSchema = z.object({ provider: ProviderSchema, context: ContextSchema, request: z.object({ provider: z.string().min(1).max(MAX_ID), redirectUrl: z.string().url().max(2_000) }) });
const CompleteSchema = z.object({ provider: ProviderSchema, context: ContextSchema, request: z.object({ state: z.string().min(1).max(MAX_ID), code: z.string().max(2_000).optional() }) });
const MessagingContextSchema = ContextSchema;
const MessagingSendSchema = z.object({ context: MessagingContextSchema, request: z.object({ threadId: z.string().min(1).max(MAX_ID), body: z.string().max(MAX_JSON) }) });
const MessagingOpenSchema = z.object({ context: MessagingContextSchema, provider: z.string().min(1).max(MAX_ID), address: z.string().min(1).max(MAX_ID) });
const MessagingTypingSchema = z.object({ context: MessagingContextSchema, threadId: z.string().min(1).max(MAX_ID) });
const WebhookSchema = z.object({ provider: z.string().min(1).max(MAX_ID), method: z.string().regex(/^[A-Z]+$/).max(12), url: z.string().url().max(2_000), headers: z.record(z.string(), z.string().max(20_000)).refine((h) => Object.keys(h).length <= 100), bodyBase64: z.string().max(MAX_JSON) });
const EmailSchema = z.object({ message: z.object({ to: z.string().email().max(320), subject: z.string().max(500), text: z.string().max(MAX_JSON), html: z.string().max(MAX_JSON).optional() }) });
const NotificationSchema = z.object({ token: z.string().min(1).max(500), message: z.object({ kind: z.enum(["completion", "failure", "help", "takeover"]), title: z.string().max(500), body: z.string().max(MAX_JSON), botId: z.string().min(1).max(MAX_ID), threadId: z.string().min(1).max(MAX_ID) }) });

type ProviderMap = Record<"composio" | "pipedream", ManagedConnectorProvider | undefined>;
export type ProviderMcpServices = { messagingFactory?: () => MessagingSurface; email?: TransactionalEmailProvider; notifications?: NotificationProvider; push?: (token: string, message: NotificationMessage, signal: AbortSignal) => Promise<void> };
function providers(): ProviderMap {
  const pipedreamConfig = pipedreamConfigFromEnv({
    pipedreamClientId: process.env.PIPEDREAM_CLIENT_ID,
    pipedreamClientSecret: process.env.PIPEDREAM_CLIENT_SECRET,
    pipedreamProjectId: process.env.PIPEDREAM_PROJECT_ID,
    pipedreamEnvironment: process.env.PIPEDREAM_ENVIRONMENT,
    encryptionKey: process.env.PIPEDREAM_IDENTITY_SECRET ?? process.env.ENCRYPTION_KEY ?? "",
  });
  return {
    composio: isComposioEnabled(process.env.COMPOSIO_API_KEY) ? new ComposioConnector() : undefined,
    pipedream: isPipedreamEnabled(pipedreamConfig) ? new PipedreamConnector(pipedreamConfig) : undefined,
  };
}
function context(input: z.infer<typeof ContextSchema>, signal: AbortSignal): AdapterContext {
  return { ...input, signal };
}
function providerFor(map: ProviderMap, id: z.infer<typeof ProviderSchema>): ManagedConnectorProvider {
  const provider = map[id];
  if (!provider) throw new Error(`Managed provider ${id} is not configured`);
  return provider;
}
function optionalProvider(map: ProviderMap, id: z.infer<typeof ProviderSchema>): ManagedConnectorProvider | undefined {
  return map[id];
}
function bounded(value: unknown): unknown {
  const text = JSON.stringify(value);
  if (text === undefined || text.length > MAX_JSON) throw new Error("Provider response is invalid or too large");
  return value;
}
function response(events: ConnectorEvent[]): { events: ConnectorEvent[] } {
  return bounded({ events }) as { events: ConnectorEvent[] };
}

const outputSchemas: Record<string, z.ZodTypeAny> = {
  catalog: z.array(z.object({ connectorId: z.string().min(1).max(MAX_ID), slug: z.string().min(1).max(MAX_ID), name: z.string().min(1).max(MAX_ID), logo: z.string().nullable(), connected: z.boolean(), noAuth: z.boolean() })),
  list_connected: z.array(z.string().min(1).max(MAX_ID)),
  discover: z.array(z.object({ name: z.string().min(1).max(MAX_ID), description: z.string().max(MAX_JSON), inputSchema: z.record(z.string(), z.unknown()), readOnly: z.boolean().optional(), route: z.object({ connectorId: z.string().min(1).max(MAX_ID), toolName: z.string().min(1).max(MAX_ID), resourceId: z.string().max(MAX_ID).optional() }).optional() })),
  connection_ready: z.boolean(),
  begin: z.object({ authorizationUrl: z.string().url().nullable(), state: z.string().min(1).max(MAX_ID) }),
  complete: z.object({ connectionRef: z.string().min(1).max(MAX_ID) }),
  revoke: z.null().or(z.undefined()),
};

export function createProviderMcpServer(map: ProviderMap = providers(), services: ProviderMcpServices = {}): McpServer {
  const server = new McpServer({ name: "rakazo-managed-provider", version: "0.1.0" });
  const run = async <T>(tool: string, fn: (provider: ManagedConnectorProvider, ctx: AdapterContext) => Promise<T>, input: { provider: z.infer<typeof ProviderSchema>; context: z.infer<typeof ContextSchema> }, signal: AbortSignal) => {
    let raw: T;
    try { raw = await fn(providerFor(map, input.provider), context(input.context, signal)); }
    catch (error) { if (signal.aborted) throw error; throw new Error("Managed provider operation failed"); }
    const result = bounded(raw === undefined ? null : raw);
    const schema = outputSchemas[tool];
    if (schema) {
      const parsed = schema.safeParse(result);
      if (!parsed.success) throw new Error(`Managed provider returned invalid ${tool} response`);
      return parsed.data;
    }
    return result;
  };
  const value = async <T>(tool: string, fn: (provider: ManagedConnectorProvider, ctx: AdapterContext) => Promise<T>, input: { provider: z.infer<typeof ProviderSchema>; context: z.infer<typeof ContextSchema> }, signal: AbortSignal) => ({ value: await run(tool, fn, input, signal) });
  const ok = <T>(structuredContent: T) => ({ content: [], structuredContent });
  server.registerTool("catalog", { description: "List the managed provider app catalog.", inputSchema: ToolSchema.shape }, async (input, extra) => {
    const p = optionalProvider(map, input.provider);
    return ok(p ? await value("catalog", (provider, c) => provider.catalog(c, input.query), input, extra.signal) : { value: [] });
  });
  server.registerTool("list_connected", { description: "List connected managed provider apps.", inputSchema: LifecycleSchema.shape }, async (input, extra) => {
    const p = optionalProvider(map, input.provider);
    return ok(p ? await value("list_connected", (provider, c) => provider.listConnectedExternalIds(c), input, extra.signal) : { value: [] });
  });
  server.registerTool("discover", { description: "Discover authorized tools for a managed provider.", inputSchema: ToolSchema.omit({ query: true }).shape }, async (input, extra) => {
    const p = optionalProvider(map, input.provider);
    return ok(p ? await value("discover", (provider, c) => provider.discoverTools(c), input, extra.signal) : { value: [] });
  });
  server.registerTool("connection_ready", { description: "Check whether a managed provider connection is ready.", inputSchema: LifecycleSchema.required({ externalId: true }).shape }, async (input, extra) => {
    const p = optionalProvider(map, input.provider);
    return ok(p ? await value("connection_ready", (provider, c) => provider.connectionReady(c, input.externalId), input, extra.signal) : { value: false });
  });
  server.registerTool("begin", { description: "Begin managed provider authorization.", inputSchema: BeginSchema.shape }, async (input, extra) => ok(await value("begin", (p, c) => p.begin(input.request, c), input, extra.signal)));
  server.registerTool("complete", { description: "Complete managed provider authorization.", inputSchema: CompleteSchema.shape }, async (input, extra) => ok(await value("complete", (p, c) => p.complete(input.request, c), input, extra.signal)));
  server.registerTool("revoke", { description: "Revoke a managed provider connection.", inputSchema: LifecycleSchema.required({ externalId: true }).shape }, async (input, extra) => ok(await value("revoke", (p, c) => p.revoke(input.externalId, c), input, extra.signal)));
  server.registerTool("execute", { description: "Execute one managed provider tool.", inputSchema: ExecuteSchema.shape }, async (input, extra) => {
    const events: ConnectorEvent[] = [];
    for await (const event of providerFor(map, input.provider).execute(input.call, context(input.context, extra.signal))) {
      const parsed = z.union([z.object({ type: z.literal("log"), message: z.string().max(MAX_JSON) }), z.object({ type: z.literal("result"), data: z.unknown() }), z.object({ type: z.literal("error"), message: z.string().max(MAX_JSON) })]).safeParse(event);
      if (!parsed.success) throw new Error("Managed provider returned an invalid execute event");
      events.push(parsed.data);
    }
    return { content: [], structuredContent: response(events) };
  });
  server.registerTool("messaging_platforms", { description: "List configured messaging platforms.", inputSchema: {} }, async () => ok({ value: services.messagingFactory?.().platforms() ?? [] }));
  server.registerTool("messaging_send", { description: "Send a message to an existing provider thread.", inputSchema: MessagingSendSchema.shape }, async (input, extra) => {
    if (!services.messagingFactory) throw new Error("Messaging provider is not configured");
    return ok({ value: await services.messagingFactory().sendToThread(input.request, context(input.context, extra.signal)) });
  });
  server.registerTool("messaging_open_direct", { description: "Open a provider direct thread.", inputSchema: MessagingOpenSchema.shape }, async (input, extra) => {
    if (!services.messagingFactory) throw new Error("Messaging provider is not configured");
    return ok({ value: await services.messagingFactory().openDirectThread(input.provider, input.address, context(input.context, extra.signal)) });
  });
  server.registerTool("messaging_typing", { description: "Send a best effort typing indicator.", inputSchema: MessagingTypingSchema.shape }, async (input, extra) => {
    if (!services.messagingFactory) throw new Error("Messaging provider is not configured");
    await services.messagingFactory().sendTyping(input.threadId, context(input.context, extra.signal));
    return ok({ value: null });
  });
  server.registerTool("messaging_webhook", { description: "Verify and translate one raw platform webhook.", inputSchema: WebhookSchema.shape }, async (input, extra) => {
    if (!services.messagingFactory) throw new Error("Messaging provider is not configured");
    const surface = services.messagingFactory();
    const events: unknown[] = [];
    surface.onInbound(async (event) => { events.push(event); });
    const bytes = Buffer.from(input.bodyBase64, "base64");
    if (bytes.length > MAX_JSON) throw new Error("Webhook body is too large");
    const request = new Request(input.url, { method: input.method, headers: input.headers, body: input.method === "GET" || input.method === "HEAD" ? undefined : bytes });
    const response = surface.handleWebhook(input.provider, request);
    if (!response) throw new Error("Messaging provider is not configured");
    const vendor = await response;
    const body = new Uint8Array(await vendor.arrayBuffer());
    if (body.byteLength > MAX_JSON) throw new Error("Webhook response is too large");
    const responseHeaders: Record<string, string> = {};
    vendor.headers.forEach((value, key) => { responseHeaders[key] = value; });
    return ok({ status: vendor.status, headers: responseHeaders, bodyBase64: Buffer.from(body).toString("base64"), events });
  });
  server.registerTool("email_send", { description: "Send transactional email.", inputSchema: EmailSchema.shape }, async (input) => {
    if (!services.email) throw new Error("Email provider is not configured");
    await services.email.send(input.message as TransactionalEmail); return ok({ value: null });
  });
  server.registerTool("email_drain", { description: "Drain accepted email deliveries.", inputSchema: {} }, async () => {
    if (!services.email?.drain) return ok({ value: null });
    await services.email.drain();
    return ok({ value: null });
  });
  server.registerTool("notification_send", { description: "Send one push notification.", inputSchema: NotificationSchema.shape }, async (input, extra) => {
    if (!services.push && !services.notifications) throw new Error("Notification provider is not configured");
    if (services.push) await services.push(input.token, input.message as NotificationMessage, extra.signal);
    else await services.notifications!.send(input.message as NotificationMessage, { operationId: "provider-mcp", traceId: "provider-mcp", spaceId: "internal", userId: "internal", signal: extra.signal });
    return ok({ value: null });
  });
  return server;
}

async function body(request: IncomingMessage): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) { size += Buffer.byteLength(chunk); if (size > MAX_JSON) throw new Error("Request is too large"); chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function createProviderMcpHttpServer(options: { token: string; port?: number; host?: string; providers?: ProviderMap; services?: ProviderMcpServices } = { token: process.env.MANAGED_PROVIDER_MCP_TOKEN ?? "" }) {
  if (!options.token || options.token.length < 32) throw new Error("MANAGED_PROVIDER_MCP_TOKEN must be at least 32 characters");
  const providerMap = options.providers ?? providers();
  const http = createServer(async (request, reply) => {
    if (request.url === "/health" && request.method === "GET") {
      reply.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, service: "managed-provider-mcp", providers: { composio: Boolean(providerMap.composio), pipedream: Boolean(providerMap.pipedream) } }));
      return;
    }
    if (request.url !== "/mcp" || request.method !== "POST") { reply.writeHead(404).end(); return; }
    if (request.headers.authorization !== `Bearer ${options.token}`) { reply.writeHead(401).end(); return; }
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = createProviderMcpServer(providerMap, options.services);
      await server.connect(transport);
      await transport.handleRequest(request, reply, await body(request));
    } catch (error) {
      if (!reply.headersSent) reply.writeHead(400, { "content-type": "application/json" });
      if (!reply.writableEnded) reply.end(JSON.stringify({ error: { code: "provider_request_failed", message: "Managed provider request failed" } }));
    }
  });
  return { http, listen: () => new Promise<void>((resolve) => http.listen(options.port ?? 3180, options.host ?? "127.0.0.1", resolve)), close: () => new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve())) };
}
