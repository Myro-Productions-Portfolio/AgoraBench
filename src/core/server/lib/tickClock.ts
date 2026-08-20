import { sql } from 'drizzle-orm';
import { db } from '@db/connection';
import { tickLog } from '@db/schema/index';

/**
 * Current tick number for OUT-OF-TICK callers (admin routes, orchestrator):
 * COUNT of completed ticks + 1 — the number the currently-running or next
 * tick carries. Same gap-free, restart-robust formula agentTick.ts derives
 * at the top of every tick; centralized here so admin/orchestrator election
 * writes stamp tick anchors consistent with what Phase 14 will read.
 */
export async function getCurrentTickNumber(): Promise<number> {
  const [row] = await db
    .select({ completed: sql<number>`COUNT(*) FILTER (WHERE ${tickLog.completedAt} IS NOT NULL)` })
    .from(tickLog);
  return Number(row?.completed ?? 0) + 1;
}
