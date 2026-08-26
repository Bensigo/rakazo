import type { ConnectionCatalogItem } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  buildFeaturedConnectorTiles,
  featuredConnectorProvidersMatch,
  matchFeaturedConnectorId,
  resolveFeaturedCatalogItem,
} from "./featured-connectors.js";

function item(
  slug: string,
  name: string,
  connected = false,
): ConnectionCatalogItem {
  return {
    connectorId: "composio",
    slug,
    name,
    logo: null,
    connected,
    noAuth: false,
  };
}

describe("featured connectors", () => {
  it("maps gmail aliases to the same featured id", () => {
    expect(matchFeaturedConnectorId("gmail")).toBe("gmail");
    expect(matchFeaturedConnectorId("Google Mail")).toBe("gmail");
    expect(matchFeaturedConnectorId("GMAIL")).toBe("gmail");
    expect(featuredConnectorProvidersMatch("gmail", "Google Mail")).toBe(true);
  });

  it("maps calendar and drive catalog slugs", () => {
    expect(matchFeaturedConnectorId("googlecalendar")).toBe("google-calendar");
    expect(matchFeaturedConnectorId("google_drive")).toBe("google-drive");
    expect(matchFeaturedConnectorId("googledrive")).toBe("google-drive");
  });

  it("returns null for unknown catalog entries", () => {
    expect(matchFeaturedConnectorId("notion")).toBeNull();
    expect(resolveFeaturedCatalogItem("gmail", [item("notion", "Notion")])).toBeUndefined();
  });

  it("resolves featured rows from slug or display name", () => {
    const catalog = [
      item("gmail", "Gmail"),
      item("microsoft_outlook", "Microsoft Outlook"),
      item("salesforce", "Salesforce"),
    ];
    expect(resolveFeaturedCatalogItem("gmail", catalog)?.slug).toBe("gmail");
    expect(resolveFeaturedCatalogItem("outlook", catalog)?.slug).toBe("microsoft_outlook");
    expect(resolveFeaturedCatalogItem("salesforce", catalog)?.slug).toBe("salesforce");
  });

  it("marks all featured tiles missing when the catalog is empty", () => {
    const tiles = buildFeaturedConnectorTiles([]);
    expect(tiles).toHaveLength(6);
    expect(tiles.every((tile) => !tile.item && !tile.missing)).toBe(true);
  });

  it("marks unknown featured apps missing when the catalog has other apps", () => {
    const tiles = buildFeaturedConnectorTiles([item("gmail", "Gmail", true)]);
    const gmail = tiles.find((tile) => tile.id === "gmail");
    const drive = tiles.find((tile) => tile.id === "google-drive");
    expect(gmail?.item?.connected).toBe(true);
    expect(gmail?.missing).toBe(false);
    expect(drive?.missing).toBe(true);
    expect(drive?.item).toBeUndefined();
  });
});
