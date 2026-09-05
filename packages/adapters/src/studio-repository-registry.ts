import { isAbsolute } from "node:path";
import { z } from "zod";

const stableIdentity = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      ![...value].some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return /\s/u.test(character) || code < 32 || code === 127;
      }),
    "must be a stable identity",
  );

const registeredStudioRepositorySchema = z
  .object({
    id: stableIdentity,
    organizationId: stableIdentity,
    label: z.string().trim().min(1).max(160),
    checkoutPath: z.string().min(1).max(4096).refine(isAbsolute, "must be an absolute server path"),
    sourceId: stableIdentity,
    refKey: stableIdentity,
  })
  .strict();

export type RegisteredStudioRepository = z.infer<typeof registeredStudioRepositorySchema>;

export interface PublicStudioRepository {
  id: string;
  label: string;
}

export function parseRegisteredStudioRepositories(
  serialized: string | undefined,
): RegisteredStudioRepository[] {
  if (!serialized) return [];
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("SUNRISE_STUDIO_REPOSITORIES must be valid JSON.");
  }
  const parsed = z.array(registeredStudioRepositorySchema).max(100).safeParse(value);
  if (!parsed.success) {
    throw new Error("SUNRISE_STUDIO_REPOSITORIES has an invalid repository entry.");
  }
  const identities = new Set<string>();
  const sources = new Set<string>();
  for (const repository of parsed.data) {
    const identity = `${repository.organizationId}\u0000${repository.id}`;
    const source = `${repository.organizationId}\u0000${repository.sourceId}\u0000${repository.refKey}`;
    if (identities.has(identity)) {
      throw new Error("SUNRISE_STUDIO_REPOSITORIES has a duplicate repository id.");
    }
    if (sources.has(source)) {
      throw new Error("SUNRISE_STUDIO_REPOSITORIES has a duplicate source identity.");
    }
    identities.add(identity);
    sources.add(source);
  }
  return parsed.data;
}

export function repositoriesForOrganization(
  repositories: readonly RegisteredStudioRepository[],
  organizationId: string,
): PublicStudioRepository[] {
  return repositories
    .filter((repository) => repository.organizationId === organizationId)
    .map(({ id, label }) => ({ id, label }))
    .sort(
      (left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
    );
}

export function registeredRepositoryForOrganization(
  repositories: readonly RegisteredStudioRepository[],
  organizationId: string,
  repositoryId: string,
): RegisteredStudioRepository | undefined {
  return repositories.find(
    (repository) => repository.organizationId === organizationId && repository.id === repositoryId,
  );
}
