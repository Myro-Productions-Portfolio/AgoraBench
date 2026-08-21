-- Campaign Realism (S1 foundations): campaign finance becomes real money
-- inside the to-the-dollar economy.
--
-- campaigns.spent: cumulative dollars a campaign has spent (contributions −
--   spent = available war chest). contributions widens to bigint for
--   money-column consistency (every other dollar column is bigint).
-- government_events.scheduled_tick: tick-anchored future scheduling (debate
--   anchor; generally useful — scheduledAt stays a display-only estimate,
--   the judicial-hearing convention).
--
-- campaign_donations:     one row per donor drip (the conservation ledger:
--                         SUM(amount) per campaign == campaigns.contributions
--                         under the finance flag).
-- donation_stances:       one LLM answer per (election, agent), permanent —
--                         the UNIQUE pair is the ask-once idempotency ledger.
-- campaign_endorsements:  one row per (election, endorser); campaign_id NULL
--                         = asked-and-stayed-neutral dedup marker.
-- election_polls:         per-tick poll snapshot; UNIQUE(election, tick) +
--                         insert-or-nothing makes crash reruns safe.
--
-- All guarded (IF NOT EXISTS / DO-block constraint adds) so a re-run is a
-- no-op, matching prior hand-written migrations (0028, 0030, 0034, 0036).
-- Deploy dark: nothing writes these until campaignFinanceEnabled flips.

ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "spent" bigint NOT NULL DEFAULT 0;--> statement-breakpoint
-- last_spend_tick: rerun guard — the spend UPDATE's predicate (last_spend_tick
-- IS NULL OR last_spend_tick < tick AND spent + X <= contributions) makes a
-- crashed-tick rerun a 0-row no-op instead of a double spend.
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "last_spend_tick" integer;--> statement-breakpoint
ALTER TABLE "campaigns" ALTER COLUMN "contributions" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "government_events" ADD COLUMN IF NOT EXISTS "scheduled_tick" integer;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "campaign_donations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "election_id" uuid NOT NULL REFERENCES "elections"("id"),
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id"),
  "donor_agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "amount" bigint NOT NULL,
  "tick" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- Rerun guard: a crashed-tick rerun re-attempts the same (campaign, donor,
  -- tick) triple; the violation aborts that donation's transaction so the
  -- wallet debit rolls back with it. One drip per donor per campaign per tick.
  CONSTRAINT "campaign_donations_campaign_donor_tick_unique" UNIQUE ("campaign_id", "donor_agent_id", "tick")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_donations_campaign_id_idx" ON "campaign_donations" ("campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_donations_donor_agent_id_idx" ON "campaign_donations" ("donor_agent_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "donation_stances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "election_id" uuid NOT NULL REFERENCES "elections"("id"),
  "agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "will_donate" boolean NOT NULL,
  "preferred_campaign_id" uuid REFERENCES "campaigns"("id"),
  "generosity" varchar(10) NOT NULL DEFAULT 'medium',
  "tick" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "donation_stances_election_agent_unique" UNIQUE ("election_id", "agent_id")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "campaign_endorsements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "election_id" uuid NOT NULL REFERENCES "elections"("id"),
  "endorser_agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "campaign_id" uuid REFERENCES "campaigns"("id"),
  "tick" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_endorsements_election_endorser_unique" UNIQUE ("election_id", "endorser_agent_id")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "election_polls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "election_id" uuid NOT NULL REFERENCES "elections"("id"),
  "tick" integer NOT NULL,
  "results" jsonb NOT NULL,
  "undecided_pct" real NOT NULL DEFAULT 0,
  "sample_size" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "election_polls_election_tick_unique" UNIQUE ("election_id", "tick")
);
