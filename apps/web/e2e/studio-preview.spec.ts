import { expect, test } from "@playwright/test";

test.describe("Studio UI fixture", () => {
  test("keeps assignment scope and execution boundaries visible", async ({ page }) => {
    await page.goto("/e2e/fixtures/studio-preview.html");

    await expect(page.getByRole("heading", { name: "Your studio workplace" })).toBeVisible();
    await expect(page.getByText("UI fixture · synthetic data · execution disabled")).toBeVisible();

    const objective = page.getByLabel("Assignment objective");
    const specialist = page.getByRole("combobox", { name: "Specialist" });
    const scope = page.getByLabel("Assignment scope");
    const assign = page.getByRole("button", { name: "Assign work" });
    await expect(assign).toBeDisabled();

    await objective.fill("Review the next mobile game slice and return evidence.");
    await specialist.selectOption({ label: "Engineer" });
    const computer = page.getByLabel("Computer", { exact: true });
    await expect(computer).toHaveValue("fixture-server-computer");
    await expect(computer.locator("option:checked")).toContainText("Specialist computer · docker");
    await computer.selectOption("fixture-build-mac");
    await expect(computer.locator("option:checked")).toContainText("Build Mac · employee-host");
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
    await expect(page.getByRole("button", { name: "Register" })).toBeDisabled();
  });

  test("selects an employee job role and refreshes specialist options", async ({ page }) => {
    await page.goto("/e2e/fixtures/studio-preview.html");

    const jobRole = page.getByRole("combobox", { name: "Your job role" });
    await expect(jobRole).toBeVisible();
    await jobRole.selectOption("fixture-job-role");
    await page.getByRole("button", { name: "Apply and provision specialists" }).click();

    const provisioned = page.getByText("1 specialists provisioned for you");
    await expect(provisioned).toBeVisible();
    await expect(provisioned.locator("..").getByText("Engineer", { exact: true })).toBeVisible();
    const specialist = page.getByRole("combobox", { name: "Specialist" });
    await expect(specialist.locator("option", { hasText: "Engineer (yours)" })).toHaveCount(1);

    await page.getByRole("button", { name: "Apply and provision specialists" }).click();
    await expect(page.getByText("1 specialists provisioned for you")).toHaveCount(1);
  });

  test("keeps the prior provisioned team after a failed apply", async ({ page }) => {
    await page.goto("/e2e/fixtures/studio-preview.html?fail-after-first");

    const jobRole = page.getByRole("combobox", { name: "Your job role" });
    const apply = page.getByRole("button", { name: "Apply and provision specialists" });
    await jobRole.selectOption("fixture-job-role");
    await apply.click();
    await expect(page.getByText("1 specialists provisioned for you")).toBeVisible();

    await apply.click();
    await expect(page.getByRole("alert")).toContainText("Service Unavailable");
    await expect(page.getByText("1 specialists provisioned for you")).toBeVisible();
  });

  test("disables apply while provisioning is pending", async ({ page }) => {
    await page.goto("/e2e/fixtures/studio-preview.html?slow-role");

    const jobRole = page.getByRole("combobox", { name: "Your job role" });
    await jobRole.selectOption("fixture-job-role");
    const apply = page.getByRole("button", { name: "Apply and provision specialists" });
    await apply.click();
    await expect(jobRole).toBeDisabled();
    await expect(page.getByRole("button", { name: "Provisioning…" })).toBeDisabled();
    await expect(page.getByText("1 specialists provisioned for you")).toBeVisible();
  });

  test("gates administration for a regular member", async ({ page }) => {
    await page.goto("/e2e/fixtures/studio-preview.html?member");

    await expect(page.getByLabel("Studio goals")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Publish revision" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Create role" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Create employee role" })).toBeDisabled();
  });

  test("shows and edits default specialist order", async ({ page }) => {
    await page.goto("/e2e/fixtures/studio-preview.html");

    await page.getByRole("checkbox", { name: "Default specialist Engineer" }).check();
    await page.getByRole("checkbox", { name: "Default specialist Reviewer" }).check();
    await expect(page.getByText("1. Engineer", { exact: true })).toBeVisible();
    await expect(page.getByText("2. Reviewer", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Move Reviewer up" }).click();
    await expect(page.getByText("1. Reviewer", { exact: true })).toBeVisible();
    await expect(page.getByText("2. Engineer", { exact: true })).toBeVisible();
  });
});
