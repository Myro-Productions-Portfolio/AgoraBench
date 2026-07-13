import { pgTable, uuid, integer, bigint, real, varchar, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { tickLog } from '@modules/government/db/schema/government';

/* E5 world-model Layer 1 (docs/specs/world-model.md §2): append-only macro
   state trajectory + the roadmap-mandated per-step PRNG seed chain.
   Observe-only slice -- nothing in the simulation reads this table yet.
   Task 4 inserts/selects rows; `recurringStanceAnnualized` feeds its
   transfers-diff calc, so its column name is load-bearing. */
export const worldState = pgTable(
  'world_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tickId: uuid('tick_id').references(() => tickLog.id),
    tickNumber: integer('tick_number').notNull(),
    rngSeed: bigint('rng_seed', { mode: 'number' }).notNull(),
    regime: varchar('regime', { length: 12 }).notNull(),
    gdpAnnualized: bigint('gdp_annualized', { mode: 'number' }).notNull(),
    gdpGrowthPct: real('gdp_growth_pct').notNull(),
    coreGrowthPct: real('core_growth_pct').notNull(),
    unemploymentPct: real('unemployment_pct').notNull(),
    inflationPct: real('inflation_pct').notNull(),
    sentiment: real('sentiment').notNull(),
    sentimentBase: real('sentiment_base').notNull(),
    fiscalImpulsePct: real('fiscal_impulse_pct').notNull(),
    policyEffectPct: real('policy_effect_pct').notNull(),
    policyPipeline: jsonb('policy_pipeline').$type<number[]>().notNull(),
    dayInQuarter: integer('day_in_quarter').notNull(),
    recurringStanceAnnualized: bigint('recurring_stance_annualized', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tickNumberIdx: index('world_state_tick_number_idx').on(t.tickNumber.desc()),
  })
);
