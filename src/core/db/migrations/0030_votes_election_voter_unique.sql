-- E3 slice A follow-up: DB-level one-ballot-per-voter-per-election guarantee.
--
-- The election vote-casting window (agentTick.ts Phase 14) dedups voters in
-- memory (alreadyVoted set) before inserting a ballot into `votes`. That
-- check-then-act is racy under Bull's per-tick retries (attempts:3): a tick
-- that partially wrote ballots then re-ran could double-insert. This adds the
-- missing DB-level guarantee so the .onConflictDoNothing() on the ballot
-- insert has something to conflict against.
--
-- Partial index (WHERE election_id IS NOT NULL): `votes` is a shared table --
-- it also holds bill votes, which carry election_id = NULL. Postgres treats
-- every NULL as distinct, so a plain UNIQUE(election_id, voter_id) would not
-- constrain bill votes anyway; the partial index makes that explicit and
-- scopes the guarantee to election ballots only, leaving bill-vote inserts
-- (bill votes actually live in `bill_votes`, but be defensive) untouched.
--
-- Safe to add: the prod `votes` table has never been written to (the write
-- side ships in this same PR), so no existing rows can violate it. Guarded
-- with IF NOT EXISTS for idempotent re-runs, matching the style of 0028.

CREATE UNIQUE INDEX IF NOT EXISTS "votes_election_voter_unique"
  ON "votes" ("election_id", "voter_id")
  WHERE "election_id" IS NOT NULL;
