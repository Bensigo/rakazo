-- Environments that already applied the case-sensitive unique index from an earlier revision.
DROP INDEX IF EXISTS "agent_skills_workspaceId_userId_name_key";
DROP INDEX IF EXISTS "agent_skills_workspaceId_userId_name_ci_key";

-- Preserve case-variant duplicates (e.g. Standup + standup) by renaming older rows so
-- lower(name) is unique without discarding skill content.
UPDATE "agent_skills" AS older
SET "name" = left(older."name", 64) || ' ·' || right(older."id", 6)
FROM "agent_skills" AS newer
WHERE older."workspaceId" = newer."workspaceId"
  AND older."userId" = newer."userId"
  AND lower(older."name") = lower(newer."name")
  AND older."id" <> newer."id"
  AND (
    older."updatedAt" < newer."updatedAt"
    OR (older."updatedAt" = newer."updatedAt" AND older."id" < newer."id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "agent_skills_workspaceId_userId_name_lower_key"
  ON "agent_skills"("workspaceId", "userId", (lower("name")));
