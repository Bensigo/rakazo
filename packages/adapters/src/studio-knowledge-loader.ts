import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { StudioKnowledgeBridge } from "./studio-context.js";

export async function loadStudioKnowledgeBridge(input: {
  modulePath?: string;
  databaseUrl?: string;
}): Promise<StudioKnowledgeBridge | undefined> {
  if (!input.modulePath) return undefined;
  if (!input.databaseUrl) {
    throw new Error(
      "SUNRISE_KNOWLEDGE_DATABASE_URL is required when SUNRISE_KNOWLEDGE_MODULE is configured.",
    );
  }
  const specifier = moduleSpecifier(input.modulePath);
  const loaded = (await import(specifier)) as {
    createStudioKnowledgeBridge?: (options: { databaseUrl: string }) => Promise<unknown> | unknown;
  };
  if (typeof loaded.createStudioKnowledgeBridge !== "function") {
    throw new Error("The Sunrise knowledge module must export createStudioKnowledgeBridge().");
  }
  const bridge = await loaded.createStudioKnowledgeBridge({ databaseUrl: input.databaseUrl });
  if (!isStudioKnowledgeBridge(bridge)) {
    throw new Error("The Sunrise knowledge module returned an invalid bridge.");
  }
  return bridge;
}

function moduleSpecifier(modulePath: string): string {
  if (isAbsolute(modulePath) || modulePath.startsWith(".")) {
    return pathToFileURL(resolve(modulePath)).href;
  }
  return modulePath;
}

function isStudioKnowledgeBridge(value: unknown): value is StudioKnowledgeBridge {
  if (!value || typeof value !== "object") return false;
  const bridge = value as Partial<StudioKnowledgeBridge>;
  return (
    typeof bridge.pin === "function" &&
    typeof bridge.read === "function" &&
    typeof bridge.sync === "function" &&
    typeof bridge.listWiki === "function" &&
    typeof bridge.getWikiPage === "function" &&
    typeof bridge.close === "function"
  );
}
