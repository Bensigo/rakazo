BEGIN;

-- Organizations remain the company/account boundary. Spaces are the private
-- data, bot, and execution boundary inside an organization.
CREATE TABLE "spaces" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "space_members" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "space_members_pkey" PRIMARY KEY ("id")
);

-- Preserve every existing resource ID and scope by giving each organization
-- a default space with the same ID. No bot, thread, memory, or secret row
-- needs to be rewritten.
INSERT INTO "spaces" ("id", "organizationId", "name", "createdAt")
SELECT "id", "id", "name", "createdAt"
FROM "organization";

INSERT INTO "space_members" (
    "id",
    "spaceId",
    "organizationId",
    "userId",
    "createdAt"
)
SELECT "id", "organizationId", "organizationId", "userId", "createdAt"
FROM "member";

CREATE UNIQUE INDEX "spaces_id_organizationId_key"
ON "spaces"("id", "organizationId");
CREATE INDEX "spaces_organizationId_createdAt_idx"
ON "spaces"("organizationId", "createdAt");
CREATE UNIQUE INDEX "space_members_spaceId_userId_key"
ON "space_members"("spaceId", "userId");
CREATE INDEX "space_members_organizationId_userId_idx"
ON "space_members"("organizationId", "userId");
CREATE INDEX "space_members_userId_createdAt_idx"
ON "space_members"("userId", "createdAt");

ALTER TABLE "spaces"
ADD CONSTRAINT "spaces_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "space_members"
ADD CONSTRAINT "space_members_spaceId_organizationId_fkey"
FOREIGN KEY ("spaceId", "organizationId")
REFERENCES "spaces"("id", "organizationId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "space_members"
ADD CONSTRAINT "space_members_organizationId_userId_fkey"
FOREIGN KEY ("organizationId", "userId")
REFERENCES "member"("organizationId", "userId")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Replace each resource's organization foreign key with the space
-- boundary after the default space backfill makes every existing ID valid.
ALTER TABLE "action_approval_rules" DROP CONSTRAINT "action_approval_rules_workspaceId_fkey";
ALTER TABLE "action_approval_rules" ADD CONSTRAINT "action_approval_rules_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "action_auto_review_preferences" DROP CONSTRAINT "action_auto_review_preferences_workspaceId_fkey";
ALTER TABLE "action_auto_review_preferences" ADD CONSTRAINT "action_auto_review_preferences_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bots" DROP CONSTRAINT "bots_workspaceId_fkey";
ALTER TABLE "bots" ADD CONSTRAINT "bots_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_sections" DROP CONSTRAINT "bot_sections_workspaceId_fkey";
ALTER TABLE "bot_sections" ADD CONSTRAINT "bot_sections_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_deletions" DROP CONSTRAINT "bot_deletions_workspaceId_fkey";
ALTER TABLE "bot_deletions" ADD CONSTRAINT "bot_deletions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_groups" DROP CONSTRAINT "chat_groups_workspaceId_fkey";
ALTER TABLE "chat_groups" ADD CONSTRAINT "chat_groups_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "threads" DROP CONSTRAINT "threads_workspaceId_fkey";
ALTER TABLE "threads" ADD CONSTRAINT "threads_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "events" DROP CONSTRAINT "events_workspaceId_fkey";
ALTER TABLE "events" ADD CONSTRAINT "events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_workspaceId_fkey";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "runs" DROP CONSTRAINT "runs_workspaceId_fkey";
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_effects" DROP CONSTRAINT "external_effects_workspaceId_fkey";
ALTER TABLE "external_effects" ADD CONSTRAINT "external_effects_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "routines" DROP CONSTRAINT "routines_workspaceId_fkey";
ALTER TABLE "routines" ADD CONSTRAINT "routines_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scratchpad_items" DROP CONSTRAINT "scratchpad_items_workspaceId_fkey";
ALTER TABLE "scratchpad_items" ADD CONSTRAINT "scratchpad_items_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "taught_skills" DROP CONSTRAINT "taught_skills_workspaceId_fkey";
ALTER TABLE "taught_skills" ADD CONSTRAINT "taught_skills_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_skills" DROP CONSTRAINT "agent_skills_workspaceId_fkey";
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "connections" DROP CONSTRAINT "connections_workspaceId_fkey";
ALTER TABLE "connections" ADD CONSTRAINT "connections_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "capability_installs" DROP CONSTRAINT "capability_installs_workspaceId_fkey";
ALTER TABLE "capability_installs" ADD CONSTRAINT "capability_installs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memory_documents" DROP CONSTRAINT "memory_documents_workspaceId_fkey";
ALTER TABLE "memory_documents" ADD CONSTRAINT "memory_documents_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_homes" DROP CONSTRAINT "agent_homes_workspaceId_fkey";
ALTER TABLE "agent_homes" ADD CONSTRAINT "agent_homes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "browser_profiles" DROP CONSTRAINT "browser_profiles_workspaceId_fkey";
ALTER TABLE "browser_profiles" ADD CONSTRAINT "browser_profiles_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "computers" DROP CONSTRAINT "computers_workspaceId_fkey";
ALTER TABLE "computers" ADD CONSTRAINT "computers_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "artifacts" DROP CONSTRAINT "artifacts_workspaceId_fkey";
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_records" DROP CONSTRAINT "usage_records_workspaceId_fkey";
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_preferences" DROP CONSTRAINT "notification_preferences_workspaceId_fkey";
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_memory_configs" DROP CONSTRAINT "workspace_memory_configs_workspaceId_fkey";
ALTER TABLE "workspace_memory_configs" ADD CONSTRAINT "workspace_memory_configs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_servers" DROP CONSTRAINT "mcp_servers_workspaceId_fkey";
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
