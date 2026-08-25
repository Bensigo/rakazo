-- Environments that already applied the case-sensitive unique index from an earlier revision.
DROP INDEX IF EXISTS "agent_skills_workspaceId_userId_name_key";
DROP INDEX IF EXISTS "agent_skills_workspaceId_userId_name_ci_key";

-- Reconcile case-variant duplicates (e.g. Standup + standup) before the CI unique index.
-- Keep the most recently updated row per (workspaceId, userId, lower(name)).
DELETE FROM "agent_skills" a
USING "agent_skills" b
WHERE a."workspaceId" = b."workspaceId"
  AND a."userId" = b."userId"
  AND lower(a."name") = lower(b."name")
  AND (
    a."updatedAt" < b."updatedAt"
    OR (a."updatedAt" = b."updatedAt" AND a."id" < b."id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "agent_skills_workspaceId_userId_name_lower_key"
  ON "agent_skills"("workspaceId", "userId", (lower("name")));
