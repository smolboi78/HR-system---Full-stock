-- Brings an already-deployed database up to the current schema.
--
-- The Setting table and the roster's cached shift columns were added by
-- editing the init migration rather than adding a new one. A database that
-- had already run init by name never received them, so anything touching
-- the cache failed with "table public.Setting does not exist".
--
-- Every statement is conditional, so this applies cleanly whether the
-- database predates those changes or was created from the current schema.

CREATE TABLE IF NOT EXISTS "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "RosterEmployee" ADD COLUMN IF NOT EXISTS "shiftLabel" TEXT;
ALTER TABLE "RosterEmployee" ADD COLUMN IF NOT EXISTS "shiftDaysOff" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "RosterEmployee" ADD COLUMN IF NOT EXISTS "shiftSyncedAt" TIMESTAMP(3);

-- Entitlements are no longer kept in this tool; balances come from ZenHR.
ALTER TABLE "LeaveTypeMap" DROP COLUMN IF EXISTS "entitlementDays";
