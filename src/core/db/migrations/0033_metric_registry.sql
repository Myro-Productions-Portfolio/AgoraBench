-- E4 Scoreboard v1, slice 1: metric registry + snapshot series + per-tick
-- fiscal history columns (docs/specs/observability-and-metrics.md).
--
-- metric_definitions is the registry: one row per scoreboard metric. The
-- comparison UI reads this table, so adding a metric = one registry row +
-- one adapter mapping, no UI change. Seeded below with the 12 spec metrics
-- (ON CONFLICT DO NOTHING keeps re-runs no-ops). Deliberately ABSENT per
-- the spec's rejected-for-v1 note: WGI/Legatum/SPI/OECD composite indices
-- and trust-in-government -- do not re-add without re-litigating the spec.
--
-- metric_snapshots holds both sides' series: sim rows carry at_tick + the
-- tick's sim date, reality rows carry at_date with at_tick NULL. The unique
-- key uses NULLS NOT DISTINCT (Postgres 15+; prod runs 16) because at_tick
-- is NULL on every reality row -- under default NULL-distinct semantics two
-- reality rows for the same (metric, side, date) would never conflict and
-- re-pulls would duplicate instead of upserting (same trap reality_snapshots
-- solves with its '' category sentinel; a nullable column can't use a
-- sentinel without lying about tick numbers).
--
-- Guarded with IF NOT EXISTS so a re-run is a no-op, matching 0028.

CREATE TABLE IF NOT EXISTS "metric_definitions" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"unit" varchar(60) NOT NULL,
	"sim_source" text NOT NULL,
	"reality_source" text NOT NULL,
	"cadence" varchar(120) NOT NULL,
	"direction" varchar(10) NOT NULL,
	"tier" varchar(1) NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric_key" varchar(60) NOT NULL REFERENCES "metric_definitions"("key"),
	"side" varchar(10) NOT NULL,
	"value" double precision NOT NULL,
	"at_date" date NOT NULL,
	"at_tick" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metric_snapshots_key_side_date_tick_unique"
	  UNIQUE NULLS NOT DISTINCT ("metric_key", "side", "at_date", "at_tick")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "metric_snapshots_key_side_date_idx" ON "metric_snapshots" ("metric_key", "side", "at_date" DESC);--> statement-breakpoint

-- Per-tick history for the three fields that previously existed only as a
-- single mutable government_settings row / runtime-config value. Nullable:
-- legacy rows predate the columns and stay NULL (the scoreboard exporter
-- only reads rows written after this migration). Closes the standing
-- docs/TODO.md "deferred physics/observability follow-up" item and
-- supersedes the old agentTick.ts Phase 13 comment that kept debt out of
-- the summary on purpose.
ALTER TABLE "fiscal_tick_summaries" ADD COLUMN IF NOT EXISTS "debt_outstanding" bigint;--> statement-breakpoint
ALTER TABLE "fiscal_tick_summaries" ADD COLUMN IF NOT EXISTS "tax_rate_percent" integer;--> statement-breakpoint
ALTER TABLE "fiscal_tick_summaries" ADD COLUMN IF NOT EXISTS "gdp_annual" bigint;--> statement-breakpoint

-- The 12 launch metrics, verbatim from the spec's readiness-ordered list.
-- Tier A: comparable now (divergence core shipped). Tier B: comparable once
-- the export layer + adapters land (metric 8's SIM side additionally needs
-- the CR/shutdown mechanic -- visible-but-pending). Tier C: reality series
-- accumulate now, sim side waits on world-model Layer 2+.
INSERT INTO "metric_definitions" ("key", "name", "unit", "sim_source", "reality_source", "cadence", "direction", "tier") VALUES
('deficit_per_day', 'Deficit per day', '$/day', 'fiscal_tick_summaries: spending - revenue per tick (1 tick = 1 sim day)', 'Treasury MTS Table 1: FYTD deficit averaged per elapsed fiscal-year day', 'sim per tick; reality monthly', 'lower', 'A'),
('debt_to_gdp', 'Debt-to-GDP', '% of GDP', 'fiscal_tick_summaries.debt_outstanding / gdp_annual', 'Debt to the Penny / gdpAnnual', 'sim per tick; reality daily (pulled every 16 ticks)', 'lower', 'A'),
('spending_pct_gdp', 'Total spending', '% of GDP', 'fiscal_tick_summaries.spending (programs + interest) annualized / gdp_annual', 'MTS Table 1 FYTD outlays -> daily avg, annualized / GDP (category mix: MTS Table 9)', 'sim per tick; reality monthly', 'context', 'A'),
('tax_burden_pct_gdp', 'Tax burden (receipts)', '% of GDP', 'fiscal_tick_summaries.revenue annualized / gdp_annual', 'MTS Table 1 FYTD receipts -> daily avg, annualized / GDP', 'sim per tick; reality monthly', 'context', 'A'),
('legislative_throughput', 'Legislative throughput', 'laws per session (projected)', 'laws.enacted_tick since T0, linear projection to a 730-tick session-equivalent', 'Congress.gov /law/119 enactment count, session-relative back-load normalization', 'sim per tick; reality per pull', 'context', 'B'),
('time_to_passage', 'Time to passage', 'days (median)', 'bills.introduced_at -> laws.enacted_date, wall-clock converted to ticks (sim days)', 'Congress.gov bill details: introducedDate -> became-law action date', 'sim per tick; reality per pull', 'lower', 'B'),
('approval_trend', 'Approval trend', '% approve (trend-shape only)', 'avg officeholder agents.approval_rating at export time', 'YouGov congressional tracker / Ballotpedia Polling Index (tolerant scrape)', 'sim per tick; reality weekly-ish', 'context', 'B'),
('shutdown_days', 'Shutdown / funding-lapse days', 'days', 'not yet comparable: requires the CR/shutdown mechanic (simulation-completeness spec)', 'CRS/Wikipedia funding-lapse series', 'per event', 'lower', 'B'),
('unemployment_rate', 'Unemployment rate', '%', 'not yet comparable: requires world-model economy Layer 2+', 'FRED UNRATE', 'monthly', 'lower', 'C'),
('inflation_rate', 'Inflation rate', '% YoY', 'not yet comparable: requires world-model economy Layer 2+', 'FRED CPIAUCSL, 12-month % change', 'monthly', 'context', 'C'),
('gdp_growth', 'GDP growth', '% (annualized q/q)', 'not yet comparable: requires world-model economy Layer 2+ (gdpAnnual is static config today)', 'FRED GDP, quarter-over-quarter annualized % change', 'quarterly', 'higher', 'C'),
('poverty_uninsured_rate', 'Poverty / uninsured rate', '%', 'not yet comparable: requires the social-state vector (later)', 'Census SAIPE/SAHIE (annual cadence only)', 'annual', 'lower', 'C')
ON CONFLICT ("key") DO NOTHING;
