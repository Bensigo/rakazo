import { describe, expect, it, vi } from "vitest";
import {
  executeGraphqlOperation,
  importGraphqlSchema,
  prepareGraphqlInstall,
} from "./graphql-connectors.js";
import { InstalledConnectorProvider } from "./installed-connectors.js";

const STAR_WARS_INTROSPECTION = {
  data: {
    __schema: {
      queryType: { name: "Query" },
      mutationType: { name: "Mutation" },
      types: [
        {
          kind: "OBJECT",
          name: "Query",
          fields: [
            {
              name: "hero",
              description: "Fetch a hero",
              args: [
                {
                  name: "episode",
                  type: { kind: "ENUM", name: "Episode", ofType: null },
                  defaultValue: null,
                },
              ],
              type: { kind: "OBJECT", name: "Character", ofType: null },
            },
            {
              name: "hello",
              description: "Plain hello",
              args: [],
              type: { kind: "SCALAR", name: "String", ofType: null },
            },
          ],
        },
        {
          kind: "OBJECT",
          name: "Mutation",
          fields: [
            {
              name: "createNote",
              description: "Create a note",
              args: [
                {
                  name: "text",
                  type: {
                    kind: "NON_NULL",
                    name: null,
                    ofType: { kind: "SCALAR", name: "String", ofType: null },
                  },
                  defaultValue: null,
                },
              ],
              type: { kind: "SCALAR", name: "String", ofType: null },
            },
          ],
        },
        {
          kind: "OBJECT",
          name: "Character",
          fields: [
            {
              name: "name",
              args: [],
              type: { kind: "SCALAR", name: "String", ofType: null },
            },
            {
              name: "appearsIn",
              args: [],
              type: {
                kind: "LIST",
                name: null,
                ofType: { kind: "ENUM", name: "Episode", ofType: null },
              },
            },
          ],
        },
        {
          kind: "ENUM",
          name: "Episode",
          enumValues: [{ name: "NEWHOPE" }, { name: "EMPIRE" }, { name: "JEDI" }],
        },
        { kind: "SCALAR", name: "String" },
      ],
    },
  },
};

