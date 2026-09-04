// @vitest-environment jsdom

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolActivityDisclosure } from "./ToolActivityDisclosure";

describe("ToolActivityDisclosure", () => {
  it("defaults collapsed with its label", () => {
    const html = renderToStaticMarkup(
      <ToolActivityDisclosure label="Done">
        <span>Shell ×2</span>
      </ToolActivityDisclosure>,
    );

    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain(`<summary`);
    expect(html).toContain("Done");
    expect(html).toContain("Shell ×2");
  });

  it("can be expanded to inspect completed activity", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    flushSync(() =>
      root.render(
        <ToolActivityDisclosure label="Done">
          <span>Shell ×2</span>
        </ToolActivityDisclosure>,
      ),
    );

    container.querySelector("summary")?.click();
    expect(container.querySelector("details")?.open).toBe(true);
    expect(container.querySelector("summary")?.textContent).toContain("Done");
    root.unmount();
  });
});
