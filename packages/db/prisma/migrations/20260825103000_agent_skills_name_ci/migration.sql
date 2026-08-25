-- Environments that already applied the case-sensitive unique index from an earlier revision.
DROP INDEX IF EXISTS "agent_skills_workspaceId_userId_name_key";
DROP INDEX IF EXISTS "agent_skills_workspaceId_userId_name_ci_key";

CREATE UNIQUE INDEX IF NOT EXISTS "agent_skills_workspaceId_userId_name_lower_key"
  ON "agent_skills"("workspaceId", "userId", (lower("name")));
