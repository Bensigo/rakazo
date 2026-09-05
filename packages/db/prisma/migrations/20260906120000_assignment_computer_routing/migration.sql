ALTER TABLE "assignment_manifests" ADD COLUMN "computerId" TEXT;
ALTER TABLE "runs" ADD COLUMN "computerId" TEXT;
ALTER TABLE "employee_hosts" ADD COLUMN "computerId" TEXT;

UPDATE "employee_hosts" AS host
SET "computerId" = (
  SELECT computer."id"
  FROM "computers" AS computer
  WHERE computer."spaceId" = host."spaceId"
    AND computer."userId" = host."ownerUserId"
    AND computer."kind" = 'employee-host'
    AND computer."scope" = 'dedicated'
    AND computer."providerRef" = host."hostId"
  ORDER BY computer."createdAt" ASC, computer."id" ASC
  LIMIT 1
);

INSERT INTO "computers" (
  "id", "spaceId", "userId", "scope", "scopeKey", "homeKey", "kind", "providerRef", "state", "updatedAt"
)
SELECT
  CONCAT('employee-host-', MD5(CONCAT("hostId", ':', "spaceId", ':', "ownerUserId"))),
  "spaceId",
  "ownerUserId",
  'dedicated',
  CONCAT('employee-host:', MD5(CONCAT("hostId", ':', "spaceId", ':', "ownerUserId"))),
  CONCAT('employee-host:', MD5(CONCAT("hostId", ':', "spaceId", ':', "ownerUserId"))),
  'employee-host',
  "hostId",
  'stopped',
  CURRENT_TIMESTAMP
FROM "employee_hosts"
WHERE "computerId" IS NULL;

UPDATE "employee_hosts"
SET "computerId" = CONCAT('employee-host-', MD5(CONCAT("hostId", ':', "spaceId", ':', "ownerUserId")))
WHERE "computerId" IS NULL;

ALTER TABLE "employee_hosts" ALTER COLUMN "computerId" SET NOT NULL;

CREATE INDEX "assignment_manifests_computerId_idx" ON "assignment_manifests"("computerId");
CREATE INDEX "runs_computerId_idx" ON "runs"("computerId");
CREATE UNIQUE INDEX "employee_hosts_computerId_key" ON "employee_hosts"("computerId");

ALTER TABLE "assignment_manifests" ADD CONSTRAINT "assignment_manifests_computerId_fkey"
  FOREIGN KEY ("computerId") REFERENCES "computers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "runs" ADD CONSTRAINT "runs_computerId_fkey"
  FOREIGN KEY ("computerId") REFERENCES "computers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_hosts" ADD CONSTRAINT "employee_hosts_computerId_fkey"
  FOREIGN KEY ("computerId") REFERENCES "computers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
