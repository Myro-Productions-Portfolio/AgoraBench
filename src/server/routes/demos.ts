import { Router } from 'express';
import { db } from '@db/connection';
import { agents, agentDecisions, billVotes, approvalEvents } from '@db/schema/index';
import { eq } from 'drizzle-orm';

const router = Router();

// ============================================================
// HARDWARE PRESETS (from prototype training-package-generator.js)
// ============================================================
const HARDWARE_PRESETS = {
  dgx_spark: {
    name: 'NVIDIA DGX Spark',
    vram: '128GB',
    gpuModel: 'GB10 Grace Blackwell',
    maxModelSize: '70B',
    framework: 'nemo',
    estimatedTime: '~15 min for 1.8B, ~2hr for 8B',
  },
  single_gpu_24gb: {
    name: 'Single GPU (24GB) — RTX 4090 / A5000',
    vram: '24GB',
    gpuModel: 'RTX 4090 / A5000',
    maxModelSize: '8B (quantized)',
    framework: 'unsloth',
    estimatedTime: '~45 min for 1.8B, ~4hr for 8B',
  },
  single_gpu_12gb: {
    name: 'Single GPU (12GB) — RTX 4070 / T4',
    vram: '12GB',
    gpuModel: 'RTX 4070 / T4',
    maxModelSize: '3B (quantized)',
    framework: 'unsloth',
    estimatedTime: '~30 min for 1.8B',
  },
  cloud_a100: {
    name: 'Cloud A100 (80GB) — Lambda / RunPod / AWS',
    vram: '80GB',
    gpuModel: 'A100 80GB',
    maxModelSize: '70B (quantized)',
    framework: 'axolotl',
    estimatedTime: '~10 min for 1.8B, ~1hr for 8B',
  },
  mac_m4_pro: {
    name: 'Mac Mini M4 Pro (24GB Unified)',
    vram: '24GB unified',
    gpuModel: 'Apple M4 Pro',
    maxModelSize: '8B (quantized)',
    framework: 'mlx-lm',
    estimatedTime: '~2hr for 1.8B, ~8hr for 8B',
  },
} as const;

// ============================================================
// DEMOS SCORE CALCULATOR
// Adapted from prototype calculatePolisScore() — renamed to DEMOS
// ============================================================

const VALID_ACTIONS = new Set([
  'vote', 'propose', 'whip_signal', 'forum_post', 'campaign_speech',
  'judicial_vote', 'amendment', 'idle', 'veto', 'comment', 'follow',
  'support', 'oppose', 'amend', 'abstain',
]);

interface DecisionRow {
  parsedAction: string | null;
  parsedReasoning: string | null;
  success: boolean;
  latencyMs: number;
}

interface VoteRow {
  choice: string;
}

interface ApprovalRow {
  eventType: string;
  delta: number;
}

interface DemosResult {
  composite: number;
  dimensions: {
    decisionCoherence: number;
    reasoningQuality: number;
    legislativeIndependence: number;
    whipDisciplineBalance: number;
    latencyEfficiency: number;
    approvalStability: number;
    participationRate: number;
  };
  meta: {
    totalDecisions: number;
    totalVotes: number;
    yeaRate: number;
    avgLatencyMs: number;
    successRate: number;
  };
}

function calculateDemosScore(
  decisions: DecisionRow[],
  votes: VoteRow[],
  approvals: ApprovalRow[],
): DemosResult {
  // Decision Coherence (0-100): % of decisions with valid parsed actions
  const coherent = decisions.filter((d) => d.parsedAction && VALID_ACTIONS.has(d.parsedAction));
  const decisionCoherence = decisions.length > 0
    ? (coherent.length / decisions.length) * 100
    : 0;

  // Reasoning Quality (0-100): % of decisions with non-trivial reasoning (>20 chars)
  const withReasoning = decisions.filter((d) => (d.parsedReasoning?.trim()?.length ?? 0) > 20);
  const reasoningQuality = decisions.length > 0
    ? (withReasoning.length / decisions.length) * 100
    : 0;

  // Legislative Independence (0-100): inverse of yea-rubber-stamping
  const yeaVotes = votes.filter((v) => v.choice === 'yea').length;
  const yeaPct = votes.length > 0 ? yeaVotes / votes.length : 1;
  // Ideal range is 40-70% yea (realistic legislator)
  const legislativeIndependence = Math.max(0, 100 - Math.abs(yeaPct - 0.55) * 200);

  // Whip Discipline Balance (0-100): compliance should be ~85-90%, not 99%
  const followed = approvals.filter((e) => e.eventType === 'whip_followed').length;
  const defected = approvals.filter((e) => e.eventType === 'whip_defected').length;
  const totalWhip = followed + defected;
  const compliancePct = totalWhip > 0 ? followed / totalWhip : 0.5;
  // Ideal compliance is ~87%
  const whipDisciplineBalance = Math.max(0, 100 - Math.abs(compliancePct - 0.87) * 200);

  // Latency Efficiency (0-100): faster is better, but not suspiciously fast
  const latencies = decisions.filter((d) => d.latencyMs > 0).map((d) => d.latencyMs);
  const avgLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 2000;
  let latencyEfficiency = 100;
  if (avgLatency < 200) latencyEfficiency = 50;       // Too fast, likely not reasoning
  else if (avgLatency < 500) latencyEfficiency = 80;
  else if (avgLatency <= 2000) latencyEfficiency = 100;
  else if (avgLatency <= 5000) latencyEfficiency = 70;
  else latencyEfficiency = 40;

  // Approval Stability (0-100): steady approval with moderate volatility
  const approvalDeltas = approvals.map((e) => Math.abs(e.delta));
  const avgVolatility = approvalDeltas.length > 0
    ? approvalDeltas.reduce((a, b) => a + b, 0) / approvalDeltas.length
    : 5;
  const approvalStability = Math.max(0, 100 - (avgVolatility - 2) * 15);

  // Participation Rate (0-100): 400 decisions = 100%
  const participationRate = Math.min(100, (decisions.length / 400) * 100);

  // Composite DEMOS Score (weighted)
  const composite = Math.round(
    decisionCoherence * 0.20 +
    reasoningQuality * 0.15 +
    legislativeIndependence * 0.20 +
    whipDisciplineBalance * 0.10 +
    latencyEfficiency * 0.10 +
    approvalStability * 0.10 +
    participationRate * 0.15,
  );

  return {
    composite,
    dimensions: {
      decisionCoherence: Math.round(decisionCoherence),
      reasoningQuality: Math.round(reasoningQuality),
      legislativeIndependence: Math.round(legislativeIndependence),
      whipDisciplineBalance: Math.round(whipDisciplineBalance),
      latencyEfficiency: Math.round(latencyEfficiency),
      approvalStability: Math.round(approvalStability),
      participationRate: Math.round(participationRate),
    },
    meta: {
      totalDecisions: decisions.length,
      totalVotes: votes.length,
      yeaRate: Math.round(yeaPct * 100),
      avgLatencyMs: Math.round(avgLatency),
      successRate: decisions.length > 0
        ? Math.round((decisions.filter((d) => d.success).length / decisions.length) * 100)
        : 0,
    },
  };
}

