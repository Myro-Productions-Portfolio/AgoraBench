-- Divergence Experiment E1 slice 1: debt/interest engine (deployed dark).
--
-- Adds government_settings.debt_outstanding — the running national-debt
-- stock the sim's debt engine issues against on a treasury shortfall and
-- retires against on a surplus above the operating buffer (see
-- src/core/server/lib/fiscalMath.ts settleTreasury()). Bigint: real debt
-- scale (~$30T) is far under the bigint ceiling (~9.2e18), same headroom
-- reasoning as 0026's economy rebase.
--
-- Everything here sits behind RuntimeConfig.debtEngineEnabled (default
-- false) — the column exists and defaults to 0 regardless, so this
-- migration alone changes zero simulation behavior.
--
-- Re-run safety: ADD COLUMN IF NOT EXISTS is naturally idempotent.

ALTER TABLE "government_settings" ADD COLUMN IF NOT EXISTS "debt_outstanding" bigint NOT NULL DEFAULT 0;--> statement-breakpoint
