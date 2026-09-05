CREATE TABLE "employee_hosts" (
  "id" TEXT NOT NULL,
  "hostId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "capabilities" JSONB NOT NULL,
  "workspaceRoot" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_hosts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employee_hosts_hostId_key" ON "employee_hosts"("hostId");
CREATE INDEX "employee_hosts_spaceId_ownerUserId_idx" ON "employee_hosts"("spaceId", "ownerUserId");
CREATE INDEX "employee_hosts_expiresAt_idx" ON "employee_hosts"("expiresAt");
ALTER TABLE "employee_hosts" ADD CONSTRAINT "employee_hosts_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_hosts" ADD CONSTRAINT "employee_hosts_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "employee_host_operations" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "hostId" TEXT NOT NULL,
  "spaceId" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "fence" INTEGER NOT NULL,
  "request" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'accepted',
  "stdout" TEXT NOT NULL DEFAULT '',
  "stderr" TEXT NOT NULL DEFAULT '',
  "exitCode" INTEGER,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_host_operations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employee_host_operations_operationId_key" ON "employee_host_operations"("operationId");
CREATE INDEX "employee_host_operations_hostId_status_createdAt_idx" ON "employee_host_operations"("hostId", "status", "createdAt");
CREATE INDEX "employee_host_operations_spaceId_botId_fence_idx" ON "employee_host_operations"("spaceId", "botId", "fence");
ALTER TABLE "employee_host_operations" ADD CONSTRAINT "employee_host_operations_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "employee_hosts"("hostId") ON DELETE CASCADE ON UPDATE CASCADE;
