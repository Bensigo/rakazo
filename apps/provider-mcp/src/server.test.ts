import assert from "node:assert/strict";
import { type AddressInfo } from "node:net";
import test from "node:test";
import type { AdapterContext, ConnectorCall, ManagedConnectorProvider } from "@rakazo/adapter-kit";
import { ManagedEmailMcpClient, ManagedMessagingMcpClient, ManagedNotificationMcpClient, ManagedProviderMcpClient, sanitizeManagedProviderError } from "@rakazo/adapters";
import { createProviderMcpHttpServer, deliveryRun } from "./server.js";
import type { MessagingSurface } from "@rakazo/adapter-kit";

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
    assert.deepEqual(await client.capabilities(), { messaging: false, email: false, push: false, composio: true, pipedream: false });
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

test("disabled providers have empty read capabilities but fail closed for mutations", async () => {
  const token = "t".repeat(32);
  const service = createProviderMcpHttpServer({ token, port: 0, providers: { composio: undefined, pipedream: undefined } });
  await service.listen();
  const port = (service.http.address() as AddressInfo).port;
  try {
    const client = new ManagedProviderMcpClient({ providerId: "composio", endpoint: `http://127.0.0.1:${port}/mcp`, token });
    assert.deepEqual(await client.capabilities(), { messaging: false, email: false, push: false, composio: false, pipedream: false });
    assert.deepEqual(await client.catalog(context), []);
    assert.deepEqual(await client.listConnectedExternalIds(context), []);
    assert.deepEqual(await client.discoverTools(context), []);
    assert.equal(await client.connectionReady(context, "missing"), false);
    await assert.rejects(() => client.begin({ provider: "github", redirectUrl: "https://example.test/callback" }, context), /operation failed|request failed|not configured/i);
    await assert.rejects(async () => { for await (const _event of client.execute({ tool: "x", args: {}, executionId: "x" }, context)) {} }, /operation failed|request failed|not configured/i);
    await assert.rejects(() => client.revoke("missing", context), /operation failed|request failed|not configured/i);
  } finally {
    await service.close();
  }
});

test("MCP preserves raw webhook ACK/events and isolates concurrent collectors", async () => {
  const token = "t".repeat(32);
  const sinks: Array<(event: any) => Promise<void>> = [];
  const fake = (): MessagingSurface => {
    let sink: ((event: any) => Promise<void>) | undefined;
    const surface: MessagingSurface = {
      describe: () => ({ id: "fake", contractVersion: "1", adapterVersion: "test", capabilities: { providers: ["fake"] } }),
      platforms: () => [{ provider: "fake", capabilities: { direct: true, groups: false, typing: false } }],
      onInbound: (next) => { sink = next; sinks.push(next); },
      handleWebhook: async (_provider, request) => { const body = await request.text(); await sink?.({ type: "message", provider: "fake", handle: body, threadId: "fake:dm", isDirect: true, from: "u", fromLabel: null, channelName: null, participants: [], content: body, mediaUrl: null }); return new Response("ACK:" + body, { status: 202, headers: { "x-provider": "fake" } }); },
      sendToThread: async () => ({ handle: "sent" }), openDirectThread: async () => "fake:dm", sendTyping: async () => undefined,
    };
    return surface;
  };
  const service = createProviderMcpHttpServer({ token, port: 0, providers: { composio: undefined, pipedream: undefined }, services: { messagingFactory: fake } });
  await service.listen();
  const port = (service.http.address() as AddressInfo).port;
  try {
    const rpc = new ManagedProviderMcpClient({ providerId: "composio", endpoint: `http://127.0.0.1:${port}/mcp`, token });
    const left = new ManagedMessagingMcpClient(rpc);
    const right = new ManagedMessagingMcpClient(rpc);
    const leftEvents: unknown[] = []; const rightEvents: unknown[] = [];
    left.onInbound(async (event) => { leftEvents.push(event); }); right.onInbound(async (event) => { rightEvents.push(event); });
    const [leftResponse, rightResponse] = await Promise.all([
      left.handleWebhook("fake", new Request("https://fake.test/hook", { method: "POST", body: "left" }))!,
      right.handleWebhook("fake", new Request("https://fake.test/hook", { method: "POST", body: "right" }))!,
    ]);
    assert.equal(await leftResponse.text(), "ACK:left"); assert.equal(await rightResponse.text(), "ACK:right");
    assert.equal(leftEvents.length, 1); assert.equal(rightEvents.length, 1);
    assert.equal((leftEvents[0] as { handle: string }).handle, "left"); assert.equal((rightEvents[0] as { handle: string }).handle, "right");
    assert.equal(sinks.length, 2);
  } finally { await service.close(); }
});

