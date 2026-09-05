CREATE TABLE "studio_foundations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "currentRevisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "studio_foundations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "studio_foundations_organizationId_key" ON "studio_foundations"("organizationId");
CREATE TABLE "foundation_revisions" (
    "id" TEXT NOT NULL,
    "foundationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "foundation_revisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "foundation_revisions_foundationId_revision_key" ON "foundation_revisions"("foundationId", "revision");
CREATE INDEX "foundation_revisions_foundationId_createdAt_idx" ON "foundation_revisions"("foundationId", "createdAt");
CREATE TABLE "employee_role_presets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "foundationRevisionId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL DEFAULT '',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "employee_role_presets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employee_role_presets_organizationId_key_key" ON "employee_role_presets"("organizationId", "key");
CREATE INDEX "employee_role_presets_organizationId_isDefault_idx" ON "employee_role_presets"("organizationId", "isDefault");
CREATE TABLE "studio_projects" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'studio',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "studio_projects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "studio_projects_organizationId_slug_key" ON "studio_projects"("organizationId", "slug");
CREATE INDEX "studio_projects_organizationId_scope_idx" ON "studio_projects"("organizationId", "scope");
CREATE TABLE "project_source_bindings" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "repository" TEXT,
    "ref" TEXT,
    "path" TEXT,
    "metadata" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_source_bindings_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_source_bindings_projectId_kind_idx" ON "project_source_bindings"("projectId", "kind");
CREATE TABLE "assignment_manifests" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "foundationRevisionId" TEXT,
    "rolePresetId" TEXT,
    "manifest" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "assignment_manifests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "assignment_manifests_taskId_key" ON "assignment_manifests"("taskId");
CREATE INDEX "assignment_manifests_projectId_status_idx" ON "assignment_manifests"("projectId", "status");
CREATE INDEX "assignment_manifests_botId_status_idx" ON "assignment_manifests"("botId", "status");
ALTER TABLE "bots" ADD COLUMN "rolePresetId" TEXT;
ALTER TABLE "tasks" ADD COLUMN "projectId" TEXT;
ALTER TABLE "studio_foundations" ADD CONSTRAINT "studio_foundations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "studio_foundations" ADD CONSTRAINT "studio_foundations_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "foundation_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "foundation_revisions" ADD CONSTRAINT "foundation_revisions_foundationId_fkey" FOREIGN KEY ("foundationId") REFERENCES "studio_foundations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_role_presets" ADD CONSTRAINT "employee_role_presets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_role_presets" ADD CONSTRAINT "employee_role_presets_foundationRevisionId_fkey" FOREIGN KEY ("foundationRevisionId") REFERENCES "foundation_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "studio_projects" ADD CONSTRAINT "studio_projects_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_source_bindings" ADD CONSTRAINT "project_source_bindings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "studio_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignment_manifests" ADD CONSTRAINT "assignment_manifests_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "studio_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignment_manifests" ADD CONSTRAINT "assignment_manifests_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignment_manifests" ADD CONSTRAINT "assignment_manifests_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignment_manifests" ADD CONSTRAINT "assignment_manifests_foundationRevisionId_fkey" FOREIGN KEY ("foundationRevisionId") REFERENCES "foundation_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "assignment_manifests" ADD CONSTRAINT "assignment_manifests_rolePresetId_fkey" FOREIGN KEY ("rolePresetId") REFERENCES "employee_role_presets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bots" ADD CONSTRAINT "bots_rolePresetId_fkey" FOREIGN KEY ("rolePresetId") REFERENCES "employee_role_presets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "studio_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
