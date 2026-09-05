ALTER TABLE "assignment_manifests" ADD COLUMN "projectIds" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "assignment_manifests" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "assignment_manifests" ADD COLUMN "reviewerUserId" TEXT;
UPDATE "assignment_manifests" SET "createdByUserId" = COALESCE("acceptedByUserId", '') WHERE "createdByUserId" IS NULL;
ALTER TABLE "assignment_manifests" ALTER COLUMN "createdByUserId" SET NOT NULL;
