import { pgTable, uuid, varchar, text, date, integer, timestamp, doublePrecision, unique, index } from 'drizzle-orm/pg-core';

/* E4 Scoreboard v1 (docs/specs/observability-and-metrics.md).

   metric_definitions is the registry: one row per scoreboard metric, seeded
   by migration 0033 with the 12 spec metrics. The comparison UI is
   registry-driven -- adding a metric = one row here + one adapter mapping.

   metric_snapshots holds both sides' series:
     - sim rows:     at_tick = tick number, at_date = the tick's SIM date
       (T0-anchored, 1 tick = 1 sim day)
     - reality rows: at_date = the source's record date, at_tick = NULL

   The unique key is NULLS NOT DISTINCT (PG15+) because at_tick is NULL on
   every reality row -- under default semantics two reality rows for the
   same (metric, side, date) would never conflict, silently defeating
   idempotent re-pulls (the same trap reality_snapshots dodges with its ''
   category sentinel; a nullable integer can't carry a sentinel without
   lying about tick numbers). */
export const metricDefinitions = pgTable('metric_definitions', {
  key: varchar('key', { length: 60 }).primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  unit: varchar('unit', { length: 60 }).notNull(),
  simSource: text('sim_source').notNull(),
  realitySource: text('reality_source').notNull(),
  cadence: varchar('cadence', { length: 120 }).notNull(),
  direction: varchar('direction', { length: 10 }).notNull(), // 'lower' | 'higher' | 'context'
  tier: varchar('tier', { length: 1 }).notNull(), // 'A' | 'B' | 'C'
});

export const metricSnapshots = pgTable(
  'metric_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    metricKey: varchar('metric_key', { length: 60 })
      .notNull()
      .references(() => metricDefinitions.key),
    side: varchar('side', { length: 10 }).notNull(), // 'sim' | 'reality'
    value: doublePrecision('value').notNull(),
    atDate: date('at_date', { mode: 'string' }).notNull(),
    atTick: integer('at_tick'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keySideDateTickUnique: unique('metric_snapshots_key_side_date_tick_unique')
      .on(t.metricKey, t.side, t.atDate, t.atTick)
      .nullsNotDistinct(),
    keySideDateIdx: index('metric_snapshots_key_side_date_idx').on(t.metricKey, t.side, t.atDate.desc()),
  })
);
