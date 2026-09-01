import type {
  AdapterContext,
  BrowserActRequest,
  BrowserActResult,
  BrowserNavigateRequest,
  BrowserNavigateResult,
  BrowserProvider,
  BrowserSnapshotRequest,
  BrowserSnapshotResult,
  ComputerRef,
  SandboxProvider,
} from "@rakazo/adapter-kit";
import { FakeBrowserProvider, type FakeBrowserProviderOptions } from "./fake-browser.js";

const DETACHED_MESSAGE =
  "Page browser is not attached to this computer's Chrome. Use computer_act on the desktop browser instead.";

/**
 * Production page-browser adapter for the bot computer.
 *
 * Fake computers use the in-process DOM session (the fake sandbox has no Chrome).
 * Real computers return `fallback: "computer_act"` until a live page driver is
 * attached — never report success against a detached DOM while Chrome is elsewhere.
 */
export class ComputerBrowserProvider implements BrowserProvider {
  private readonly fake: FakeBrowserProvider;
  private readonly sandbox?: SandboxProvider;

  constructor(options: FakeBrowserProviderOptions & { sandbox?: SandboxProvider } = {}) {
    const { sandbox, ...fakeOptions } = options;
    this.sandbox = sandbox;
    this.fake = new FakeBrowserProvider(fakeOptions);
  }

  describe() {
    return {
      id: "computer",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        page: true,
        refs: true,
        keyless: true,
      },
    };
  }

  async navigate(
    computer: ComputerRef,
    request: BrowserNavigateRequest,
    context: AdapterContext,
  ): Promise<BrowserNavigateResult> {
    if (this.canUseInProcess(computer)) {
      return this.fake.navigate(computer, request, context);
    }
    return {
      url: request.url,
      title: "",
      fallback: "computer_act",
      error: DETACHED_MESSAGE,
    };
  }

  async snapshot(
    computer: ComputerRef,
    request: BrowserSnapshotRequest,
    context: AdapterContext,
  ): Promise<BrowserSnapshotResult> {
    if (this.canUseInProcess(computer)) {
      return this.fake.snapshot(computer, request, context);
    }
    return {
      url: "",
      title: "",
      tree: "",
      elements: [],
      fallback: "computer_act",
      error: DETACHED_MESSAGE,
    };
  }

  async act(
    computer: ComputerRef,
    request: BrowserActRequest,
    context: AdapterContext,
  ): Promise<BrowserActResult> {
    if (this.canUseInProcess(computer)) {
      return this.fake.act(computer, request, context);
    }
    return {
      ok: false,
      completed: 0,
      url: "",
      title: "",
      fallback: "computer_act",
      error: DETACHED_MESSAGE,
    };
  }

  private canUseInProcess(computer: ComputerRef): boolean {
    if (computer.kind === "fake") return true;
    const id = this.sandbox?.describe().id;
    return id === "fake";
  }
}
