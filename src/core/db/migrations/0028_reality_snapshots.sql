-- Divergence experiment, slice 3: reality reference pool.
--
-- reality_snapshots stores periodic pulls from the Treasury Fiscal Data API
-- (MTS Table 9 category outlays, MTS Table 1 top-line receipts/outlays/
-- deficit, Debt to the Penny) purely as a comparison reference. Nothing in
-- the simulation reads this table -- the divergence API (a later slice) is
-- the only consumer.
--
-- Guarded with IF NOT EXISTS so a re-run is a no-op, matching the style of
-- prior hand-written migrations in this directory (e.g. 0026).
--
-- "category" is nullable in SQL but the puller (realityFeed.ts) never
-- writes NULL into it -- top-line rows (mts_table_1, debt_to_penny) get ''
-- instead, because Postgres treats every NULL as distinct under the
-- (record_date, category, source) UNIQUE constraint below, which would
-- silently defeat idempotent re-pulls of the same date.

CREATE TABLE IF NOT EXISTS "reality_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_date" date NOT NULL,
	"fiscal_year" integer,
	"fiscal_month" integer,
	"category" varchar(120),
	"outlays_fytd" bigint,
	"receipts_fytd" bigint,
	"deficit_fytd" bigint,
	"debt_outstanding" bigint,
	"source" varchar(40) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reality_snapshots_date_category_source_unique'
  ) THEN
    ALTER TABLE "reality_snapshots"
      ADD CONSTRAINT "reality_snapshots_date_category_source_unique"
      UNIQUE ("record_date", "category", "source");
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reality_snapshots_source_date_idx" ON "reality_snapshots" ("source", "record_date" DESC);
