-- Better Auth 1.6 writes the invitation creation time. Existing deployments
-- predate the enabled employee-invitation flow, so preserve any dormant rows
-- and backfill their creation time at migration time.
ALTER TABLE "invitation"
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
