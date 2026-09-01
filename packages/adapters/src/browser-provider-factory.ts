import type { BrowserProvider } from "@rakazo/adapter-kit";
import { EmulatorBrowserProvider } from "./browser-emulator.js";
import { FakeBrowserProvider, type FakeBrowserProviderOptions } from "./fake-browser.js";

/**
 * Resolve the deployment page-browser provider.
 *
 * Default is the in-process fake/emulator so core runs with no hosted browser
 * vendor. This is a page/DOM tool slot for the bot computer, not Playwright or
 * Puppeteer as a product. Set BROWSER_PROVIDER=emulator in offline conformance.
 */
export function resolveBrowserProviderKind(source: NodeJS.ProcessEnv = process.env): string {
  const raw = source.BROWSER_PROVIDER?.trim().toLowerCase();
  if (!raw || raw === "fake") return "fake";
  if (raw === "emulator") return "emulator";
  return raw;
}

export function createBrowserProvider(
  kind: string = resolveBrowserProviderKind(),
  options?: FakeBrowserProviderOptions,
): BrowserProvider {
  switch (kind) {
    case "fake":
    case "":
      return new FakeBrowserProvider(options);
    case "emulator":
      return new EmulatorBrowserProvider(options);
    default:
      throw new Error(`Unknown browser provider "${kind}"`);
  }
}
