-- Exogenous world-events feed, E2 slice 1.
--
-- world_events stores normalized, deduped candidates pulled from Tier-1
-- exogenous sources (USGS earthquakes, NWS alerts, OpenFEMA disaster
-- incidents). This slice is READ-ONLY: nothing in the simulation reads or
-- writes into agent prompts from this table. AGGE curation and injection
-- channels are a later slice (docs/specs/exogenous-reality-feed.md, build
-- order step 2+).
--
-- Guarded with IF NOT EXISTS so a re-run is a no-op, matching the style of
-- prior hand-written migrations in this directory (0026-0028).

CREATE TABLE IF NOT EXISTS "world_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(40) NOT NULL,
	"external_id" varchar(200) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"category" varchar(20) NOT NULL,
	"severity" real NOT NULL,
	"title" varchar(300) NOT NULL,
	"summary" text NOT NULL,
	"location" varchar(10),
	"raw_payload" jsonb NOT NULL,
	"status" varchar(20) NOT NULL DEFAULT 'pending',
	"exogeneity_note" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'world_events_source_external_id_unique'
  ) THEN
    ALTER TABLE "world_events"
      ADD CONSTRAINT "world_events_source_external_id_unique"
      UNIQUE ("source", "external_id");
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "world_events_occurred_at_idx" ON "world_events" ("occurred_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "world_events_category_idx" ON "world_events" ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "world_events_status_idx" ON "world_events" ("status");
