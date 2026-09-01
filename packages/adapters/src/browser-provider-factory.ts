import type { BrowserProvider, SandboxProvider } from "@rakazo/adapter-kit";
import { EmulatorBrowserProvider } from "./browser-emulator.js";
import { ComputerBrowserProvider } from "./computer-browser.js";
import { FakeBrowserProvider, type FakeBrowserProviderOptions } from "./fake-browser.js";

export type CreateBrowserProviderOptions = FakeBrowserProviderOptions & {
  sandbox?: SandboxProvider;
};

/**
 * Resolve the deployment page-browser provider.
 *
 * Default is `computer`: attach to the bot computer when possible (fake
 * sandboxes use an in-process page session); otherwise return computer_act
 * fallback instead of mutating a detached DOM. Use BROWSER_PROVIDER=fake or
 * emulator only for offline tests. This slot is not Playwright/Puppeteer as a
 * product and needs no hosted browser vendor.
 */
export function resolveBrowserProviderKind(source: NodeJS.ProcessEnv = process.env): string {
  const raw = source.BROWSER_PROVIDER?.trim().toLowerCase();
  if (!raw || raw === "computer" || raw === "sandbox") return "computer";
  if (raw === "fake") return "fake";
  if (raw === "emulator") return "emulator";
  return raw;
}

export function createBrowserProvider(
  kind: string = resolveBrowserProviderKind(),
  options?: CreateBrowserProviderOptions,
): BrowserProvider {
  switch (kind) {
    case "computer":
    case "sandbox":
    case "":
      return new ComputerBrowserProvider(options);
    case "fake":
      return new FakeBrowserProvider(options);
    case "emulator":
      return new EmulatorBrowserProvider(options);
    default:
      throw new Error(`Unknown browser provider "${kind}"`);
  }
}
