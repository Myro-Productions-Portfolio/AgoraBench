-- Economy overhaul: widen all money columns to bigint and rebase to dollar scale.
--
-- int4 caps at ~$2.1B; the new treasury is $1.5T and bills appropriate up to
-- $700B, so every money column must become bigint. JS numbers remain exact
-- (all values < 2^53). Drizzle schema files use bigint(..., { mode: 'number' }).
--
-- Re-run safety:
--   * The bigint ALTERs on integer columns are naturally idempotent (int4 ->
--     bigint on an already-bigint column is a no-op that does not error).
--   * The transactions.amount varchar -> bigint ALTER is NOT naturally
--     idempotent — regexp_replace() cannot take a bigint argument, so a second
--     run would error. It is wrapped in a DO block guarded on the column's
--     current data_type so it only fires while amount is still varchar.
--   * balance_after uses ADD COLUMN IF NOT EXISTS.
--   * The data rebase (agent balances, treasury, tax rate, conversion ledger
--     rows) is guarded so it only runs while the DB is still in the old
--     MoltDollar scale (treasury_balance < 1e9). After conversion it is a no-op.

-- 1. Widen money columns to bigint. --------------------------------------------
ALTER TABLE "agents" ALTER COLUMN "balance" TYPE bigint;--> statement-breakpoint
ALTER TABLE "government_settings" ALTER COLUMN "treasury_balance" TYPE bigint;--> statement-breakpoint
ALTER TABLE "bills" ALTER COLUMN "fiscal_amount" TYPE bigint;--> statement-breakpoint
ALTER TABLE "laws" ALTER COLUMN "fiscal_amount" TYPE bigint;--> statement-breakpoint
ALTER TABLE "fiscal_tick_summaries" ALTER COLUMN "revenue" TYPE bigint;--> statement-breakpoint
ALTER TABLE "fiscal_tick_summaries" ALTER COLUMN "spending" TYPE bigint;--> statement-breakpoint
ALTER TABLE "fiscal_tick_summaries" ALTER COLUMN "treasury_end" TYPE bigint;--> statement-breakpoint

-- 2. transactions.amount varchar(50) -> bigint; add balance_after. -------------
--    Guarded so a re-run (amount already bigint) is a no-op. Strip any
--    non-numeric characters (legacy amounts are plain integer strings, but this
--    is defensive). Empty/NULL becomes NULL.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions'
      AND column_name = 'amount'
      AND data_type = 'character varying'
  ) THEN
    ALTER TABLE "transactions"
      ALTER COLUMN "amount" TYPE bigint
      USING NULLIF(regexp_replace("amount", '[^0-9-]', '', 'g'), '')::bigint;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "balance_after" bigint;--> statement-breakpoint

-- 3. Data rebase (guarded: only while still in MoltDollar scale). --------------
--    newBalance = 25000 + oldBalance * 20  (preserves ranking, lifts everyone
--    into the dollar era). One conversion ledger row per agent records the
--    post-conversion balance in balance_after so the finance timeline has an
--    anchor point.
DO $$
BEGIN
  IF (SELECT treasury_balance FROM government_settings ORDER BY id LIMIT 1) < 1000000000 THEN
    -- Rebase agent balances.
    UPDATE agents SET balance = 25000 + balance * 20;

    -- Conversion ledger rows (type 'conversion'), balance_after = new balance.
    INSERT INTO transactions (from_agent_id, to_agent_id, amount, type, description, balance_after, created_at)
    SELECT NULL, id, balance, 'conversion',
           'Currency conversion — dollar era', balance, now()
    FROM agents;

    -- Treasury and tax rate to dollar-era defaults.
    UPDATE government_settings
    SET treasury_balance = 1500000000000,
        tax_rate_percent = 18;
  END IF;
END $$;--> statement-breakpoint
