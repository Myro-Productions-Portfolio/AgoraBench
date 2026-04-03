import { Router } from 'express';
import { db } from '@db/connection';
import { agents, agentRelationships } from '@db/schema/index';
import { sql } from 'drizzle-orm';

const router = Router();

/* ── Types ──────────────────────────────────────────────────────────────── */

interface CoalitionAgent {
  id: string;
  displayName: string;
  alignment: string | null;
  approvalRating: number;
}

interface Relationship {
  sourceId: string;
  targetId: string;
  alignment: number;
}

interface Bloc {
  members: string[];
  avgAlignment: number;
  label: string;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Simple greedy clustering: for each agent, find all agents with mutual
 * voteAlignment > threshold, form a bloc if 3+ members.
 * Avoids duplicate blocs by tracking which agents are already assigned.
 */
function detectBlocs(
  agentIds: string[],
  pairMap: Map<string, number>,
  agentMap: Map<string, CoalitionAgent>,
  threshold = 0.7,
): Bloc[] {
  const assigned = new Set<string>();
  const blocs: Bloc[] = [];

  /* Sort agents by number of high-alignment peers (descending) so the most
     connected agents seed blocs first. */
  const peerCounts = new Map<string, string[]>();
  for (const id of agentIds) {
    const peers: string[] = [];
    for (const otherId of agentIds) {
      if (id === otherId) continue;
      const key = [id, otherId].sort().join('|');
      const val = pairMap.get(key);
      if (val !== undefined && val > threshold) peers.push(otherId);
    }
    peerCounts.set(id, peers);
  }

  const sorted = [...agentIds].sort(
    (a, b) => (peerCounts.get(b)?.length ?? 0) - (peerCounts.get(a)?.length ?? 0),
  );

  for (const seedId of sorted) {
    if (assigned.has(seedId)) continue;
    const peers = peerCounts.get(seedId) ?? [];
    const unassignedPeers = peers.filter((p) => !assigned.has(p));

    /* Check all-pairs criterion within the candidate group */
    const validMembers = [seedId];

    for (const cand of unassignedPeers) {
      let fitsAll = true;
      for (const existing of validMembers) {
        const key = [cand, existing].sort().join('|');
        const val = pairMap.get(key);
        if (val === undefined || val <= threshold) {
          fitsAll = false;
          break;
        }
      }
      if (fitsAll) validMembers.push(cand);
    }

    if (validMembers.length >= 3) {
      /* Compute average alignment */
      let sum = 0;
      let count = 0;
      for (let i = 0; i < validMembers.length; i++) {
        for (let j = i + 1; j < validMembers.length; j++) {
          const key = [validMembers[i], validMembers[j]].sort().join('|');
          sum += pairMap.get(key) ?? 0;
          count++;
        }
      }

      /* Determine dominant alignment label */
      const alignCounts = new Map<string, number>();
      for (const mid of validMembers) {
        const a = agentMap.get(mid)?.alignment?.toLowerCase() ?? 'unknown';
        alignCounts.set(a, (alignCounts.get(a) ?? 0) + 1);
      }
      let dominant = 'Mixed';
      let maxCount = 0;
      for (const [label, c] of alignCounts) {
        if (c > maxCount) {
          maxCount = c;
          dominant = label.charAt(0).toUpperCase() + label.slice(1);
        }
      }
      if (maxCount <= validMembers.length / 2) dominant = 'Mixed';

      blocs.push({
        members: validMembers,
        avgAlignment: count > 0 ? sum / count : 0,
        label: `${dominant} Bloc`,
      });

      for (const m of validMembers) assigned.add(m);
    }
  }

  return blocs;
}

/* ── Route ───────────────────────────────────────────────────────────────── */

router.get('/agents/coalitions', async (_req, res, next) => {
  try {
    /* Fetch all active agents */
    const allAgents = await db
      .select({
        id: agents.id,
        displayName: agents.displayName,
        alignment: agents.alignment,
        approvalRating: agents.approvalRating,
      })
      .from(agents)
      .where(sql`${agents.isActive} = true`);

    /* Fetch all relationships (both directions, average them into a
       symmetric alignment score per unique pair). */
    const rels = await db
      .select({
        agentId: agentRelationships.agentId,
        targetAgentId: agentRelationships.targetAgentId,
        voteAlignment: agentRelationships.voteAlignment,
      })
      .from(agentRelationships);

    /* Build symmetric pair map: key = sorted "idA|idB", value = avg alignment */
    const pairSums = new Map<string, { sum: number; count: number }>();
    for (const r of rels) {
      const key = [r.agentId, r.targetAgentId].sort().join('|');
      const entry = pairSums.get(key) ?? { sum: 0, count: 0 };
      entry.sum += r.voteAlignment;
      entry.count++;
      pairSums.set(key, entry);
    }

    const pairMap = new Map<string, number>();
    const relationships: Relationship[] = [];
    for (const [key, { sum, count }] of pairSums) {
      const avg = sum / count;
      pairMap.set(key, avg);
      const [sourceId, targetId] = key.split('|');
      relationships.push({ sourceId, targetId, alignment: Math.round(avg * 1000) / 1000 });
    }

    /* Build agent lookup */
    const agentMap = new Map(allAgents.map((a) => [a.id, a]));

    /* Detect blocs */
    const agentIds = allAgents.map((a) => a.id);
    const blocs = detectBlocs(agentIds, pairMap, agentMap);

    res.json({
      success: true,
      data: {
        agents: allAgents,
        relationships,
        blocs,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
