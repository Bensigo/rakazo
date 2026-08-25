import { expect, test } from "@playwright/test";
import { completeOnboarding, rpc, signup } from "./helpers";

test("composer / picker lists skills above actions", async ({ page }) => {
  const stamp = Date.now();
  await signup(page, `slash-skills-${stamp}@rakazo.test`, "password12", "Slash Skills");
  await completeOnboarding(page);
  await page.goto("/app");
  await page.waitForURL(/\/app\/[^/]+$/);

  await rpc(page, "agentSkills/create", {
    name: "Daily standup",
    description:
      "Prepare a concise standup update from recent work. Use when the user asks for standup notes.",
    body: "1. Summarize wins.\n2. List blockers.",
  });

  const composer = page.getByPlaceholder(/^Message /);
  await expect(composer).toBeVisible();
  await composer.fill("/");

  const picker = page.getByTestId("slash-picker");
  await expect(picker).toBeVisible();
  const skillButton = picker.getByRole("button", { name: "Skill Daily standup" });
  const chatSettings = picker.getByRole("button", { name: "Chat Settings" });
  await expect(skillButton).toBeVisible();
  await expect(chatSettings).toBeVisible();
  await expect(picker.getByRole("button", { name: "Settings: General" })).toBeVisible();
  await expect(picker.getByRole("button", { name: "Settings: Usage & Billing" })).toBeVisible();

  const skillBox = skillButton.boundingBox();
  const actionBox = chatSettings.boundingBox();
  const skill = await skillBox;
  const action = await actionBox;
  expect(skill).toBeTruthy();
  expect(action).toBeTruthy();
  expect(skill!.y).toBeLessThan(action!.y);

  await expect(skillButton).toContainText("Prepare a concise standup");

  await skillButton.click();
  await expect(composer).toHaveValue("/Daily standup\n");

  await composer.fill("hello /");
  await expect(page.getByTestId("slash-picker")).toHaveCount(0);

  await composer.fill("@");
  await expect(page.getByTestId("slash-picker")).toHaveCount(0);
});
