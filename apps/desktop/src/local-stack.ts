import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_LOCAL_WEB_URL } from "./setup-config.js";

export const LOCAL_STACK_DIR_NAME = "local-stack";
export const LOCAL_STACK_PROJECT_NAME = "rakazo-desktop";
export const LOCAL_STACK_COMPOSE_FILE = "docker-compose.images.yml";
export const LOCAL_STACK_ENV_EXAMPLE = ".env.images.example";
export const LOCAL_STACK_ENV_FILE = ".env";

const REQUIRED_SECRETS = [
  "POSTGRES_PASSWORD",
  "BETTER_AUTH_SECRET",
  "ENCRYPTION_KEY",
  "SCREEN_PROXY_SECRET",
  "SANDBOX_SUPERVISOR_TOKEN",
] as const;

export type LocalStackProgress = (message: string) => void;

export type LocalStackResult =
  | { ok: true; url: string; attached: boolean }
  | { ok: false; error: string };

export type LocalStackRunner = (input: {
  command: string;
  args: string[];
  cwd: string;
}) => Promise<{ code: number; stdout: string; stderr: string }>;

export type LocalStackDeps = {
  userDataDir: string;
  templateDir?: string;
  packaged?: boolean;
  resourcesPath?: string;
  platform?: NodeJS.Platform;
  runner?: LocalStackRunner;
  onProgress?: LocalStackProgress;
};

/** True when the address is the default published-images loopback URL. */
export function isDefaultLocalStackUrl(url: string): boolean {
  try {
    return new URL(url).origin === new URL(DEFAULT_LOCAL_WEB_URL).origin;
  } catch {
    return false;
  }
}

export function dockerDesktopInstallUrl(platform: NodeJS.Platform = process.platform): string {
  if (platform === "linux") return "https://docs.docker.com/engine/install/";
  return "https://www.docker.com/products/docker-desktop/";
}

export function resolveLocalStackTemplateDir(input: {
  packaged?: boolean;
  resourcesPath?: string;
  moduleDir?: string;
}): string {
  if (input.packaged) {
    return path.join(input.resourcesPath ?? process.resourcesPath, LOCAL_STACK_DIR_NAME);
  }
  const moduleDir = input.moduleDir ?? path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, "../../../infra/compose");
}

export function localStackDataDir(userDataDir: string): string {
  return path.join(userDataDir, LOCAL_STACK_DIR_NAME);
}

/** Fill blank required secrets from the published-images env example. */
export function fillLocalStackEnv(example: string, existing: string | null): string {
  const prior = new Map<string, string>();
  if (existing !== null) {
    for (const line of existing.split(/\r?\n/)) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (match) prior.set(match[1]!, match[2]!);
    }
  }

  const secrets = new Map<string, string>();
  for (const name of REQUIRED_SECRETS) {
    const kept = prior.get(name)?.trim();
    secrets.set(
      name,
      kept && kept.length > 0
        ? kept
        : randomBytes(name === "POSTGRES_PASSWORD" ? 16 : 32).toString("hex"),
    );
  }

  const source = existing !== null && existing.trim() !== "" ? existing : example;
  const lines = source.split(/\r?\n/).map((line) => {
    for (const name of REQUIRED_SECRETS) {
      if (line === `${name}=` || line.startsWith(`${name}=`)) {
        const current = line.slice(name.length + 1).trim();
        if (current === "") return `${name}=${secrets.get(name)}`;
      }
    }
    return line;
  });

  for (const name of REQUIRED_SECRETS) {
    if (!lines.some((line) => line.startsWith(`${name}=`))) {
      lines.push(`${name}=${secrets.get(name)}`);
    }
  }

  return `${lines.join("\n").replace(/\n*$/, "")}\n`;
}

export async function ensureLocalStackFiles(input: {
  dataDir: string;
  templateDir: string;
}): Promise<void> {
  await mkdir(input.dataDir, { recursive: true });
  const composeDest = path.join(input.dataDir, LOCAL_STACK_COMPOSE_FILE);
  const exampleDest = path.join(input.dataDir, LOCAL_STACK_ENV_EXAMPLE);
  const envDest = path.join(input.dataDir, LOCAL_STACK_ENV_FILE);

  await copyFile(path.join(input.templateDir, LOCAL_STACK_COMPOSE_FILE), composeDest);
  await copyFile(path.join(input.templateDir, LOCAL_STACK_ENV_EXAMPLE), exampleDest);

  const example = await readFile(exampleDest, "utf8");
  let existing: string | null = null;
  try {
    existing = await readFile(envDest, "utf8");
  } catch {
    existing = null;
  }
  const next = fillLocalStackEnv(example, existing);
  if (existing !== next) {
    await writeFile(envDest, next, { encoding: "utf8", mode: 0o600 });
  }
}