test("MCP routes email and scoped push token without persisting it", async () => {
  const token = "t".repeat(32); let emailCount = 0; let pushToken = "";
  const service = createProviderMcpHttpServer({ token, port: 0, providers: { composio: undefined, pipedream: undefined }, services: {
    email: { describe: () => ({ id: "fake-email", contractVersion: "1", adapterVersion: "test", capabilities: { transactional: true } }), send: async () => { emailCount += 1; }, drain: async () => undefined },
    push: async (destination, message) => { pushToken = destination; assert.equal(message.botId, "bot-1"); },
  } });
  await service.listen(); const port = (service.http.address() as AddressInfo).port;
  try {
    const rpc = new ManagedProviderMcpClient({ providerId: "composio", endpoint: `http://127.0.0.1:${port}/mcp`, token });
    const email = new ManagedEmailMcpClient(rpc); await email.send({ to: "person@example.com", subject: "Hello", text: "Body" }); await email.drain();
    const notification = new ManagedNotificationMcpClient(rpc, async (userId) => userId === "user-1" ? "ExponentPushToken[secret]" : undefined);
    await notification.send({ kind: "completion", title: "Done", body: "Finished", botId: "bot-1", threadId: "thread-1" }, { ...context, userId: "user-1" });
    assert.equal(emailCount, 1); assert.equal(pushToken, "ExponentPushToken[secret]");
  } finally { await service.close(); }
});

test("delivery failures never expose provider secrets or inbound event data", async () => {
  const token = "t".repeat(32);
  const secret = "https://secret.example.test/hook?token=private-signing-material";
  const failingMessaging = (): MessagingSurface => {
    let sink: ((event: any) => Promise<void>) | undefined;
    return {
    describe: () => ({ id: "fake", contractVersion: "1", adapterVersion: "test", capabilities: { providers: ["fake"] } }),
    platforms: () => [{ provider: "fake", capabilities: { direct: true, groups: false, typing: true } }],
    onInbound: (next) => { sink = next; },
    handleWebhook: async () => {
      await sink?.({ type: "message", provider: "fake", handle: secret, threadId: "fake:dm", isDirect: true, from: "u", fromLabel: null, channelName: null, participants: [], content: secret, mediaUrl: null });
      return new Response("ACK", { status: 202 });
    },
    sendToThread: async () => { throw new Error(`vendor request ${secret}`); },
    openDirectThread: async () => { throw new Error(`vendor request ${secret}`); },
    sendTyping: async () => { throw new Error(`vendor request ${secret}`); },
    };
  };
  const service = createProviderMcpHttpServer({ token, port: 0, providers: { composio: undefined, pipedream: undefined }, services: {
    messagingFactory: failingMessaging,
    email: { describe: () => ({ id: "fake-email", contractVersion: "1", adapterVersion: "test", capabilities: { transactional: true } }), send: async () => { throw new Error(`smtp password ${secret}`); }, drain: async () => { throw new Error(`smtp password ${secret}`); } },
    push: async () => { throw new Error(`expo bearer secret ${secret}`); },
  } });
  await service.listen(); const port = (service.http.address() as AddressInfo).port;
  try {
    const rpc = new ManagedProviderMcpClient({ providerId: "composio", endpoint: `http://127.0.0.1:${port}/mcp`, token });
    const messaging = new ManagedMessagingMcpClient(rpc);
    messaging.onInbound(async () => { throw new Error(`sink event ${secret}`); });
    const operations = [
      () => messaging.sendToThread({ threadId: "thread-1", body: "hello" }, context),
      () => messaging.openDirectThread("fake", "person", context),
      () => messaging.sendTyping("thread-1", context),
      () => (async () => { await messaging.handleWebhook("fake", new Request("https://fake.test/hook", { method: "POST", body: "event" })); })(),
      () => new ManagedEmailMcpClient(rpc).send({ to: "person@example.com", subject: "Hi", text: "Hello" }),
      () => new ManagedEmailMcpClient(rpc).drain(),
      () => new ManagedNotificationMcpClient(rpc, async () => "ExponentPushToken[private]").send({ kind: "completion", title: "Done", body: "Body", botId: "bot-1", threadId: "thread-1" }, context),
    ];
    for (const operation of operations) {
      await assert.rejects(operation(), (error: unknown) => {
        assert.match(String(error), /Managed (delivery operation failed|provider operation failed|provider failed)/i);
        assert.doesNotMatch(String(error), /secret\.example|signing-material|password|bearer secret|private/i);
        return true;
      });
    }
  } finally { await service.close(); }
});

test("late provider rejection after cancellation is classified without leaking its error", async () => {
  const controller = new AbortController();
  const secret = "smtp://user:password@private.example.test/?signingSecret=hidden";
  const operation = deliveryRun(controller.signal, async () => {
    await Promise.resolve();
    controller.abort();
    throw new Error(`late SDK failure ${secret}`);
  });
  await assert.rejects(operation, (error: unknown) => {
    assert.equal((error as Error).name, "AbortError");
    assert.equal((error as Error).message, "Managed delivery operation aborted");
    assert.doesNotMatch(String(error), /private\.example|password|hidden/i);
    return true;
  });
});

test("provider-prefixed remote errors are still replaced rather than allowlisted", () => {
  const error = sanitizeManagedProviderError(
    new Error("Managed provider failed: apiKey=secret-value"),
    new AbortController().signal,
  );
  assert.equal(error.message, "Managed provider request failed");
  assert.doesNotMatch(error.message, /secret-value/i);
});
