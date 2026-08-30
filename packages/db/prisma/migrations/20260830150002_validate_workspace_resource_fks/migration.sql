-- The row scans happen here, under SHARE UPDATE EXCLUSIVE instead of the
-- ACCESS EXCLUSIVE an immediately valid foreign key would take, so reads and
-- writes keep running. Prisma applies this file as one transaction: the locks
-- span every validation, but they never block application traffic.
ALTER TABLE "action_approval_rules" VALIDATE CONSTRAINT "action_approval_rules_workspace_fkey";
ALTER TABLE "action_auto_review_preferences" VALIDATE CONSTRAINT "action_auto_review_preferences_workspace_fkey";
ALTER TABLE "bots" VALIDATE CONSTRAINT "bots_workspace_fkey";
ALTER TABLE "bot_sections" VALIDATE CONSTRAINT "bot_sections_workspace_fkey";
ALTER TABLE "bot_deletions" VALIDATE CONSTRAINT "bot_deletions_workspace_fkey";
ALTER TABLE "chat_groups" VALIDATE CONSTRAINT "chat_groups_workspace_fkey";
ALTER TABLE "threads" VALIDATE CONSTRAINT "threads_workspace_fkey";
ALTER TABLE "events" VALIDATE CONSTRAINT "events_workspace_fkey";
ALTER TABLE "tasks" VALIDATE CONSTRAINT "tasks_workspace_fkey";
ALTER TABLE "runs" VALIDATE CONSTRAINT "runs_workspace_fkey";
ALTER TABLE "external_effects" VALIDATE CONSTRAINT "external_effects_workspace_fkey";
ALTER TABLE "routines" VALIDATE CONSTRAINT "routines_workspace_fkey";
ALTER TABLE "scratchpad_items" VALIDATE CONSTRAINT "scratchpad_items_workspace_fkey";
ALTER TABLE "taught_skills" VALIDATE CONSTRAINT "taught_skills_workspace_fkey";
ALTER TABLE "agent_skills" VALIDATE CONSTRAINT "agent_skills_workspace_fkey";
ALTER TABLE "connections" VALIDATE CONSTRAINT "connections_workspace_fkey";
ALTER TABLE "capability_installs" VALIDATE CONSTRAINT "capability_installs_workspace_fkey";
ALTER TABLE "memory_documents" VALIDATE CONSTRAINT "memory_documents_workspace_fkey";
ALTER TABLE "agent_homes" VALIDATE CONSTRAINT "agent_homes_workspace_fkey";
ALTER TABLE "browser_profiles" VALIDATE CONSTRAINT "browser_profiles_workspace_fkey";
ALTER TABLE "computers" VALIDATE CONSTRAINT "computers_workspace_fkey";
ALTER TABLE "artifacts" VALIDATE CONSTRAINT "artifacts_workspace_fkey";
ALTER TABLE "usage_records" VALIDATE CONSTRAINT "usage_records_workspace_fkey";
ALTER TABLE "notification_preferences" VALIDATE CONSTRAINT "notification_preferences_workspace_fkey";
ALTER TABLE "workspace_memory_configs" VALIDATE CONSTRAINT "workspace_memory_configs_workspace_fkey";
ALTER TABLE "mcp_servers" VALIDATE CONSTRAINT "mcp_servers_workspace_fkey";
