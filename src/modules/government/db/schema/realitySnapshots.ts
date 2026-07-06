import { pgTable, uuid, date, integer, varchar, bigint, timestamp, unique, index } from 'drizzle-orm/pg-core';

/* Divergence experiment, slice 3 -- reality reference pool.

   Periodic pulls from the Treasury Fiscal Data API, stored purely for
   comparison against sim state. NOTHING in the simulation reads this table
   -- the divergence API (a later slice) is the only intended consumer. Rows
   come from three sources, distinguished by `source`:

     - 'mts_table_9' -- one row per spending-by-function category
       (National Defense, Medicare, Social Security, Net Interest, ...),
       `category` set, `outlaysFytd` populated.
     - 'mts_table_1' -- the single top-line row (receipts/outlays/deficit
       FYTD), `category` null.
     - 'debt_to_penny' -- the latest total public debt outstanding,
       `category` null, only `debtOutstanding` populated.

   Unique on (recordDate, category, source) makes re-pulls idempotent. */
export const realitySnapshots = pgTable(
  'reality_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recordDate: date('record_date', { mode: 'string' }).notNull(),
    fiscalYear: integer('fiscal_year'),
    fiscalMonth: integer('fiscal_month'),
    // Treasury MTS budget-function bucket name; null for top-line rows.
    category: varchar('category', { length: 120 }),
    outlaysFytd: bigint('outlays_fytd', { mode: 'number' }),
    receiptsFytd: bigint('receipts_fytd', { mode: 'number' }),
    deficitFytd: bigint('deficit_fytd', { mode: 'number' }),
    debtOutstanding: bigint('debt_outstanding', { mode: 'number' }),
    source: varchar('source', { length: 40 }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dateCategorySourceUnique: unique('reality_snapshots_date_category_source_unique').on(
      t.recordDate,
      t.category,
      t.source
    ),
    sourceDateIdx: index('reality_snapshots_source_date_idx').on(t.source, t.recordDate.desc()),
  })
);
