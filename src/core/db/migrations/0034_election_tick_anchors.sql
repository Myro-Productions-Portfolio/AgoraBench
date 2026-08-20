-- Election cycles, B-Engine slice 1: tick anchors for election scheduling.
--
-- Election phase transitions previously ran on wall timestamps (24h
-- registration, campaignDurationDays wall-days, votingDurationHours) while
-- terms/sunsets/sim-calendar run on ticks (1 tick = 1 sim-day) — at a
-- 30-min tick interval a "14-day" campaign window was 672 ticks ≈ 1.8
-- sim-years. These columns anchor the schedule to tick numbers (the PR #47
-- "tick numbers, not timestamps" lesson); the existing timestamp columns
-- remain as display-only derived dates.
--
-- All columns nullable, NO backfill: historical tick numbers are not
-- reconstructable across tick-interval changes, and legacy in-flight rows
-- deliberately keep their wall-clock gating (Phase 14 falls back per-row
-- when the anchor is NULL) until they drain.
--
-- Guarded with IF NOT EXISTS so a re-run is a no-op, matching the style of
-- prior hand-written migrations in this directory (e.g. 0028, 0030).

ALTER TABLE "elections" ADD COLUMN IF NOT EXISTS "created_tick" integer;--> statement-breakpoint
ALTER TABLE "elections" ADD COLUMN IF NOT EXISTS "registration_ends_tick" integer;--> statement-breakpoint
ALTER TABLE "elections" ADD COLUMN IF NOT EXISTS "voting_start_tick" integer;--> statement-breakpoint
ALTER TABLE "elections" ADD COLUMN IF NOT EXISTS "voting_end_tick" integer;--> statement-breakpoint
ALTER TABLE "elections" ADD COLUMN IF NOT EXISTS "certified_tick" integer;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN IF NOT EXISTS "start_tick" integer;
