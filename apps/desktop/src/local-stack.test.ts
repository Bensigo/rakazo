import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectDocker,
  ensureLocalStack,
  ensureLocalStackFiles,
  fillLocalStackEnv,
  isDefaultLocalStackUrl,
  LOCAL_STACK_COMPOSE_FILE,
  LOCAL_STACK_ENV_EXAMPLE,
  LOCAL_STACK_ENV_FILE,
  type LocalStackRunner,
} from "./local-stack.js";
import { DEFAULT_LOCAL_WEB_URL } from "./setup-config.js";

const EXAMPLE = `# example
POSTGRES_PASSWORD=
BETTER_AUTH_SECRET=
ENCRYPTION_KEY=
SCREEN_PROXY_SECRET=
SANDBOX_SUPERVISOR_TOKEN=
BETTER_AUTH_URL=http://127.0.0.1:5173
`;

describe("local stack helpers", () => {
  it("recognizes the default loopback stack URL", () => {
    expect(isDefaultLocalStackUrl(DEFAULT_LOCAL_WEB_URL)).toBe(true);
    expect(isDefaultLocalStackUrl("http://127.0.0.1:5173/")).toBe(true);
    expect(isDefaultLocalStackUrl("http://127.0.0.1:9999")).toBe(false);
    expect(isDefaultLocalStackUrl("https://rakazo.example.com")).toBe(false);
  });

  it("fills blank secrets and keeps existing ones", () => {
    const first = fillLocalStackEnv(EXAMPLE, null);
    expect(first).toMatch(/POSTGRES_PASSWORD=[0-9a-f]{32}/);
    expect(first).toMatch(/BETTER_AUTH_SECRET=[0-9a-f]{64}/);
    expect(first).toContain("BETTER_AUTH_URL=http://127.0.0.1:5173");

    const password = /^POSTGRES_PASSWORD=(.*)$/m.exec(first)?.[1];
    const second = fillLocalStackEnv(EXAMPLE, first);
    expect(second).toContain(`POSTGRES_PASSWORD=${password}`);
  });
});

describe("ensureLocalStackFiles", () => {
  let dir: string | undefined;
  let templateDir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    if (templateDir) await rm(templateDir, { recursive: true, force: true });
    dir = undefined;
    templateDir = undefined;
  });

  it("copies compose files and writes a secret-filled .env once", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rakazo-stack-data-"));
    templateDir = await mkdtemp(path.join(tmpdir(), "rakazo-stack-template-"));
    await writeFile(path.join(templateDir, LOCAL_STACK_COMPOSE_FILE), "name: rakazo\n", "utf8");
    await writeFile(path.join(templateDir, LOCAL_STACK_ENV_EXAMPLE), EXAMPLE, "utf8");

    await ensureLocalStackFiles({ dataDir: dir, templateDir });
    const env = await readFile(path.join(dir, LOCAL_STACK_ENV_FILE), "utf8");
    expect(env).toMatch(/BETTER_AUTH_SECRET=[0-9a-f]{64}/);
    expect(await readFile(path.join(dir, LOCAL_STACK_COMPOSE_FILE), "utf8")).toContain(
      "name: rakazo",
    );

    const password = /^POSTGRES_PASSWORD=(.*)$/m.exec(env)?.[1];
    await ensureLocalStackFiles({ dataDir: dir, templateDir });
    const again = await readFile(path.join(dir, LOCAL_STACK_ENV_FILE), "utf8");
    expect(again).toContain(`POSTGRES_PASSWORD=${password}`);
  });
});

