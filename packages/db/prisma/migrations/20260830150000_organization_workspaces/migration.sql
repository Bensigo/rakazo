BEGIN;

-- Organizations remain the company/account boundary. Workspaces are the
-- private execution and data boundary inside an organization.
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_members" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- Preserve every existing resource ID and scope by giving each organization
-- a default workspace with the same ID. No bot, thread, memory, or secret row
-- needs to be rewritten.
INSERT INTO "workspaces" ("id", "organizationId", "name", "createdAt")
SELECT "id", "id", "name", "createdAt"
FROM "organization";

INSERT INTO "workspace_members" (
    "id",
    "workspaceId",
    "organizationId",
    "userId",
    "createdAt"
)
SELECT "id", "organizationId", "organizationId", "userId", "createdAt"
FROM "member";

CREATE UNIQUE INDEX "workspaces_id_organizationId_key"
ON "workspaces"("id", "organizationId");
CREATE INDEX "workspaces_organizationId_createdAt_idx"
ON "workspaces"("organizationId", "createdAt");
CREATE UNIQUE INDEX "workspace_members_workspaceId_userId_key"
ON "workspace_members"("workspaceId", "userId");
CREATE INDEX "workspace_members_organizationId_userId_idx"
ON "workspace_members"("organizationId", "userId");
CREATE INDEX "workspace_members_userId_createdAt_idx"
ON "workspace_members"("userId", "createdAt");

ALTER TABLE "workspaces"
ADD CONSTRAINT "workspaces_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace_members"
ADD CONSTRAINT "workspace_members_workspaceId_organizationId_fkey"
FOREIGN KEY ("workspaceId", "organizationId")
REFERENCES "workspaces"("id", "organizationId")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace_members"
ADD CONSTRAINT "workspace_members_organizationId_userId_fkey"
FOREIGN KEY ("organizationId", "userId")
REFERENCES "member"("organizationId", "userId")
ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
