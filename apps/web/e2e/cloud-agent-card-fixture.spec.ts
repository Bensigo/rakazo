import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test("cloud agent card fixture is screenshot-ready", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/e2e/fixtures/cloud-agent-card.html");
  const card = page.getByTestId("cloud-agent-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Add a README with setup instructions");
  await expect(card).toContainText("running");
  await captureScreenshot(page, testInfo, "cloud-agent-card-fixture");
});
