import { describe, expect, it } from "vitest";
import {
  parseRegisteredStudioRepositories,
  registeredRepositoryForOrganization,
  repositoriesForOrganization,
} from "./studio-repository-registry.js";

const configured = [
  {
    id: "game",
    organizationId: "org-1",
    label: "Game repository",
    checkoutPath: "/srv/studio/game",
    sourceId: "github:studio/game",
    refKey: "workspace",
  },
  {
    id: "private",
    organizationId: "org-2",
    label: "Private repository",
    checkoutPath: "/srv/studio/private",
    sourceId: "github:other/private",
    refKey: "workspace",
  },
];

describe("Studio repository registry", () => {
  it("returns only public labels registered to the active organization", () => {
    expect(repositoriesForOrganization(configured, "org-1")).toEqual([
      { id: "game", label: "Game repository" },
    ]);
    expect(registeredRepositoryForOrganization(configured, "org-1", "private")).toBeUndefined();
  });

  it("requires absolute server paths and rejects unknown configuration fields", () => {
    expect(() =>
      parseRegisteredStudioRepositories(
        JSON.stringify([{ ...configured[0], checkoutPath: "../../client/path" }]),
      ),
    ).toThrow("invalid repository entry");
    expect(() =>
      parseRegisteredStudioRepositories(
        JSON.stringify([{ ...configured[0], providerToken: "must-not-exist" }]),
      ),
    ).toThrow("invalid repository entry");
  });

  it("rejects duplicate public and canonical identities within one organization", () => {
    expect(() =>
      parseRegisteredStudioRepositories(JSON.stringify([configured[0], configured[0]])),
    ).toThrow("duplicate repository id");
    expect(() =>
      parseRegisteredStudioRepositories(
        JSON.stringify([configured[0], { ...configured[0], id: "game-copy" }]),
      ),
    ).toThrow("duplicate source identity");
  });
});
