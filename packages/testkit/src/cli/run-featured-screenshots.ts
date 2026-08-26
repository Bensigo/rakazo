/**
 * One-off e2e runner for featured-connector screenshots without Testcontainers.
 * Uses the local Postgres already available on this VM.
 */
import { execSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { runProcess } from "./process.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://rakazo:rakazo@127.0.0.1:5432/rakazo";
const apiPort = Number(process.env.API_PORT ?? 3110);
const webPort = Number(process.env.WEB_PORT ?? 5180);
const webOrigin = `http://127.0.0.1:${webPort}`;
const reportDir = path.resolve("test-report", "e2e-featured-screenshots");

async function main() {
  await mkdir(reportDir, { recursive: true });
  await mkdir(path.join(reportDir, "data"), { recursive: true });

  process.env.DATABASE_URL = databaseUrl;
  process.env.VERIFY_DATABASE = "1";
  process.env.WAKEUP_DRIVER = "memory";
  process.env.SANDBOX_PROVIDER = "fake";
  process.env.AGENT_RUNTIME = "scripted";
  process.env.COMPOSIO_API_KEY = "";
  process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-32chars!";
  process.env.ENCRYPTION_KEY = "test-encryption-key-test-encryption-key";
  process.env.BETTER_AUTH_URL = webOrigin;
  process.env.WEB_ORIGIN = webOrigin;
  process.env.API_PORT = String(apiPort);
  process.env.API_URL = `http://127.0.0.1:${apiPort}`;
  process.env.API_PROXY_TARGET = `http://127.0.0.1:${apiPort}`;
  process.env.WEB_PORT = String(webPort);
  process.env.PLAYWRIGHT_BASE_URL = webOrigin;
  process.env.DATA_DIR = path.join(reportDir, "data");
  process.env.SIGNUPS_ENABLED = "true";
  process.env.CI = "1";
  process.env.FEATURED_SCREENSHOT_DIR = process.env.FEATURED_SCREENSHOT_DIR ?? "/opt/cursor/artifacts";
  process.env.VITE_DEFAULT_UI_LOCALE = "en";

  execSync("pnpm --filter @rakazo/db generate", { stdio: "inherit", env: process.env });
  execSync("pnpm --filter @rakazo/db exec prisma migrate deploy", {
    stdio: "inherit",
    env: process.env,
    cwd: path.resolve("packages/db"),
  });

  const [{ ComposioEmulator, PipedreamConnector, ThirdPartyConnectorEmulator }, { createApp }] =
    await Promise.all([import("@rakazo/adapters"), import("../../../../apps/api/src/app.ts")]);
  const { serve } = await import("@hono/node-server");
  const thirdParties = new ThirdPartyConnectorEmulator();
  const pipedream = new PipedreamConnector(
    {
      clientId: "fake-client-id",
      clientSecret: "fake-client-secret",
      projectId: "fake-project-id",
      environment: "development",
      identitySecret: process.env.ENCRYPTION_KEY,
    },
    { fetch: thirdParties.fetch, resolveHostname: thirdParties.resolveHostname },
  );
  const handles = await createApp({
    databaseUrl,
    prisma: undefined,
    composio: new ComposioEmulator(),
    pipedream,
    remoteConnectors: {
      fetch: thirdParties.fetch,
      resolveHostname: thirdParties.resolveHostname,
    },
  });

  const server = serve({
    fetch: (request) => handles.app.fetch(request),
    port: apiPort,
    hostname: "127.0.0.1",
  });
  await waitForHealth(`http://127.0.0.1:${apiPort}/health`, 15_000);

  try {
    await runProcess(
      "pnpm",
      ["--filter", "@rakazo/web", "exec", "playwright", "test", "e2e/featured-connectors-screenshots.spec.ts"],
      { ...process.env, CI: "1", VITE_DEFAULT_UI_LOCALE: "en" },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await handles.stop().catch(() => undefined);
  }
}

async function waitForHealth(url: string, ms: number) {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      last = `${res.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`API health check failed for ${url}: ${last}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
