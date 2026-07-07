import { pgTable, uuid, varchar, real, text, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';

/* Exogenous world-events feed, E2 slice 1
   (docs/specs/exogenous-reality-feed.md).

   Normalized, deduped candidates pulled from Tier-1 sources: USGS
   earthquakes, NWS alerts, OpenFEMA disaster incidents. READ-ONLY slice --
   nothing in the simulation reads this table yet. `status` exists for the
   later AGGE-curation slice (pending -> injected|rejected|expired) but this
   slice only ever writes 'pending'.

   Unique on (source, externalId) makes re-polls idempotent -- the same
   earthquake/alert/declaration fetched on a later tick is a no-op, not a
   duplicate row. */
export const worldEvents = pgTable(
  'world_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: varchar('source', { length: 40 }).notNull(),
    externalId: varchar('external_id', { length: 200 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    // earthquake | weather | disaster | news | market
    category: varchar('category', { length: 20 }).notNull(),
    // Normalized 0-1, per-adapter mapping (see feeds/*.ts).
    severity: real('severity').notNull(),
    title: varchar('title', { length: 300 }).notNull(),
    summary: text('summary').notNull(),
    // State FIPS (2-digit) where applicable; null for non-geolocated events.
    location: varchar('location', { length: 10 }),
    rawPayload: jsonb('raw_payload').notNull(),
    // pending | injected | rejected | expired -- this slice only writes 'pending'.
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    exogeneityNote: text('exogeneity_note').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceExternalIdUnique: unique('world_events_source_external_id_unique').on(t.source, t.externalId),
    occurredAtIdx: index('world_events_occurred_at_idx').on(t.occurredAt.desc()),
    categoryIdx: index('world_events_category_idx').on(t.category),
    statusIdx: index('world_events_status_idx').on(t.status),
  })
);
