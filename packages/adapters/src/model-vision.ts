import type { Models } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { registerLocalProvider } from "./pi-local-provider.js";
import {
  OPENAI_COMPATIBLE_PROVIDER_ID,
  registerOpenAiCompatibleCatalog,
} from "./pi-openai-compatible-provider.js";

/** Computer tools whose results include screenshots for the model. */
export const IMAGE_RETURNING_COMPUTER_TOOLS = new Set([
  "computer_observe",
  "computer_act",
  "open_path",
  "launch_app",
]);

export const MODEL_CANNOT_SEE_MESSAGE = "This bot's model cannot see; pick a vision-capable model.";

let catalogModelsCache: Models | undefined;

function catalogModels(): Models {
  catalogModelsCache ??= registerOpenAiCompatibleCatalog(registerLocalProvider(builtinModels()));
  return catalogModelsCache;
}

/**
 * Whether the selected model accepts image input, per the Pi model catalog's
 * declared `input` modalities. Unknown models are treated as text-only.
 * Scripted fixtures always allow images so local verification still covers
 * computer tools.
 */
export function modelAcceptsImageInput(provider: string, modelId: string): boolean {
  const normalizedProvider = provider.trim();
  const normalizedId = modelId.trim();
  if (!normalizedProvider || !normalizedId) return false;
  if (normalizedProvider === "scripted" || normalizedId === "scripted") return true;

  const models = catalogModels();
  let model = models.getModel(normalizedProvider, normalizedId);
  if (
    !model &&
    normalizedProvider !== "openrouter" &&
    normalizedProvider !== OPENAI_COMPATIBLE_PROVIDER_ID
  ) {
    model = models.getModel("openrouter", normalizedId);
  }
  return Boolean(model?.input.includes("image"));
}

export function filterImageReturningComputerTools<T extends { name: string }>(
  tools: T[],
  acceptsImages: boolean,
): T[] {
  if (acceptsImages) return tools;
  return tools.filter((tool) => !IMAGE_RETURNING_COMPUTER_TOOLS.has(tool.name));
}
