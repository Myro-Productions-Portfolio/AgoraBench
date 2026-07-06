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
