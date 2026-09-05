import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  AdapterContext,
  ConnectorCall,
  ConnectorCatalogItem,
  ConnectorEvent,
  ConnectorTool,
  ManagedConnectorProvider,
} from "@rakazo/adapter-kit";

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
  if (!config.token || config.token.length < 32) throw new Error("Managed provider MCP token is invalid");
  const url = new URL(config.endpoint);
  const loopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (loopback || config.allowInternalHttp))) {
    throw new Error("Managed provider MCP endpoint must use HTTPS unless loopback");
  }
  if (url.username || url.password || url.hash) throw new Error("Managed provider MCP endpoint is invalid");
  return url;
}

function context(input: AdapterContext): Record<string, unknown> {
  const fields = [input.operationId, input.traceId, input.spaceId, input.userId];
  if (fields.some((value) => !value || value.length > MAX_ID)) throw new Error("Managed provider context is invalid");
  return {
    operationId: input.operationId,
    traceId: input.traceId,
    spaceId: input.spaceId,
    userId: input.userId,
    ...(input.botId ? { botId: input.botId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
  };
}

export class ManagedProviderMcpClient implements ManagedConnectorProvider {
  private readonly endpoint: URL;
  constructor(private readonly config: ManagedProviderMcpConfig) {
    this.endpoint = validateConfig(config);
  }

  describe() {
    return { id: this.config.providerId, contractVersion: "1", adapterVersion: "0.1.0", capabilities: { discover: true, oauth: true, secretsBrokered: true } };
  }

  async catalog(ctx: AdapterContext, query?: string): Promise<ConnectorCatalogItem[]> {
    return this.call("catalog", { provider: this.config.providerId, context: context(ctx), query }, ctx.signal) as Promise<ConnectorCatalogItem[]>;
  }
  async warmDirectory(): Promise<void> {}
  async listConnectedSlugs(userId: string): Promise<string[]> {
    return this.listConnectedExternalIds({ operationId: "catalog", traceId: "catalog", spaceId: "managed", userId, signal: new AbortController().signal });
  }
  async listConnectedExternalIds(ctx: AdapterContext): Promise<string[]> {
    return this.call("list_connected", { provider: this.config.providerId, context: context(ctx) }, ctx.signal) as Promise<string[]>;
  }
  async discoverTools(ctx: AdapterContext): Promise<ConnectorTool[]> {
    return this.call("discover", { provider: this.config.providerId, context: context(ctx) }, ctx.signal) as Promise<ConnectorTool[]>;
  }
  async connectionReady(ctx: AdapterContext, externalId: string): Promise<boolean> {
    return this.call("connection_ready", { provider: this.config.providerId, context: context(ctx), externalId }, ctx.signal) as Promise<boolean>;
  }
  async begin(request: { provider: string; redirectUrl: string }, ctx: AdapterContext): Promise<{ authorizationUrl: string | null; state: string }> {
    return this.call("begin", { provider: this.config.providerId, context: context(ctx), request }, ctx.signal) as Promise<{ authorizationUrl: string | null; state: string }>;
  }
  async complete(request: { state: string; code?: string }, ctx: AdapterContext): Promise<{ connectionRef: string }> {
    return this.call("complete", { provider: this.config.providerId, context: context(ctx), request }, ctx.signal) as Promise<{ connectionRef: string }>;
  }
  async revoke(connectionRef: string, ctx: AdapterContext): Promise<void> {
    await this.call("revoke", { provider: this.config.providerId, context: context(ctx), externalId: connectionRef }, ctx.signal);
  }
  async *execute(call: ConnectorCall, ctx: AdapterContext): AsyncIterable<ConnectorEvent> {
    const result = await this.call("execute", { provider: this.config.providerId, context: context(ctx), call }, ctx.signal) as { events: ConnectorEvent[] };
    for (const event of result.events) yield event;
  }

  private async call(tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    const transport = new StreamableHTTPClientTransport(this.endpoint, {
      requestInit: { headers: { authorization: `Bearer ${this.config.token}` }, redirect: "manual", signal },
      fetch: this.config.fetch ?? globalThis.fetch,
    });
    const client = new Client({ name: "rakazo-managed-provider-proxy", version: "0.1.0" }, { capabilities: {} });
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: tool, arguments: args }, undefined, { signal });
      if (result.isError) throw new Error(readText(result.content) ?? "Managed provider failed");
      const value = (result.structuredContent as { value?: unknown } | undefined)?.value ?? result.structuredContent;
      const serialized = JSON.stringify(value);
      if (serialized.length > MAX_RESPONSE_BYTES) throw new Error("Managed provider response is too large");
      return value;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]") : "Managed provider request failed");
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
  }
}

function readText(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.find((item): item is { text: string } => Boolean(item && typeof item === "object" && "text" in item && typeof (item as { text?: unknown }).text === "string"))?.text;
}
