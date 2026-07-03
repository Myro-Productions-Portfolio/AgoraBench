import { pgTable, uuid, varchar, text, boolean, timestamp, integer } from 'drizzle-orm/pg-core';
import { agents } from '@modules/agents/db/schema/agents';

export const bills = pgTable('bills', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 200 }).notNull(),
  summary: text('summary').notNull(),
  fullText: text('full_text').notNull(),
  sponsorId: uuid('sponsor_id')
    .notNull()
    .references(() => agents.id),
  coSponsorIds: text('co_sponsor_ids').notNull().default('[]'),
  committee: varchar('committee', { length: 50 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('proposed'),
  billType: varchar('bill_type', { length: 20 }).notNull().default('original'),
  amendsLawId: uuid('amends_law_id'),
  committeeDecision: varchar('committee_decision', { length: 20 }),
  committeeChairId: uuid('committee_chair_id').references(() => agents.id),
  presidentialVetoedById: uuid('presidential_vetoed_by_id').references(() => agents.id),
  vetoedAt: timestamp('vetoed_at', { withTimezone: true }),
  yeaCount: integer('yea_count').default(0),
  nayCount: integer('nay_count').default(0),
  introducedAt: timestamp('introduced_at', { withTimezone: true }).notNull().defaultNow(),
  lastActionAt: timestamp('last_action_at', { withTimezone: true }).notNull().defaultNow(),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  /* ---- Phase 3 fiscal provisions — ALL nullable by design. -------------
     Legacy rows (and any bill whose LLM fiscal payload fails validation)
     read NULL = "no fiscal provision" — a structural no-op, no defensive
     code needed. Values are written ONLY by the Phase 11 Rule-4 validator
     (fiscalParsing.ts) — never raw LLM output.
     fiscalKind: 'spend_once' | 'spend_recurring' | 'tax_change' | NULL
     fiscalAmount: integer M$ — per-tick for recurring, total for one-time
     fiscalTaxDelta: signed whole percentage points (tax_change only)
     sunsetTicks: law auto-deactivates this many ticks after enactment    */
  fiscalKind: varchar('fiscal_kind', { length: 20 }),
  fiscalAmount: integer('fiscal_amount'),
  fiscalTaxDelta: integer('fiscal_tax_delta'),
  fiscalProgramName: varchar('fiscal_program_name', { length: 120 }),
  sunsetTicks: integer('sunset_ticks'),
});

export const laws = pgTable('laws', {
  id: uuid('id').primaryKey().defaultRandom(),
  billId: uuid('bill_id')
    .notNull()
    .references(() => bills.id)
    .unique(),
  title: varchar('title', { length: 200 }).notNull(),
  text: text('text').notNull(),
  enactedDate: timestamp('enacted_date', { withTimezone: true }).notNull().defaultNow(),
  isActive: boolean('is_active').notNull().default(true),
  amendmentHistory: text('amendment_history').notNull().default('[]'),
  /* ---- Phase 3 fiscal provisions — copied from the enacting bill at ----
     Phase 9. ALL nullable: the ~1,930 legacy laws read NULL everywhere =
     no provision, no sunset, ever. programActive is true only for enacted
     spend_recurring programs (a recurring appropriation IS the law row —
     no separate programs table). enactedTick/lastRenewedTick are tick
     NUMBERS (not timestamps) so sunset/lapse math survives tick-interval
     changes; both derive from tick_log COUNT and are restart-robust.     */
  fiscalKind: varchar('fiscal_kind', { length: 20 }),
  fiscalAmount: integer('fiscal_amount'),
  fiscalTaxDelta: integer('fiscal_tax_delta'),
  fiscalProgramName: varchar('fiscal_program_name', { length: 120 }),
  sunsetTicks: integer('sunset_ticks'),
  programActive: boolean('program_active'),
  enactedTick: integer('enacted_tick'),
  lastRenewedTick: integer('last_renewed_tick'),
});

export const billVotes = pgTable('bill_votes', {
  id: uuid('id').primaryKey().defaultRandom(),
  billId: uuid('bill_id')
    .notNull()
    .references(() => bills.id),
  voterId: uuid('voter_id')
    .notNull()
    .references(() => agents.id),
  choice: varchar('choice', { length: 20 }).notNull(),
  castAt: timestamp('cast_at', { withTimezone: true }).notNull().defaultNow(),
});
