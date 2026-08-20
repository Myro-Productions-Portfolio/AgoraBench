import { pgTable, uuid, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { tickLog } from '@modules/government/db/schema/government';

/**
 * The Agora Gazette — one short editorial recap per tick, generated from a
 * deterministic digest of that tick's activity. A dedicated table (not
 * agentStatements) because the Gazette has no agent author and
 * agentStatements.agentId is NOT NULL. The digest fed to the LLM is stored
 * alongside the output so failures and hallucinations stay diagnosable.
 */
export const gazetteIssues = pgTable(
  'gazette_issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tickId: uuid('tick_id').references(() => tickLog.id),
    /* 'gazette' = Daily Gazette (enters agent prompts via buildRecentNewsBlock);
       'ten_k' = the Agora 10-K (sim-vs-REALITY narrative — press surfaces only,
       must never enter agent prompts: agent-facing readers filter kind='gazette'). */
    kind: varchar('kind', { length: 20 }).notNull().default('gazette'),
    headline: varchar('headline', { length: 200 }).notNull(),
    body: text('body').notNull(),
    /* Deterministic digest the LLM was given — audit trail, never model output. */
    digest: text('digest').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdAtIdx: index('gazette_issues_created_at_idx').on(t.createdAt),
    kindCreatedAtIdx: index('gazette_issues_kind_created_at_idx').on(t.kind, t.createdAt.desc()),
  }),
);
