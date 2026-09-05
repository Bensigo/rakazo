import { expect, test } from "@playwright/test";

test.describe("Studio UI fixture", () => {
  test("keeps assignment scope and execution boundaries visible", async ({ page }) => {
    await page.goto("/e2e/fixtures/studio-preview.html");

    await expect(page.getByRole("heading", { name: "Your studio workplace" })).toBeVisible();
    await expect(page.getByText("UI fixture · synthetic data · execution disabled")).toBeVisible();

    const objective = page.getByLabel("Assignment objective");
    const specialist = page.getByLabel("Specialist");
    const scope = page.getByLabel("Assignment scope");
    const assign = page.getByRole("button", { name: "Assign work" });
    await expect(assign).toBeDisabled();

    await objective.fill("Review the next mobile game slice and return evidence.");
    await specialist.selectOption({ label: "Engineer" });
    await scope.selectOption("one");
    await expect(assign).toBeDisabled();

    const garden = page
      .locator("label")
      .filter({ hasText: "Garden Tiles" })
      .locator("input[type=checkbox]");
    await garden.check();
    await expect(assign).toBeEnabled();

    await scope.selectOption("multi");
    await garden.check();
    await expect(assign).toBeDisabled();
    await page.getByRole("checkbox", { name: "Moon Runner Project" }).check();
    await expect(assign).toBeEnabled();

    await scope.selectOption("studio");
    await expect(assign).toBeEnabled();
    await expect(garden).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
  });
});
