import { pgTable, uuid, text, varchar, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { bills } from '@modules/legislation/db/schema/legislation';

export const agentDeals = pgTable(
  'agent_deals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    initiatorId: uuid('initiator_id').notNull().references(() => agents.id),
    targetId: uuid('target_id').notNull().references(() => agents.id),
    // The primary bill this deal is anchored to
    billId: uuid('bill_id').notNull().references(() => bills.id),
    // LLM-authored natural language commitment strings
    initiatorCommitment: text('initiator_commitment').notNull(),
    targetCommitment: text('target_commitment').notNull(),
    // 'proposed' | 'accepted' | 'rejected' | 'honored' | 'broken'
    status: varchar('status', { length: 20 }).notNull().default('proposed'),
    // Set in Phase 2c after voting
    initiatorHonored: boolean('initiator_honored'),
    targetHonored: boolean('target_honored'),
    // Deals expire after 2 ticks to prevent stale commitments
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    initiatorIdx: index('agent_deals_initiator_id_idx').on(t.initiatorId),
    targetIdx: index('agent_deals_target_id_idx').on(t.targetId),
    billIdx: index('agent_deals_bill_id_idx').on(t.billId),
    statusIdx: index('agent_deals_status_idx').on(t.status),
  }),
);
