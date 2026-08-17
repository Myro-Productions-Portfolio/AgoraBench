import { pgTable, integer, text, timestamp, jsonb, serial, index } from 'drizzle-orm/pg-core';
import type { CityStats } from '../../engine/types';

/* Capitol City persistence (docs/specs/city-effect-layer.md §2). `state`/
   `snapshot` are gzip+base64 of the engine's serialize() output (~8 KB gz);
   `stats` is duplicated as jsonb so timelapse/stat queries never decompress
   snapshots. The CityStats import is type-only — no engine (GPL) code is
   emitted from this module. */

/* Single current row: id is always 1 (same convention as runtime_config). */
export const cityState = pgTable('city_state', {
  id: integer('id').primaryKey().default(1),
  tickNumber: integer('tick_number').notNull(),
  cityTimeMonths: integer('city_time_months').notNull(),
  state: text('state').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* Append-only per-tick history — powers the timelapse feature. */
export const citySnapshots = pgTable(
  'city_snapshots',
  {
    id: serial('id').primaryKey(),
    tickNumber: integer('tick_number').notNull(),
    cityTimeMonths: integer('city_time_months').notNull(),
    stats: jsonb('stats').$type<CityStats>().notNull(),
    snapshot: text('snapshot').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tickNumberIdx: index('city_snapshots_tick_number_idx').on(t.tickNumber.desc()),
  })
);
