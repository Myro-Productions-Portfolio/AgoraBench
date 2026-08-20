-- Elections broadcast, slice 1: persist the per-state winners and Electoral
-- College tallies that finalizeElection already computes and then discards
-- (state winners) or buries inside activity-event metadata JSON (EV totals).
--
-- state_results:   { [stateAbbr]: winnerAgentId } — decided states only.
-- electoral_votes: { evByCandidate, totalEvAllocated, winnerId, reachedMajority }
--                  — exactly the electoralResultNote shape finalizeElection builds.
--
-- Both stay NULL on non-presidential certifications and whenever
-- electoralCollegeEnabled was false at certification time (deploy-dark: the
-- flag defaults false, so rows keep writing NULL until the owner flips it).
-- Guarded with IF NOT EXISTS so a re-run is a no-op, matching the style of
-- prior hand-written migrations in this directory (e.g. 0028, 0030, 0034).

ALTER TABLE "elections" ADD COLUMN IF NOT EXISTS "state_results" jsonb;--> statement-breakpoint
ALTER TABLE "elections" ADD COLUMN IF NOT EXISTS "electoral_votes" jsonb;
