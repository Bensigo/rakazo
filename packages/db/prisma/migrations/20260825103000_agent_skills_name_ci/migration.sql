-- Environments that already applied the case-sensitive unique index from an earlier revision.
DROP INDEX IF EXISTS "agent_skills_workspaceId_userId_name_key";
DROP INDEX IF EXISTS "agent_skills_workspaceId_userId_name_ci_key";

-- Do not auto-delete or auto-rename: case-variant duplicates are unexpected for this
-- new table, and silent mutation risks losing or colliding with distinct skills.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "agent_skills" AS a
    INNER JOIN "agent_skills" AS b
      ON a."workspaceId" = b."workspaceId"
     AND a."userId" = b."userId"
     AND lower(a."name") = lower(b."name")
     AND a."id" < b."id"
  ) THEN
    RAISE EXCEPTION
      'agent_skills has case-variant duplicate names for the same owner; rename them before applying the case-insensitive unique index';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_skills_workspaceId_userId_name_lower_key"
  ON "agent_skills"("workspaceId", "userId", (lower("name")));
