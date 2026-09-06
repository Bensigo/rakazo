import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("opens the Studio workspace from the main shell", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `studio-${stamp}@rakazo.test`, "password12", "Studio Owner");
  await completeOnboarding(page);
  await page.getByRole("button", { name: "Open Studio" }).click();
  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.getByTestId("studio-page")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Foundation, roles, and projects" }),
  ).toBeVisible();
  await captureScreenshot(page, testInfo, "studio-workspace");
});
