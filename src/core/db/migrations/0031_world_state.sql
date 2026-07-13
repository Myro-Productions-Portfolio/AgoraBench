-- E5 world-model Layer 1 (docs/specs/world-model.md §2): append-only macro
-- state trajectory + the roadmap-mandated per-step PRNG seed chain.
-- Observe-only slice: nothing in the simulation reads this table yet.
CREATE TABLE IF NOT EXISTS "world_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tick_id" uuid REFERENCES "tick_log"("id"),
  "tick_number" integer NOT NULL,
  "rng_seed" bigint NOT NULL,
  "regime" varchar(12) NOT NULL,
  "gdp_annualized" bigint NOT NULL,
  "gdp_growth_pct" real NOT NULL,
  "core_growth_pct" real NOT NULL,
  "unemployment_pct" real NOT NULL,
  "inflation_pct" real NOT NULL,
  "sentiment" real NOT NULL,
  "sentiment_base" real NOT NULL,
  "fiscal_impulse_pct" real NOT NULL,
  "policy_effect_pct" real NOT NULL,
  "policy_pipeline" jsonb NOT NULL,
  "day_in_quarter" integer NOT NULL,
  "recurring_stance_annualized" bigint NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "world_state_tick_number_idx" ON "world_state" ("tick_number" DESC);
