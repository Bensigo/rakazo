import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { completeOnboarding, signup } from "./helpers";

const FEATURED_CATALOG = [
  {
    connectorId: "composio",
    slug: "GMAIL",
    name: "Gmail",
    logo: null,
    connected: false,
    noAuth: false,
  },
  {
    connectorId: "composio",
    slug: "GOOGLECALENDAR",
    name: "Google Calendar",
    logo: null,
    connected: false,
    noAuth: false,
  },
  {
    connectorId: "composio",
    slug: "GOOGLEDRIVE",
    name: "Google Drive",
    logo: null,
    connected: false,
    noAuth: false,
  },
  {
    connectorId: "composio",
    slug: "OUTLOOK",
    name: "Outlook",
    logo: null,
    connected: false,
    noAuth: false,
  },
  {
    connectorId: "composio",
    slug: "MICROSOFT_TEAMS",
    name: "Microsoft Teams",
    logo: null,
    connected: false,
    noAuth: false,
  },
  {
    connectorId: "composio",
    slug: "SALESFORCE",
    name: "Salesforce",
    logo: null,
    connected: false,
    noAuth: false,
  },
] as const;

const FEATURED_LABELS = [
  "Gmail",
  "Google Calendar",
  "Google Drive",
  "Outlook",
  "Microsoft Teams",
  "Salesforce",
] as const;

const artifactsDir = process.env.FEATURED_SCREENSHOT_DIR ?? "/opt/cursor/artifacts";

async function stubCatalog(page: Page, items: readonly (typeof FEATURED_CATALOG)[number][] | []) {
  await page.unroute("**/rpc/connections/catalog").catch(() => undefined);
  await page.route("**/rpc/connections/catalog", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ json: items }),
    });
  });
}

async function openIntegrations(page: Page) {
  await page.getByText("Integrations").click();
  await expect(page.getByPlaceholder("Search apps")).toBeVisible();
  await expect(page.getByText("Featured apps", { exact: true })).toBeVisible();
}

async function closeIntegrations(page: Page) {
  await page.getByRole("button", { name: "Close integrations" }).click();
  await expect(page.getByPlaceholder("Search apps")).toBeHidden();
}

async function saveFeaturedShot(page: Page, filename: string) {
  await mkdir(artifactsDir, { recursive: true });
  const overlay = page
    .locator("div")
    .filter({ has: page.getByText("Featured apps", { exact: true }) })
    .filter({ has: page.getByPlaceholder("Search apps") })
    .first();
  const target = overlay.locator("div.mb-6").filter({ hasText: "Featured apps" }).first();
  const out = path.join(artifactsDir, filename);
  await target.screenshot({
    animations: "disabled",
    caret: "hide",
    path: out,
  });
  // Also keep a copy under test-results for local debugging.
  const debugDir = path.resolve("test-results", "featured-connectors");
  await mkdir(debugDir, { recursive: true });
  await copyFile(out, path.join(debugDir, filename));
  return out;
}

test("featured connector tiles and empty-catalog note", async ({ page }) => {
  const stamp = Date.now();
  await signup(page, `featured-${stamp}@rakazo.test`, "password12", "Featured");
  await completeOnboarding(page);
  await expect(page.getByText("Chief").first()).toBeVisible();

  await stubCatalog(page, FEATURED_CATALOG);
  await openIntegrations(page);

  for (const label of FEATURED_LABELS) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toHaveCount(6);
  await expect(
    page.getByText(
      "Configure a plugin catalog (Composio or Pipedream) on the server to connect apps.",
    ),
  ).toBeHidden();

  const tilesPath = await saveFeaturedShot(page, "featured_integrations_tiles.png");
  expect(tilesPath).toBeTruthy();

  await closeIntegrations(page);
  await stubCatalog(page, []);
  await openIntegrations(page);

  await expect(
    page.getByText(
      "Configure a plugin catalog (Composio or Pipedream) on the server to connect apps.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect", exact: true })).toHaveCount(0);
  // No fake Google login chrome.
  await expect(page.getByText(/Sign in with Google|Google login/i)).toHaveCount(0);

  const emptyPath = await saveFeaturedShot(page, "featured_integrations_empty_catalog.png");
  expect(emptyPath).toBeTruthy();
});