describe("ensureLocalStack", () => {
  let dir: string | undefined;
  let templateDir: string | undefined;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    if (templateDir) await rm(templateDir, { recursive: true, force: true });
    dir = undefined;
    templateDir = undefined;
  });

  it("explains how to install Docker when it is missing", async () => {
    const runner: LocalStackRunner = async () => {
      throw new Error("ENOENT");
    };
    const result = await detectDocker(runner);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Docker Desktop");
      expect(result.error).toMatch(/docker\.com/);
    }
  });

  it("pulls and starts compose when Docker is available", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rakazo-stack-data-"));
    templateDir = await mkdtemp(path.join(tmpdir(), "rakazo-stack-template-"));
    await writeFile(path.join(templateDir, LOCAL_STACK_COMPOSE_FILE), "name: rakazo\n", "utf8");
    await writeFile(path.join(templateDir, LOCAL_STACK_ENV_EXAMPLE), EXAMPLE, "utf8");

    const calls: string[] = [];
    const runner: LocalStackRunner = async ({ args }) => {
      calls.push(args.join(" "));
      if (args[0] === "version" || args[0] === "compose") {
        if (args.includes("ps")) return { code: 0, stdout: "", stderr: "" };
        if (args.includes("up") && args.includes("--help")) {
          return { code: 0, stdout: "--wait --wait-timeout", stderr: "" };
        }
        return { code: 0, stdout: "ok", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    };

    const progress: string[] = [];
    const result = await ensureLocalStack({
      userDataDir: dir,
      templateDir,
      runner,
      onProgress: (message) => progress.push(message),
    });

    expect(result).toEqual({ ok: true, url: DEFAULT_LOCAL_WEB_URL, attached: false });
    expect(calls.some((call) => call.includes("pull"))).toBe(true);
    expect(calls.some((call) => call.includes("up -d --wait --wait-timeout 300"))).toBe(true);
    expect(progress[0]).toContain("Docker");
  });

  it("uses --wait when Compose help has no --wait-timeout", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rakazo-stack-data-"));
    templateDir = await mkdtemp(path.join(tmpdir(), "rakazo-stack-template-"));
    await writeFile(path.join(templateDir, LOCAL_STACK_COMPOSE_FILE), "name: rakazo\n", "utf8");
    await writeFile(path.join(templateDir, LOCAL_STACK_ENV_EXAMPLE), EXAMPLE, "utf8");

    const calls: string[] = [];
    const runner: LocalStackRunner = async ({ args }) => {
      calls.push(args.join(" "));
      if (args.includes("up") && args.includes("--help")) {
        return { code: 0, stdout: "Usage: docker compose up\n--wait\n", stderr: "" };
      }
      return { code: 0, stdout: args.includes("ps") ? "" : "ok", stderr: "" };
    };

    const result = await ensureLocalStack({
      userDataDir: dir,
      templateDir,
      runner,
    });
    expect(result.ok).toBe(true);
    expect(
      calls.some((call) => call.includes("up -d --wait") && !call.includes("--wait-timeout")),
    ).toBe(true);
  });

  it("polls health when Compose cannot wait on startup", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rakazo-stack-data-"));
    templateDir = await mkdtemp(path.join(tmpdir(), "rakazo-stack-template-"));
    await writeFile(path.join(templateDir, LOCAL_STACK_COMPOSE_FILE), "name: rakazo\n", "utf8");
    await writeFile(path.join(templateDir, LOCAL_STACK_ENV_EXAMPLE), EXAMPLE, "utf8");

    const calls: string[] = [];
    const runner: LocalStackRunner = async ({ args }) => {
      calls.push(args.join(" "));
      if (args.includes("up") && args.includes("--help")) {
        return { code: 0, stdout: "Usage: docker compose up", stderr: "" };
      }
      return { code: 0, stdout: args.includes("ps") ? "" : "ok", stderr: "" };
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ json: { ok: true, version: "0.1.0" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    try {
      const result = await ensureLocalStack({
        userDataDir: dir,
        templateDir,
        runner,
      });
      expect(result.ok).toBe(true);
      expect(calls.some((call) => call.includes("up -d") && !call.includes("--wait"))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("skips pull when the stack is already running", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rakazo-stack-data-"));
    templateDir = await mkdtemp(path.join(tmpdir(), "rakazo-stack-template-"));
    await writeFile(path.join(templateDir, LOCAL_STACK_COMPOSE_FILE), "name: rakazo\n", "utf8");
    await writeFile(path.join(templateDir, LOCAL_STACK_ENV_EXAMPLE), EXAMPLE, "utf8");

    const calls: string[] = [];
    const runner: LocalStackRunner = async ({ args }) => {
      calls.push(args.join(" "));
      if (args.includes("ps")) return { code: 0, stdout: "abc123\n", stderr: "" };
      if (args.includes("up") && args.includes("--help")) {
        return { code: 0, stdout: "--wait --wait-timeout", stderr: "" };
      }
      return { code: 0, stdout: "ok", stderr: "" };
    };

    const result = await ensureLocalStack({
      userDataDir: dir,
      templateDir,
      runner,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attached).toBe(true);
    expect(calls.some((call) => call.includes("pull"))).toBe(false);
  });
});