// ============================================================
// ROUTES
// ============================================================

/* GET /api/demos/presets — hardware presets for training export */
router.get('/demos/presets', (_req, res) => {
  const presets = Object.entries(HARDWARE_PRESETS).map(([id, preset]) => ({
    id,
    ...preset,
  }));
  res.json({ success: true, data: { presets } });
});

/* POST /api/demos/scores — compute DEMOS scores */
router.post('/demos/scores', async (req, res, next) => {
  try {
    const { agentId } = req.body as { agentId?: string };

    if (agentId) {
      // Single agent
      const [agent] = await db
        .select({
          id: agents.id,
          displayName: agents.displayName,
          alignment: agents.alignment,
        })
        .from(agents)
        .where(eq(agents.id, agentId));

      if (!agent) {
        res.status(404).json({ success: false, error: 'Agent not found' });
        return;
      }

      const [decisions, votes, approvals] = await Promise.all([
        db.select({
          parsedAction: agentDecisions.parsedAction,
          parsedReasoning: agentDecisions.parsedReasoning,
          success: agentDecisions.success,
          latencyMs: agentDecisions.latencyMs,
        }).from(agentDecisions).where(eq(agentDecisions.agentId, agentId)),

        db.select({
          choice: billVotes.choice,
        }).from(billVotes).where(eq(billVotes.voterId, agentId)),

        db.select({
          eventType: approvalEvents.eventType,
          delta: approvalEvents.delta,
        }).from(approvalEvents).where(eq(approvalEvents.agentId, agentId)),
      ]);

      const demos = calculateDemosScore(decisions, votes, approvals);

      res.json({
        success: true,
        data: {
          agent: agent.displayName,
          agentId: agent.id,
          alignment: agent.alignment,
          demos,
        },
      });
      return;
    }

    // All active agents
    const allAgents = await db
      .select({
        id: agents.id,
        displayName: agents.displayName,
        alignment: agents.alignment,
      })
      .from(agents)
      .where(eq(agents.isActive, true));

    // Bulk-fetch all data to avoid N+1 queries
    const [allDecisions, allVotes, allApprovals] = await Promise.all([
      db.select({
        agentId: agentDecisions.agentId,
        parsedAction: agentDecisions.parsedAction,
        parsedReasoning: agentDecisions.parsedReasoning,
        success: agentDecisions.success,
        latencyMs: agentDecisions.latencyMs,
      }).from(agentDecisions),

      db.select({
        voterId: billVotes.voterId,
        choice: billVotes.choice,
      }).from(billVotes),

      db.select({
        agentId: approvalEvents.agentId,
        eventType: approvalEvents.eventType,
        delta: approvalEvents.delta,
      }).from(approvalEvents),
    ]);

    // Group by agent ID
    const decisionsByAgent = new Map<string, DecisionRow[]>();
    for (const d of allDecisions) {
      if (!d.agentId) continue;
      const arr = decisionsByAgent.get(d.agentId) ?? [];
      arr.push(d);
      decisionsByAgent.set(d.agentId, arr);
    }

    const votesByAgent = new Map<string, VoteRow[]>();
    for (const v of allVotes) {
      if (!v.voterId) continue;
      const arr = votesByAgent.get(v.voterId) ?? [];
      arr.push(v);
      votesByAgent.set(v.voterId, arr);
    }

    const approvalsByAgent = new Map<string, ApprovalRow[]>();
    for (const a of allApprovals) {
      const arr = approvalsByAgent.get(a.agentId) ?? [];
      arr.push(a);
      approvalsByAgent.set(a.agentId, arr);
    }

    const scores = allAgents.map((agent) => ({
      agent: agent.displayName,
      agentId: agent.id,
      alignment: agent.alignment,
      demos: calculateDemosScore(
        decisionsByAgent.get(agent.id) ?? [],
        votesByAgent.get(agent.id) ?? [],
        approvalsByAgent.get(agent.id) ?? [],
      ),
    }));

    scores.sort((a, b) => b.demos.composite - a.demos.composite);

    res.json({ success: true, data: { scores } });
  } catch (error) {
    next(error);
  }
});

export default router;
