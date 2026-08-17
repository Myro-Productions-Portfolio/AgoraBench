/**
 * Office-exclusivity guard: agents holding an active `president` or
 * `supreme_justice` position must never be auto-seated/picked by the
 * engine's automatic assignment paths (Phase 0.5 committee assignment,
 * Phase 0.5 chair succession, Phase 14 congress vacancy fill). Elections
 * are NOT governed by this — winning a higher office vacating a lower one
 * is the existing E3 rule in electionMath/finalizeElection. This only
 * stops the engine from handing the office back afterward.
 */

const EXCLUDED_POSITION_TYPES = new Set(['president', 'supreme_justice']);

export interface HeldPosition {
  agentId: string;
  type: string;
}

/** Agent ids holding an active president or supreme_justice position. */
export function excludedOfficeHolderIds(activePositions: readonly HeldPosition[]): Set<string> {
  const ids = new Set<string>();
  for (const p of activePositions) {
    if (EXCLUDED_POSITION_TYPES.has(p.type)) ids.add(p.agentId);
  }
  return ids;
}

/** Drop agents whose id is in excludeIds. Pure set-difference, order-preserving. */
export function excludeOfficeHolders<T extends { id: string }>(
  candidates: readonly T[],
  excludeIds: ReadonlySet<string>,
): T[] {
  return candidates.filter((c) => !excludeIds.has(c.id));
}
