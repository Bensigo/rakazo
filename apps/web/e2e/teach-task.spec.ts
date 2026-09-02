import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("teach a task records interaction and saves a draft", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `teach-${stamp}@rakazo.test`, "password12", "Teach");
  await completeOnboarding(page);

  await page.getByTitle("Agent computer").click();
  const sidePanel = page.getByTestId("side-panel");
  await expect(sidePanel).toHaveAttribute("data-panel", "computer");
  await expect(sidePanel.getByText("Teach a task")).toHaveCount(0);
  await expect(sidePanel.getByTestId("teach-start-button")).toHaveCount(0);
  await captureScreenshot(page, testInfo, "teach-sidepanel-no-teach");

  await sidePanel.getByRole("button", { name: "Take control" }).click();
  await expect(page.getByRole("button", { name: "Close computer" })).toBeVisible();
  await expect(page.getByTestId("teach-start-button")).toBeVisible();
  await captureScreenshot(page, testInfo, "teach-computer-overlay");

  await page.getByTestId("teach-start-button").click();
  await page.getByTestId("teach-goal-input").fill("Export weekly CRM list");
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByTestId("teach-recording-overlay")).toBeVisible();
  await expect(page.getByTestId("teach-capture-overlay")).toBeVisible();
  await page.getByTestId("teach-capture-overlay").click({ position: { x: 200, y: 200 } });
  await page.keyboard.type("demo");
  await page.getByTestId("teach-stop-overlay").click();
  await expect(page.getByTestId("skill-draft-card")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("skill-draft-card").getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByTestId("skill-draft-card").getByRole("button", { name: "Saved" }),
  ).toBeVisible({ timeout: 10_000 });
});
