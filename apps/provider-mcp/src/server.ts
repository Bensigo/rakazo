import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AdapterContext, ConnectorEvent, ManagedConnectorProvider } from "@rakazo/adapter-kit";
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

type ProviderMap = Record<"composio" | "pipedream", ManagedConnectorProvider | undefined>;
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

export function createProviderMcpServer(map: ProviderMap = providers()): McpServer {
  const server = new McpServer({ name: "rakazo-managed-provider", version: "0.1.0" });
  const run = async <T>(tool: string, fn: (provider: ManagedConnectorProvider, ctx: AdapterContext) => Promise<T>, input: { provider: z.infer<typeof ProviderSchema>; context: z.infer<typeof ContextSchema> }, signal: AbortSignal) => {
    const raw = await fn(providerFor(map, input.provider), context(input.context, signal));
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
  server.registerTool("catalog", { description: "List the managed provider app catalog.", inputSchema: ToolSchema.shape }, async (input, extra) => ok(await value("catalog", (p, c) => p.catalog(c, input.query), input, extra.signal)));
  server.registerTool("list_connected", { description: "List connected managed provider apps.", inputSchema: LifecycleSchema.shape }, async (input, extra) => ok(await value("list_connected", (p, c) => p.listConnectedExternalIds(c), input, extra.signal)));
  server.registerTool("discover", { description: "Discover authorized tools for a managed provider.", inputSchema: ToolSchema.omit({ query: true }).shape }, async (input, extra) => ok(await value("discover", (p, c) => p.discoverTools(c), input, extra.signal)));
  server.registerTool("connection_ready", { description: "Check whether a managed provider connection is ready.", inputSchema: LifecycleSchema.required({ externalId: true }).shape }, async (input, extra) => ok(await value("connection_ready", (p, c) => p.connectionReady(c, input.externalId), input, extra.signal)));
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
  return server;
}

async function body(request: IncomingMessage): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) { size += Buffer.byteLength(chunk); if (size > MAX_JSON) throw new Error("Request is too large"); chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function createProviderMcpHttpServer(options: { token: string; port?: number; host?: string; providers?: ProviderMap } = { token: process.env.MANAGED_PROVIDER_MCP_TOKEN ?? "" }) {
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
      const server = createProviderMcpServer(providerMap);
      await server.connect(transport);
      await transport.handleRequest(request, reply, await body(request));
    } catch (error) {
      if (!reply.headersSent) reply.writeHead(400, { "content-type": "application/json" });
      if (!reply.writableEnded) reply.end(JSON.stringify({ error: { code: "provider_request_failed", message: "Managed provider request failed" } }));
    }
  });
  return { http, listen: () => new Promise<void>((resolve) => http.listen(options.port ?? 3180, options.host ?? "127.0.0.1", resolve)), close: () => new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve())) };
}
