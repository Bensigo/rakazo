-- Add the replacement constraints without scanning existing rows. NOT VALID
-- keeps every ACCESS EXCLUSIVE lock below to a metadata-only change; Prisma
-- applies this file as one transaction, so the locks are held together until
-- the file commits rather than table by table.
ALTER TABLE "action_approval_rules" ADD CONSTRAINT "action_approval_rules_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "action_auto_review_preferences" ADD CONSTRAINT "action_auto_review_preferences_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "bots" ADD CONSTRAINT "bots_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "bot_sections" ADD CONSTRAINT "bot_sections_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "bot_deletions" ADD CONSTRAINT "bot_deletions_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "chat_groups" ADD CONSTRAINT "chat_groups_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "threads" ADD CONSTRAINT "threads_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "events" ADD CONSTRAINT "events_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "external_effects" ADD CONSTRAINT "external_effects_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "routines" ADD CONSTRAINT "routines_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "scratchpad_items" ADD CONSTRAINT "scratchpad_items_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "taught_skills" ADD CONSTRAINT "taught_skills_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "connections" ADD CONSTRAINT "connections_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "capability_installs" ADD CONSTRAINT "capability_installs_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "memory_documents" ADD CONSTRAINT "memory_documents_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "agent_homes" ADD CONSTRAINT "agent_homes_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "browser_profiles" ADD CONSTRAINT "browser_profiles_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "computers" ADD CONSTRAINT "computers_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "workspace_memory_configs" ADD CONSTRAINT "workspace_memory_configs_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "mcp_servers" ADD CONSTRAINT "mcp_servers_workspace_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
