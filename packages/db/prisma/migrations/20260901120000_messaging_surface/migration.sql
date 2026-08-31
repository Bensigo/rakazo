-- Phone surface → multi-provider messaging surface. Sendblue rows are
-- preserved under provider 'sendblue'; conversation addressing moves to
-- opaque provider thread ids, so per-vendor columns collapse.

-- Identities: one (provider, address) per person, DM thread learned on inbound.
ALTER TABLE "phone_identities" RENAME TO "messaging_identities";
ALTER TABLE "messaging_identities" RENAME COLUMN "phoneE164" TO "address";
ALTER TABLE "messaging_identities" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'sendblue';
ALTER TABLE "messaging_identities" ADD COLUMN "dmThreadId" TEXT;
ALTER INDEX "phone_identities_pkey" RENAME TO "messaging_identities_pkey";
ALTER INDEX "phone_identities_botId_key" RENAME TO "messaging_identities_botId_key";
ALTER INDEX "phone_identities_userId_idx" RENAME TO "messaging_identities_userId_idx";
DROP INDEX "phone_identities_phoneE164_key";
CREATE UNIQUE INDEX "messaging_identities_provider_address_key"
    ON "messaging_identities"("provider", "address");
ALTER TABLE "messaging_identities"
    RENAME CONSTRAINT "phone_identities_spaceId_fkey" TO "messaging_identities_spaceId_fkey";

-- Channels: keyed by provider thread id. Legacy sendblue group ids cannot be
-- re-encoded into thread ids in SQL; prefix them so the next inbound group
-- message recreates the channel and restarts its invite cycle cleanly.
ALTER TABLE "phone_channels" RENAME TO "messaging_channels";
ALTER TABLE "messaging_channels" RENAME COLUMN "providerGroupId" TO "threadId";
ALTER TABLE "messaging_channels" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'sendblue';
UPDATE "messaging_channels" SET "threadId" = 'legacy:' || "threadId";
ALTER INDEX "phone_channels_pkey" RENAME TO "messaging_channels_pkey";
ALTER INDEX "phone_channels_providerGroupId_key" RENAME TO "messaging_channels_threadId_key";

ALTER TABLE "phone_channel_members" RENAME TO "messaging_channel_members";
ALTER TABLE "messaging_channel_members" RENAME COLUMN "phoneE164" TO "address";
ALTER INDEX "phone_channel_members_pkey" RENAME TO "messaging_channel_members_pkey";
ALTER INDEX "phone_channel_members_channelId_phoneE164_key"
    RENAME TO "messaging_channel_members_channelId_address_key";
ALTER INDEX "phone_channel_members_identityId_idx"
    RENAME TO "messaging_channel_members_identityId_idx";
ALTER TABLE "messaging_channel_members"
    RENAME CONSTRAINT "phone_channel_members_channelId_fkey"
    TO "messaging_channel_members_channelId_fkey";

-- Outbox: DM rows resolve threads through the identity; group rows carry the
-- provider thread id. Pre-migration pending rows hold vendor-shaped addresses
-- that no longer resolve, so they are closed out rather than left to retry.
ALTER TABLE "phone_outbound" RENAME TO "messaging_outbound";
ALTER TABLE "messaging_outbound" ADD COLUMN "identityId" TEXT;
ALTER TABLE "messaging_outbound" ADD COLUMN "threadId" TEXT;
UPDATE "messaging_outbound" o
    SET "identityId" = i."id"
    FROM "messaging_identities" i
    WHERE o."toNumber" IS NOT NULL AND i."provider" = 'sendblue' AND i."address" = o."toNumber";
UPDATE "messaging_outbound" SET "status" = 'failed' WHERE "status" = 'pending';
ALTER TABLE "messaging_outbound" DROP COLUMN "toNumber";
ALTER TABLE "messaging_outbound" DROP COLUMN "providerGroupId";
ALTER INDEX "phone_outbound_pkey" RENAME TO "messaging_outbound_pkey";
ALTER INDEX "phone_outbound_idempotencyKey_key" RENAME TO "messaging_outbound_idempotencyKey_key";
ALTER INDEX "phone_outbound_status_nextAttemptAt_idx"
    RENAME TO "messaging_outbound_status_nextAttemptAt_idx";

-- Runs and stored message blocks move to the neutral vocabulary.
UPDATE "runs" SET "trigger" = 'messaging' WHERE "trigger" = 'phone';
UPDATE "messages"
    SET "blocks" = (
        SELECT jsonb_agg(
            CASE
                WHEN block ->> 'kind' = 'phone_channel_message' THEN
                    (block - 'fromNumber')
                        || jsonb_build_object(
                            'kind', 'channel_message',
                            'provider', 'sendblue',
                            'fromAddress', block -> 'fromNumber'
                        )
                ELSE block
            END
        )
        FROM jsonb_array_elements("blocks") AS block
    )
    WHERE "blocks"::text LIKE '%phone_channel_message%';
