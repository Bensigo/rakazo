ALTER TABLE "tasks" ADD COLUMN "studioContext" JSONB;
ALTER TABLE "runs" ADD COLUMN "studioContext" JSONB;
ALTER TABLE "routines" ADD COLUMN "studioContext" JSONB;
ALTER TABLE "assignment_manifests" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'one';
ALTER TABLE "assignment_manifests" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "assignment_manifests" DROP CONSTRAINT "assignment_manifests_projectId_fkey";
ALTER TABLE "assignment_manifests" ADD CONSTRAINT "assignment_manifests_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "studio_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
