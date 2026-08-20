-- 10-K report storage (Workstream A, plan giggly-floating-pinwheel A1):
-- gazette_issues grows an additive `kind` discriminator so the periodic
-- sim-vs-reality 10-K report shares the table without touching the Gazette.
-- Every existing row is a Gazette issue, so the DEFAULT backfills correctly.
--
-- kind='gazette': the Daily Gazette (sim-internal news; enters agent prompts
--   via buildRecentNewsBlock). kind='ten_k': the Agora 10-K (narrates the
--   sim-vs-REALITY comparison; press surfaces only -- it must NEVER enter
--   agent prompts, so every agent-facing reader filters kind='gazette').
--
-- Guarded with IF NOT EXISTS so a re-run is a no-op, matching 0028+.
-- NOTE: 0034_election_tick_anchors.sql is owned by a parallel branch.

ALTER TABLE "gazette_issues" ADD COLUMN IF NOT EXISTS "kind" varchar(20) NOT NULL DEFAULT 'gazette';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gazette_issues_kind_created_at_idx" ON "gazette_issues" ("kind", "created_at" DESC);
