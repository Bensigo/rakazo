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

  test("selects an employee job role and refreshes specialist options", async ({ page }) => {
    await page.goto("/e2e/fixtures/studio-preview.html");

    const jobRole = page.getByRole("combobox", { name: "Your job role" });
    await expect(jobRole).toBeVisible();
    await jobRole.selectOption("fixture-job-role");
    await page.getByRole("button", { name: "Apply and provision specialists" }).click();

    await expect(page.getByText("1 specialists provisioned for you")).toBeVisible();
    await expect(page.getByText("Engineer", { exact: false }).last()).toBeVisible();
    const specialist = page.getByRole("combobox", { name: "Specialist" });
    await expect(specialist.locator("option", { hasText: "Engineer (yours)" })).toHaveCount(1);

    await page.getByRole("button", { name: "Apply and provision specialists" }).click();
    await expect(page.getByText("1 specialists provisioned for you")).toHaveCount(1);
  });
});
