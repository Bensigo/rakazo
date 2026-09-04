import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

const viewports = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "mobile-390x844", width: 390, height: 844 },
];
const states = [
  { name: "active", live: true },
  { name: "complete", live: false },
];

test("live activity stays hidden and completed activity can be disclosed", async ({
  page,
}, testInfo) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const state of states) {
      await page.goto(`/e2e/fixtures/tool-activity-disclosure.html?live=${state.live ? 1 : 0}`);
      const details = page.getByTestId("tool-activity");
      const summary = details.locator("summary");
      const rows = page.getByTestId("tool-rows");

      await expect(page.getByTestId("response")).toBeVisible();
      if (state.live) {
        await expect(details).toHaveCount(0);
        await expect(page.getByText("Working…")).toHaveCount(0);
        await captureScreenshot(page, testInfo, `${state.name}-${viewport.name}`);
        continue;
      }

      await expect(summary).toHaveText("Done");
      await expect(details).not.toHaveAttribute("open", "");
      await expect(rows).not.toBeVisible();
      await captureScreenshot(page, testInfo, `${state.name}-collapsed-${viewport.name}`);

      await summary.click();
      await expect(details).toHaveAttribute("open", "");
      await summary.click();
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(details).toHaveAttribute("open", "");
      await expect(rows).toBeVisible();
      await expect(summary).toBeFocused();
      await expect(page.locator("body")).toHaveJSProperty("scrollWidth", viewport.width);
      const rowBox = await rows.boundingBox();
      const responseBox = await page.getByTestId("response").boundingBox();
      expect(rowBox).not.toBeNull();
      expect(responseBox).not.toBeNull();
      expect(responseBox?.y).toBeGreaterThan((rowBox?.y ?? 0) + (rowBox?.height ?? 0));
      await captureScreenshot(page, testInfo, `${state.name}-expanded-${viewport.name}`);
    }
  }
});