async function defaultRunner(input: {
  command: string;
  args: string[];
  cwd: string;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function detectDocker(
  runner: LocalStackRunner,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const version = await runner({
      command: "docker",
      args: ["version", "--format", "{{.Server.Version}}"],
      cwd: process.cwd(),
    });
    if (version.code !== 0) {
      return {
        ok: false,
        error: `Docker is required for This computer. Install Docker Desktop, then try again. ${dockerDesktopInstallUrl()}`,
      };
    }
    const compose = await runner({
      command: "docker",
      args: ["compose", "version"],
      cwd: process.cwd(),
    });
    if (compose.code !== 0) {
      return {
        ok: false,
        error:
          "Docker Compose is required for This computer. Update Docker Desktop, then try again.",
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: `Docker is required for This computer. Install Docker Desktop, then try again. ${dockerDesktopInstallUrl()}`,
    };
  }
}

/**
 * Ensure the published-images Compose stack is running on this machine.
 * Attaches when containers already exist; creates secrets and pulls on first use.
 */
export async function ensureLocalStack(deps: LocalStackDeps): Promise<LocalStackResult> {
  const onProgress = deps.onProgress ?? (() => undefined);
  const runner = deps.runner ?? defaultRunner;
  const platform = deps.platform ?? process.platform;
  const dataDir = localStackDataDir(deps.userDataDir);
  const templateDir =
    deps.templateDir ??
    resolveLocalStackTemplateDir({
      packaged: deps.packaged,
      resourcesPath: deps.resourcesPath,
    });

  onProgress("Checking Docker…");
  const docker = await detectDocker(runner);
  if (!docker.ok) {
    const installUrl = dockerDesktopInstallUrl(platform);
    return {
      ok: false,
      error: docker.error.includes(installUrl) ? docker.error : `${docker.error} ${installUrl}`,
    };
  }

  try {
    await access(path.join(templateDir, LOCAL_STACK_COMPOSE_FILE));
    await access(path.join(templateDir, LOCAL_STACK_ENV_EXAMPLE));
  } catch {
    return {
      ok: false,
      error: "Desktop is missing the local server bundle. Reinstall Rakazo, then try again.",
    };
  }

  onProgress("Preparing local server files…");
  try {
    await ensureLocalStackFiles({ dataDir, templateDir });
  } catch (error) {
    return {
      ok: false,
      error: `Could not prepare the local server. ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const composeArgs = [
    "compose",
    "-p",
    LOCAL_STACK_PROJECT_NAME,
    "--env-file",
    LOCAL_STACK_ENV_FILE,
    "-f",
    LOCAL_STACK_COMPOSE_FILE,
  ];

  onProgress("Checking for a running local server…");
  const ps = await runner({
    command: "docker",
    args: [...composeArgs, "ps", "-q"],
    cwd: dataDir,
  });
  const alreadyRunning = ps.code === 0 && ps.stdout.trim() !== "";

  if (!alreadyRunning) {
    onProgress("Pulling Rakazo images. This can take a few minutes the first time…");
    const pull = await runner({
      command: "docker",
      args: [...composeArgs, "pull"],
      cwd: dataDir,
    });
    if (pull.code !== 0) {
      return {
        ok: false,
        error: summarizeDockerFailure(
          "Could not download Rakazo images.",
          pull.stderr || pull.stdout,
        ),
      };
    }
  }

  onProgress(
    alreadyRunning
      ? "Starting local server…"
      : "Starting local server and waiting until it is healthy…",
  );
  const upHelp = await runner({
    command: "docker",
    args: ["compose", "up", "--help"],
    cwd: dataDir,
  });
  const supportsWaitTimeout =
    upHelp.stdout.includes("--wait-timeout") || upHelp.stderr.includes("--wait-timeout");
  const upArgs = supportsWaitTimeout
    ? [...composeArgs, "up", "-d", "--wait", "--wait-timeout", "300"]
    : [...composeArgs, "up", "-d"];
  const up = await runner({
    command: "docker",
    args: upArgs,
    cwd: dataDir,
  });
  if (up.code !== 0) {
    return {
      ok: false,
      error: summarizeDockerFailure(
        "Could not start the local Rakazo server.",
        up.stderr || up.stdout,
      ),
    };
  }

  return { ok: true, url: DEFAULT_LOCAL_WEB_URL, attached: alreadyRunning };
}

function summarizeDockerFailure(prefix: string, detail: string): string {
  const trimmed = detail.trim().replace(/\s+/g, " ");
  if (trimmed === "") return prefix;
  const short = trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
  return `${prefix} ${short}`;
}
