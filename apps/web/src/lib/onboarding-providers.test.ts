import type { ModelCatalogEntry } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import { featuredModelProviders, keepSelectedProviderVisible } from "./onboarding-providers";

function provider(provider: string): ModelCatalogEntry {
  return {
    provider,
    providerName: provider,
    id: `${provider}-model`,
    label: `${provider} model`,
    billing: "",
  };
}

describe("featuredModelProviders", () => {
  it("shows popular providers in a stable order", () => {
    const providers = [
      provider("azure"),
      provider("vercel-ai-gateway"),
      provider("google"),
      provider("openai"),
      provider("anthropic"),
      provider("openai-codex"),
      provider("openrouter"),
    ];

    expect(featuredModelProviders(providers, "openrouter").map((entry) => entry.provider)).toEqual([
      "openrouter",
      "openai-codex",
      "anthropic",
      "openai",
      "google",
      "vercel-ai-gateway",
    ]);
  });

  it("fills missing popular slots from the catalog", () => {
    const providers = [
      provider("azure"),
      provider("openrouter"),
      provider("bedrock"),
      provider("anthropic"),
    ];

    expect(featuredModelProviders(providers, "openrouter").map((entry) => entry.provider)).toEqual([
      "openrouter",
      "anthropic",
      "azure",
      "bedrock",
    ]);
  });

  it("keeps a non-featured selected provider visible", () => {
    const providers = [
      provider("openrouter"),
      provider("openai-codex"),
      provider("anthropic"),
      provider("openai"),
      provider("google"),
      provider("vercel-ai-gateway"),
      provider("local"),
    ];

    expect(featuredModelProviders(providers, "local").map((entry) => entry.provider)).toEqual([
      "openrouter",
      "openai-codex",
      "anthropic",
      "openai",
      "google",
      "local",
    ]);
  });
});

describe("keepSelectedProviderVisible", () => {
  it("pins the active provider above unrelated search results", () => {
    const providers = [provider("openrouter"), provider("anthropic"), provider("bedrock")];

    expect(
      keepSelectedProviderVisible(providers.slice(1), providers, "openrouter").map(
        (entry) => entry.provider,
      ),
    ).toEqual(["openrouter", "anthropic", "bedrock"]);
  });

  it("does not duplicate an active provider that matches the search", () => {
    const providers = [provider("openrouter"), provider("anthropic")];

    expect(
      keepSelectedProviderVisible(providers, providers, "openrouter").map(
        (entry) => entry.provider,
      ),
    ).toEqual(["openrouter", "anthropic"]);
  });
});
