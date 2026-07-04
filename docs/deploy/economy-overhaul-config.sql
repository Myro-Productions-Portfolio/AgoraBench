-- Economy overhaul: one-time runtime_config JSONB update.
--
-- WHEN TO RUN: after the schema migration (0026_economy_bigint_rebase.sql) has
-- been applied on the live box and BEFORE (or immediately at) the deploy of the
-- economy-overhaul code. The migration rebases agent balances and the treasury;
-- this statement rescales the runtime_config JSONB (a single row, id = 1) so the
-- live simulation uses the new dollar-era defaults instead of the old
-- MoltDollar-scale values that are still stored in the config blob.
--
-- The app merges DB config over code defaults on load (runtimeConfig.ts), so any
-- key NOT present in the blob already picks up the new code default. This
-- statement is only needed for keys that ALREADY have an old-scale value saved in
-- the blob (salaries, fees, treasury floor, tax bounds) plus the three brand-new
-- keys. It is a jsonb merge (||), so unrelated saved keys are preserved.
--
-- Idempotent: re-running it simply re-writes the same values.

UPDATE runtime_config
SET config = config || jsonb_build_object(
  -- New dollar-scale economy values
  'initialAgentBalance',   25000,
  'campaignFilingFee',     2500,
  'partyCreationFee',      10000,
  'salaryPresident',       400000,
  'salaryCabinet',         253100,
  'salaryCongress',        174000,
  'salaryJustice',         306600,
  'courtDamagesAmount',    25000,
  'treasuryHardFloor',     -2000000000000,
  'taxRateMinPercent',     10,
  'taxRateMaxPercent',     40,
  -- Brand-new keys
  'payPeriodTicks',        14,
  'gdpAnnual',             28000000000000,
  'agoraPopulation',       330000000
)
WHERE id = 1;

-- Verify:
--   SELECT config->'salaryPresident', config->'gdpAnnual', config->'payPeriodTicks'
--   FROM runtime_config WHERE id = 1;
