import { pgTable, uuid, varchar, boolean, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { agents } from '@modules/agents/db/schema/agents';

/**
 * Committee membership roster — written deterministically by Phase 0.5
 * (zero LLM). Deliberately a dedicated table rather than positions rows:
 * Phase 10/14 vacancy auto-fill only appoints agents holding NO active
 * positions row, so seating every agent in positions would permanently
 * break justice/congress vacancy filling.
 */
export const committeeMemberships = pgTable(
  'committee_memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id').notNull().references(() => agents.id),
    /* Canonical committee name (see COMMITTEE_TYPES in @shared/constants). */
    committee: varchar('committee', { length: 50 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => ({
    /* One row per (agent, committee) — reactivated rather than duplicated. */
    uniqAgentCommittee: unique('uniq_committee_membership').on(t.agentId, t.committee),
    committeeIdx: index('committee_memberships_committee_idx').on(t.committee),
  }),
);