describe("GraphQL connector import", () => {
  it("maps introspection fields into bounded agent tools", () => {
    const operations = importGraphqlSchema(STAR_WARS_INTROSPECTION);
    expect(operations.map((operation) => operation.id)).toEqual([
      "query_hero",
      "query_hello",
      "mutation_createNote",
    ]);
    const hero = operations[0]!;
    expect(hero.readOnly).toBe(true);
    expect(hero.variableTypes.episode).toBe("Episode");
    expect(hero.selection).toContain("name");
    expect(hero.selection).toContain("appearsIn");
    expect(operations[2]!.readOnly).toBe(false);
    expect(operations[2]!.inputSchema).toMatchObject({
      type: "object",
      required: ["text"],
    });
  });

  it("introspects a GraphQL endpoint over the SSRF-safe fetch path", async () => {
    const fetch = vi.fn(async () =>
      Response.json(STAR_WARS_INTROSPECTION, {
        headers: { "content-type": "application/json" },
      }),
    );
    const prepared = await prepareGraphqlInstall({
      source: "https://graphql.example.test/graphql",
      config: { auth: { type: "none" } },
      remote: {
        fetch: fetch as unknown as typeof globalThis.fetch,
        resolveHostname: async () => [{ address: "203.0.113.10", family: 4 as const }],
      },
    });
    expect(prepared.operationCount).toBe(3);
    expect(prepared.source).toBe("https://graphql.example.test/graphql");
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(fetch.mock.calls)).toContain("__schema");
  });

  it("refuses private GraphQL endpoints during install", async () => {
    await expect(
      prepareGraphqlInstall({
        source: "https://127.0.0.1/graphql",
        config: { auth: { type: "none" } },
      }),
    ).rejects.toThrow();
  });

  it("refuses credentials embedded in a GraphQL endpoint URL", async () => {
    await expect(
      prepareGraphqlInstall({
        source: "https://graphql.example.test/graphql?access_token=secret",
        config: { auth: { type: "none" } },
      }),
    ).rejects.toThrow(/encrypted credential field/);
  });

  it("skips nested fields that require arguments in generated selections", () => {
    const operations = importGraphqlSchema({
      data: {
        __schema: {
          queryType: { name: "Query" },
          mutationType: null,
          types: [
            {
              kind: "OBJECT",
              name: "Query",
              fields: [
                {
                  name: "viewer",
                  args: [],
                  type: { kind: "OBJECT", name: "User", ofType: null },
                },
              ],
            },
            {
              kind: "OBJECT",
              name: "User",
              fields: [
                {
                  name: "id",
                  args: [],
                  type: { kind: "SCALAR", name: "ID", ofType: null },
                },
                {
                  name: "repository",
                  args: [
                    {
                      name: "name",
                      type: {
                        kind: "NON_NULL",
                        name: null,
                        ofType: { kind: "SCALAR", name: "String", ofType: null },
                      },
                      defaultValue: null,
                    },
                  ],
                  type: { kind: "OBJECT", name: "Repository", ofType: null },
                },
              ],
            },
            {
              kind: "OBJECT",
              name: "Repository",
              fields: [
                {
                  name: "name",
                  args: [],
                  type: { kind: "SCALAR", name: "String", ofType: null },
                },
              ],
            },
            { kind: "SCALAR", name: "ID" },
            { kind: "SCALAR", name: "String" },
          ],
        },
      },
    });
    expect(operations[0]!.selection).toContain("id");
    expect(operations[0]!.selection).not.toContain("repository");
  });

  it("keeps mutations when a large query catalog would otherwise fill the cap", () => {
    const queryFields = Array.from({ length: 100 }, (_, index) => ({
      name: `queryField${index}`,
      args: [],
      type: { kind: "SCALAR", name: "String", ofType: null },
    }));
    const operations = importGraphqlSchema({
      data: {
        __schema: {
          queryType: { name: "Query" },
          mutationType: { name: "Mutation" },
          types: [
            { kind: "OBJECT", name: "Query", fields: queryFields },
            {
              kind: "OBJECT",
              name: "Mutation",
              fields: [
                {
                  name: "doThing",
                  args: [],
                  type: { kind: "SCALAR", name: "String", ofType: null },
                },
              ],
            },
            { kind: "SCALAR", name: "String" },
          ],
        },
      },
    });
    expect(operations.length).toBeLessThanOrEqual(100);
    expect(operations.some((operation) => operation.id === "mutation_doThing")).toBe(true);
    expect(operations.some((operation) => operation.operationType === "query")).toBe(true);
  });
});

describe("GraphQL execution failures", () => {
  it("throws when the GraphQL response includes protocol errors", async () => {
    const operation = importGraphqlSchema(STAR_WARS_INTROSPECTION)[0]!;
    await expect(
      executeGraphqlOperation(
        "https://graphql.example.test/graphql",
        { auth: { type: "none" }, headers: {}, operations: [operation] },
        operation,
        {},
        undefined,
        new AbortController().signal,
        {
          fetch: async () => Response.json({ errors: [{ message: "Field 'hero' is required" }] }),
          resolveHostname: async () => [{ address: "203.0.113.10", family: 4 as const }],
        },
      ),
    ).rejects.toThrow(/Field 'hero' is required/);
  });

  it("throws when the GraphQL HTTP response is not successful", async () => {
    const operation = importGraphqlSchema(STAR_WARS_INTROSPECTION)[0]!;
    await expect(
      executeGraphqlOperation(
        "https://graphql.example.test/graphql",
        { auth: { type: "none" }, headers: {}, operations: [operation] },
        operation,
        {},
        undefined,
        new AbortController().signal,
        {
          fetch: async () =>
            new Response("nope", { status: 500, headers: { "content-type": "text/plain" } }),
          resolveHostname: async () => [{ address: "203.0.113.10", family: 4 as const }],
        },
      ),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe("GraphQL optional-off", () => {
  it("keeps core discovery empty when no GraphQL source is installed", async () => {
    const prisma = {
      capabilityInstall: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
      },
    };
    const provider = new InstalledConnectorProvider(prisma as never, {} as never);
    const tools = await provider.discoverTools({
      spaceId: "space-1",
      userId: "user-1",
      signal: new AbortController().signal,
    } as never);
    expect(tools).toEqual([]);
    expect(prisma.capabilityInstall.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: { in: ["mcp", "api", "graphql"] },
        }),
      }),
    );
  });
});
