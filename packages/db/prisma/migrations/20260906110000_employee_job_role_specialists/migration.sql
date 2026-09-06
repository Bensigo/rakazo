CREATE TABLE "employee_job_role_specialists" (
 "id" TEXT NOT NULL,
 "spaceMemberId" TEXT NOT NULL,
 "rolePresetId" TEXT NOT NULL,
 "botId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "employee_job_role_specialists_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employee_job_role_specialists_botId_key" ON "employee_job_role_specialists"("botId");
CREATE UNIQUE INDEX "employee_job_role_specialists_spaceMemberId_rolePresetId_key" ON "employee_job_role_specialists"("spaceMemberId","rolePresetId");
CREATE INDEX "employee_job_role_specialists_spaceMemberId_idx" ON "employee_job_role_specialists"("spaceMemberId");
ALTER TABLE "employee_job_role_specialists" ADD CONSTRAINT "employee_job_role_specialists_spaceMemberId_fkey" FOREIGN KEY ("spaceMemberId") REFERENCES "space_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_job_role_specialists" ADD CONSTRAINT "employee_job_role_specialists_rolePresetId_fkey" FOREIGN KEY ("rolePresetId") REFERENCES "employee_role_presets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_job_role_specialists" ADD CONSTRAINT "employee_job_role_specialists_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
