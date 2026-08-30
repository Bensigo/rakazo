import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("private spaces keep all bots in the sidebar and switch the request boundary", async ({
  page,
}, testInfo) => {
  const stamp = Date.now();
  await signup(page, `private-spaces-${stamp}@rakazo.test`, "password12", "Space Owner");
  await completeOnboarding(page);

  await page.getByTitle("Create").click();
  await page.getByRole("button", { name: "New private space" }).click();
  const dialog = page.getByRole("dialog", { name: "New private space" });
  await expect(dialog.getByLabel("Name")).toBeVisible();
  await dialog.getByLabel("Name").fill("Customer support");
  await captureScreenshot(page, testInfo, "new-private-space-dialog");
  await dialog.getByRole("button", { name: "Create space" }).click();

  await page.waitForURL(/\/onboarding/);
  const supportSpaceId = await page.evaluate(() =>
    window.localStorage.getItem("rakazo:private-space-id"),
  );
  expect(supportSpaceId).toBeTruthy();
  await completeOnboarding(page);

  const sidebar = page.locator("aside").first();
  await expect(sidebar.getByText("Personal", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Customer support", { exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /^Chief/ })).toHaveCount(2);
  await captureScreenshot(page, testInfo, "private-spaces-sidebar");

  const personalSpace = sidebar
    .locator('[data-sidebar-group^="space:"]')
    .filter({ hasText: "Personal" });
  await personalSpace.getByRole("button", { name: /^Chief/ }).click();
  await page.waitForURL(/\/app\/[^/]+$/);
  await expect
    .poll(() => page.evaluate(() => window.localStorage.getItem("rakazo:private-space-id")))
    .not.toBe(supportSpaceId);
  await expect(sidebar.getByText("Customer support", { exact: true })).toBeVisible();
});
