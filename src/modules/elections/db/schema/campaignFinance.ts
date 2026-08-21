import { pgTable, uuid, varchar, integer, bigint, real, boolean, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { agents } from '@modules/agents/db/schema/agents';
import { elections, campaigns } from './elections';

/* Campaign Realism (migration 0037). All four tables are dark until
   RuntimeConfig.campaignFinanceEnabled / pollsEnabled flip. */

/** One row per donor drip — the conservation ledger:
    SUM(amount) per campaign == campaigns.contributions under the flag. */
export const campaignDonations = pgTable(
  'campaign_donations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    electionId: uuid('election_id').notNull().references(() => elections.id),
    campaignId: uuid('campaign_id').notNull().references(() => campaigns.id),
    donorAgentId: uuid('donor_agent_id').notNull().references(() => agents.id),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    tick: integer('tick').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    campaignIdx: index('campaign_donations_campaign_id_idx').on(t.campaignId),
    donorIdx: index('campaign_donations_donor_agent_id_idx').on(t.donorAgentId),
  }),
);

/** One LLM answer per (election, agent), permanent — the UNIQUE pair is the
    ask-once idempotency ledger. Unparseable-but-returned answers persist as
    willDonate = false; only transport failures leave no row (retry). */
export const donationStances = pgTable(
  'donation_stances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    electionId: uuid('election_id').notNull().references(() => elections.id),
    agentId: uuid('agent_id').notNull().references(() => agents.id),
    willDonate: boolean('will_donate').notNull(),
    preferredCampaignId: uuid('preferred_campaign_id').references(() => campaigns.id),
    generosity: varchar('generosity', { length: 10 }).notNull().default('medium'),
    tick: integer('tick').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    electionAgentUnique: unique('donation_stances_election_agent_unique').on(t.electionId, t.agentId),
  }),
);

/** One row per (election, endorser). campaignId NULL = asked-and-stayed-
    neutral dedup marker (never re-asked). */
export const campaignEndorsements = pgTable(
  'campaign_endorsements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    electionId: uuid('election_id').notNull().references(() => elections.id),
    endorserAgentId: uuid('endorser_agent_id').notNull().references(() => agents.id),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    tick: integer('tick').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    electionEndorserUnique: unique('campaign_endorsements_election_endorser_unique').on(t.electionId, t.endorserAgentId),
  }),
);

/** Per-tick poll snapshot. UNIQUE(election, tick) + onConflictDoNothing on
    the writer makes crash reruns safe. results = { [campaignId]: sharePct }. */
export const electionPolls = pgTable(
  'election_polls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    electionId: uuid('election_id').notNull().references(() => elections.id),
    tick: integer('tick').notNull(),
    results: jsonb('results').$type<Record<string, number>>().notNull(),
    undecidedPct: real('undecided_pct').notNull().default(0),
    sampleSize: integer('sample_size').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    electionTickUnique: unique('election_polls_election_tick_unique').on(t.electionId, t.tick),
  }),
);
