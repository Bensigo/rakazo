CREATE TABLE "employee_job_roles" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "defaultRolePresetIds" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_job_roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employee_job_roles_organizationId_key_key" ON "employee_job_roles"("organizationId", "key");
CREATE INDEX "employee_job_roles_organizationId_name_idx" ON "employee_job_roles"("organizationId", "name");
ALTER TABLE "space_members" ADD COLUMN "jobRoleId" TEXT;
CREATE INDEX "space_members_jobRoleId_idx" ON "space_members"("jobRoleId");
ALTER TABLE "employee_job_roles" ADD CONSTRAINT "employee_job_roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "space_members" ADD CONSTRAINT "space_members_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "employee_job_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
