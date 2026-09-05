import assert from "node:assert/strict";
import { type AddressInfo } from "node:net";
import test from "node:test";
import type { AdapterContext, ConnectorCall, ManagedConnectorProvider } from "@rakazo/adapter-kit";
import { ManagedProviderMcpClient } from "@rakazo/adapters";
import { createProviderMcpHttpServer } from "./server.js";

const context: AdapterContext = {
  operationId: "op-1", traceId: "trace-1", spaceId: "space-1", userId: "user-1", botId: "bot-1", signal: new AbortController().signal,
};
const provider: ManagedConnectorProvider = {
  describe: () => ({ id: "composio", contractVersion: "1", adapterVersion: "test", capabilities: { discover: true, oauth: true, secretsBrokered: true } }),
  catalog: async () => [{ connectorId: "composio", slug: "github", name: "GitHub", logo: null, connected: true, noAuth: false }],
  listConnectedExternalIds: async () => ["github"],
  discoverTools: async () => [{ name: "issues.list", description: "List issues", inputSchema: { type: "object" }, route: { connectorId: "composio", toolName: "issues.list" } }],
  connectionReady: async () => true,
  begin: async () => ({ authorizationUrl: null, state: "github" }),
  complete: async () => ({ connectionRef: "github" }),
  revoke: async () => undefined,
  async *execute(call: ConnectorCall, seen: AdapterContext) {
    assert.equal(seen.spaceId, context.spaceId);
    assert.equal(seen.connectedConnections?.[0]?.externalId, "github-account");
    assert.equal(call.connectionId, "connection-1");
    yield { type: "result", data: { tool: call.tool, args: call.args } };
  },
};

test("managed provider MCP boundary authenticates and preserves calls without provider egress", async () => {
    const token = "t".repeat(32);
    const service = createProviderMcpHttpServer({ token, port: 0, providers: { composio: provider, pipedream: undefined } });
    await service.listen();
    const port = (service.http.address() as AddressInfo).port;
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      assert.deepEqual(await health.json(), { ok: true, service: "managed-provider-mcp", providers: { composio: true, pipedream: false } });
      const unauthorized = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", body: "{}" });
      assert.equal(unauthorized.status, 401);
      const client = new ManagedProviderMcpClient({ providerId: "composio", endpoint: `http://127.0.0.1:${port}/mcp`, token });
      assert.deepEqual(await client.catalog(context), [
        { connectorId: "composio", slug: "github", name: "GitHub", logo: null, connected: true, noAuth: false },
      ]);
      const events = [];
      for await (const event of client.execute({ tool: "issues.list", args: { limit: 1 }, connectionId: "connection-1", executionId: "exec-1", route: { connectorId: "composio", toolName: "issues.list" } }, { ...context, connectedConnections: [{ id: "connection-1", connectorId: "composio", externalId: "github-account", displayName: "GitHub" }] })) events.push(event);
      assert.deepEqual(events, [{ type: "result", data: { tool: "issues.list", args: { limit: 1 } } }]);
    } finally {
      await service.close();
    }
});

test("rejects malformed provider output and normalizes void lifecycle results", async () => {
  const token = "t".repeat(32);
  const malformed: ManagedConnectorProvider = { ...provider, catalog: async () => [{ bad: true }] as never };
  const service = createProviderMcpHttpServer({ token, port: 0, providers: { composio: malformed, pipedream: undefined } });
  await service.listen();
  const port = (service.http.address() as AddressInfo).port;
  try {
    const client = new ManagedProviderMcpClient({ providerId: "composio", endpoint: `http://127.0.0.1:${port}/mcp`, token });
    await assert.rejects(() => client.catalog(context), /invalid response|invalid catalog/i);
    await client.revoke("github", context);
  } finally {
    await service.close();
  }
});

test("rejects non-loopback HTTP unless explicitly enabled", () => {
  const token = "t".repeat(32);
  assert.throws(() => new ManagedProviderMcpClient({ providerId: "composio", endpoint: "http://provider-mcp:3180/mcp", token }), /HTTPS unless loopback/);
  assert.doesNotThrow(() => new ManagedProviderMcpClient({ providerId: "composio", endpoint: "http://provider-mcp:3180/mcp", token, allowInternalHttp: true }));
});
