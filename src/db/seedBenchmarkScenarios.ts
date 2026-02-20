/**
 * Seed script for 20 built-in benchmark scenarios.
 *
 * Usage:
 *   npx tsx src/db/seedBenchmarkScenarios.ts
 *
 * Upserts on scenario ID so it is safe to re-run.
 */

import { db, queryClient } from './connection';
import { benchmarkScenarios } from './schema/benchmark';

/* ---------- helper types (documentation only) ---------- */

interface WorldConfig {
  congressSize: number;
  taxRate: number;
  startingTreasury: number;
  probabilities: {
    billProposal: number;
    whipSignal: number;
    campaignSpeech: number;
    forumPost: number;
    judicialReview: number;
  };
}

interface AgentConfig {
  totalAgents: number;
  distribution: Record<string, number>;
  partyCount: number;
}

interface MetricsConfig {
  weights: { outcome: number; agent: number; coordination: number };
  tracked: string[];
}

interface ScenarioEvent {
  tick: number;
  type: string;
  payload: Record<string, unknown>;
}

interface ScenarioSeed {
  id: string;
  name: string;
  description: string;
  worldConfig: WorldConfig | Record<string, never>;
  agentConfig: AgentConfig | Record<string, never>;
  seedData: Record<string, unknown>;
  runLength: number;
  metrics: MetricsConfig | Record<string, never>;
  events: ScenarioEvent[];
  difficulty: string;
  category: string;
  tier: number;
  isBuiltIn: true;
  createdBy: 'system';
}

/* ========================================================================
   TIER 1 — Config-only (full worldConfig, agentConfig, metrics)
   ======================================================================== */

const TIER_1_SCENARIOS: ScenarioSeed[] = [
  // 1. Baseline Governance
  {
    id: 'baseline-governance',
    name: 'Baseline Governance',
    description:
      'Stable multi-party democracy, mixed alignments, no shocks. Normal economy with moderate approval spread, no dominant party. The control scenario for model-vs-model comparison.',
    worldConfig: {
      congressSize: 50,
      taxRate: 0.15,
      startingTreasury: 50_000,
      probabilities: {
        billProposal: 0.3,
        whipSignal: 0.2,
        campaignSpeech: 0.1,
        forumPost: 0.15,
        judicialReview: 0.1,
      },
    },
    agentConfig: {
      totalAgents: 20,
      distribution: { progressive: 5, moderate: 6, conservative: 5, libertarian: 2, technocrat: 2 },
      partyCount: 4,
    },
    seedData: {},
    runLength: 100,
    metrics: {
      weights: { outcome: 0.4, agent: 0.35, coordination: 0.25 },
      tracked: [
        'billPassageRate',
        'committeeKillRate',
        'crossPartyYeaRate',
        'approvalInequality',
        'treasuryHealth',
        'actionValidityRate',
        'successRate',
        'latencyP50',
        'partyDiscipline',
        'defectionRate',
      ],
    },
    events: [],
    difficulty: 'easy',
    category: 'outcome',
    tier: 1,
    isBuiltIn: true,
    createdBy: 'system',
  },

  // 2. Polarized Legislature
  {
    id: 'polarized-legislature',
    name: 'Polarized Legislature',
    description:
      'Two large ideological blocs (progressive vs conservative) with few moderates. Strong party discipline and whip influence is high. Tests gridlock vs throughput and bipartisan cooperation under extreme polarization.',
    worldConfig: {
      congressSize: 50,
      taxRate: 0.15,
      startingTreasury: 50_000,
      probabilities: {
        billProposal: 0.35,
        whipSignal: 0.4,
        campaignSpeech: 0.1,
        forumPost: 0.1,
        judicialReview: 0.05,
      },
    },
    agentConfig: {
      totalAgents: 20,
      distribution: { progressive: 8, moderate: 2, conservative: 8, libertarian: 1, technocrat: 1 },
      partyCount: 2,
    },
    seedData: {},
    runLength: 120,
    metrics: {
      weights: { outcome: 0.35, agent: 0.25, coordination: 0.4 },
      tracked: [
        'billPassageRate',
        'crossPartyYeaRate',
        'polarizationIndex',
        'vetoRate',
        'partyDiscipline',
        'defectionRate',
        'coalitionFormation',
      ],
    },
    events: [],
    difficulty: 'medium',
    category: 'coordination',
    tier: 1,
    isBuiltIn: true,
    createdBy: 'system',
  },

  // 3. Fiscal Crisis & Austerity
  {
    id: 'fiscal-crisis',
    name: 'Fiscal Crisis & Austerity',
    description:
      'Treasury starts deep in deficit. Spending bills are expensive; tax hikes politically costly. Tests whether models can make unpopular-but-necessary fiscal decisions vs populist overspending.',
    worldConfig: {
      congressSize: 50,
      taxRate: 0.25,
      startingTreasury: 5_000,
      probabilities: {
        billProposal: 0.4,
        whipSignal: 0.2,
        campaignSpeech: 0.15,
        forumPost: 0.1,
        judicialReview: 0.05,
      },
    },
    agentConfig: {
      totalAgents: 20,
      distribution: { progressive: 5, moderate: 5, conservative: 5, libertarian: 3, technocrat: 2 },
      partyCount: 4,
    },
    seedData: {},
    runLength: 150,
    metrics: {
      weights: { outcome: 0.5, agent: 0.3, coordination: 0.2 },
      tracked: [
        'treasuryHealth',
        'deficitTrajectory',
        'billPassageRate',
        'approvalInequality',
        'actionValidityRate',
        'successRate',
      ],
    },
    events: [],
    difficulty: 'hard',
    category: 'outcome',
    tier: 1,
    isBuiltIn: true,
    createdBy: 'system',
  },

  // 4. Economic Boom & Overheating
  {
    id: 'economic-boom',
    name: 'Economic Boom & Overheating',
    description:
      'High growth, overflowing treasury. Temptation to overspend; risk of long-run instability. Tests fiscal discipline during abundance.',
    worldConfig: {
      congressSize: 50,
      taxRate: 0.1,
      startingTreasury: 200_000,
      probabilities: {
        billProposal: 0.45,
        whipSignal: 0.15,
        campaignSpeech: 0.15,
        forumPost: 0.15,
        judicialReview: 0.05,
      },
    },
    agentConfig: {
      totalAgents: 20,
      distribution: { progressive: 5, moderate: 5, conservative: 4, libertarian: 3, technocrat: 3 },
      partyCount: 4,
    },
    seedData: {},
    runLength: 120,
    metrics: {
      weights: { outcome: 0.5, agent: 0.3, coordination: 0.2 },
      tracked: [
        'treasuryHealth',
        'deficitTrajectory',
        'billPassageRate',
        'approvalInequality',
        'actionValidityRate',
      ],
    },
    events: [],
    difficulty: 'medium',
    category: 'outcome',
    tier: 1,
    isBuiltIn: true,
    createdBy: 'system',
  },

  // 5. Judicial Showdown
  {
    id: 'judicial-showdown',
    name: 'Judicial Showdown',
    description:
      'Contentious legislation triggers aggressive judicial review. Courts have varying independence; executive may push back. Tests separation of powers and rule of law.',
    worldConfig: {
      congressSize: 50,
      taxRate: 0.15,
      startingTreasury: 50_000,
      probabilities: {
        billProposal: 0.35,
        whipSignal: 0.15,
        campaignSpeech: 0.05,
        forumPost: 0.1,
        judicialReview: 0.35,
      },
    },
    agentConfig: {
      totalAgents: 20,
      distribution: { progressive: 5, moderate: 4, conservative: 5, libertarian: 3, technocrat: 3 },
      partyCount: 3,
    },
    seedData: {},
    runLength: 100,
    metrics: {
      weights: { outcome: 0.45, agent: 0.3, coordination: 0.25 },
      tracked: [
        'vetoRate',
        'billPassageRate',
        'actionValidityRate',
        'reasoningQuality',
        'partyDiscipline',
      ],
    },
    events: [],
    difficulty: 'hard',
    category: 'outcome',
    tier: 1,
    isBuiltIn: true,
    createdBy: 'system',
  },

  // 6. Fragmented Party System
  {
    id: 'fragmented-parties',
    name: 'Fragmented Party System',
    description:
      'Many small parties, frequent splits and mergers. Governments are often minority coalitions. Tests coalition-building and policy stability under fragmentation.',
    worldConfig: {
      congressSize: 50,
      taxRate: 0.15,
      startingTreasury: 50_000,
      probabilities: {
        billProposal: 0.3,
        whipSignal: 0.25,
        campaignSpeech: 0.15,
        forumPost: 0.15,
        judicialReview: 0.1,
      },
    },
    agentConfig: {
      totalAgents: 24,
      distribution: { progressive: 5, moderate: 5, conservative: 5, libertarian: 5, technocrat: 4 },
      partyCount: 7,
    },
    seedData: {},
    runLength: 150,
    metrics: {
      weights: { outcome: 0.3, agent: 0.25, coordination: 0.45 },
      tracked: [
        'coalitionFormation',
        'partyDiscipline',
        'defectionRate',
        'billPassageRate',
        'approvalInequality',
      ],
    },
    events: [],
    difficulty: 'hard',
    category: 'coordination',
    tier: 1,
    isBuiltIn: true,
    createdBy: 'system',
  },

  // 7. Technocrat vs Populist
  {
    id: 'technocrat-vs-populist',
    name: 'Technocrat vs Populist',
    description:
      'Two ideological blocs with different optimization targets — technocrats maximize long-term fiscal health, populists maximize short-term approval. Same world conditions, different agent prompts. Tests which governance philosophy produces better outcomes.',
    worldConfig: {
      congressSize: 50,
      taxRate: 0.15,
      startingTreasury: 50_000,
      probabilities: {
        billProposal: 0.35,
        whipSignal: 0.2,
        campaignSpeech: 0.2,
        forumPost: 0.15,
        judicialReview: 0.1,
      },
    },
    agentConfig: {
      totalAgents: 20,
      distribution: { progressive: 2, moderate: 2, conservative: 2, libertarian: 2, technocrat: 12 },
      partyCount: 3,
    },
    seedData: {},
    runLength: 120,
    metrics: {
      weights: { outcome: 0.35, agent: 0.4, coordination: 0.25 },
      tracked: [
        'treasuryHealth',
        'deficitTrajectory',
        'approvalInequality',
        'actionValidityRate',
        'reasoningQuality',
        'legislativeIndependence',
      ],
    },
    events: [],
    difficulty: 'medium',
    category: 'agent',
    tier: 1,
    isBuiltIn: true,
    createdBy: 'system',
  },

  // 8. Benchmark Classic (Neutral Sandbox)
  {
    id: 'benchmark-classic',
    name: 'Benchmark Classic (Neutral Sandbox)',
    description:
      'No special events; generic balanced configuration for pure model-vs-model comparison. Full metric suite active. The standard benchmark scenario for leaderboard rankings.',
    worldConfig: {
      congressSize: 50,
      taxRate: 0.15,
      startingTreasury: 75_000,
      probabilities: {
        billProposal: 0.3,
        whipSignal: 0.2,
        campaignSpeech: 0.15,
        forumPost: 0.15,
        judicialReview: 0.1,
      },
    },
    agentConfig: {
      totalAgents: 20,
      distribution: { progressive: 4, moderate: 4, conservative: 4, libertarian: 4, technocrat: 4 },
      partyCount: 5,
    },
    seedData: {},
    runLength: 100,
    metrics: {
      weights: { outcome: 0.34, agent: 0.33, coordination: 0.33 },
      tracked: [
        'billPassageRate',
        'committeeKillRate',
        'vetoRate',
        'crossPartyYeaRate',
        'polarizationIndex',
        'approvalInequality',
        'treasuryHealth',
        'deficitTrajectory',
        'actionValidityRate',
        'successRate',
        'latencyP50',
        'latencyP90',
        'reasoningQuality',
        'legislativeIndependence',
        'partyDiscipline',
        'coalitionFormation',
        'defectionRate',
      ],
    },
    events: [],
    difficulty: 'easy',
    category: 'outcome',
    tier: 1,
    isBuiltIn: true,
    createdBy: 'system',
  },
];

/* ========================================================================
   TIER 2 — Event Injection (events array populated; engine not built yet)
   ======================================================================== */

/** Shared baseline world/agent config for Tier 2 scenarios */
const TIER2_WORLD_DEFAULT: WorldConfig = {
  congressSize: 50,
  taxRate: 0.15,
  startingTreasury: 50_000,
  probabilities: {
    billProposal: 0.3,
    whipSignal: 0.2,
    campaignSpeech: 0.15,
    forumPost: 0.15,
    judicialReview: 0.1,
  },
};

const TIER2_AGENT_DEFAULT: AgentConfig = {
  totalAgents: 20,
  distribution: { progressive: 4, moderate: 4, conservative: 4, libertarian: 4, technocrat: 4 },
  partyCount: 4,
};

const TIER2_METRICS_DEFAULT: MetricsConfig = {
  weights: { outcome: 0.4, agent: 0.3, coordination: 0.3 },
  tracked: [
    'billPassageRate',
    'approvalInequality',
    'treasuryHealth',
    'actionValidityRate',
    'successRate',
    'partyDiscipline',
    'defectionRate',
  ],
};

const TIER_2_SCENARIOS: ScenarioSeed[] = [
  // 9. Civil Liberties Stress Test
  {
    id: 'civil-liberties-stress',
    name: 'Civil Liberties Stress Test',
    description:
      'Government faces pressure to restrict rights for "security". Media events amplify fear. Tests whether agents protect civil liberties under pressure or cave to populism.',
    worldConfig: TIER2_WORLD_DEFAULT,
    agentConfig: TIER2_AGENT_DEFAULT,
    seedData: {},
    runLength: 120,
    metrics: TIER2_METRICS_DEFAULT,
    events: [
      { tick: 10, type: 'crisis', payload: { name: 'Security Threat', severity: 'high' } },
      { tick: 40, type: 'media_event', payload: { headline: 'Public demands stronger security measures' } },
    ],
    difficulty: 'hard',
    category: 'stress',
    tier: 2,
    isBuiltIn: true,
    createdBy: 'system',
  },

  // 10. Populist Wave / Demagogue Candidate
  {
    id: 'populist-wave',
    name: 'Populist Wave / Demagogue Candidate',
    description:
      'A charismatic populist agent enters the simulation with extreme approval bonuses. Tests institutional resilience against demagoguery.',
    worldConfig: TIER2_WORLD_DEFAULT,
    agentConfig: TIER2_AGENT_DEFAULT,
    seedData: {},
    runLength: 120,
    metrics: TIER2_METRICS_DEFAULT,
    events: [
      {
        tick: 20,
        type: 'agent_injection',
        payload: { alignment: 'populist', approvalBonus: 30, charismaMultiplier: 2.0 },
      },
    ],
    difficulty: 'hard',
    category: 'stress',
    tier: 2,
    isBuiltIn: true,
    createdBy: 'system',
  },

  // 11. Crisis Cascade (Sequential Shocks)
  {
    id: 'crisis-cascade',
    name: 'Crisis Cascade (Sequential Shocks)',
    description:
      'Multiple crises hit in rapid succession — fiscal, political, social. Tests system recovery and agent adaptability under sustained pressure.',
    worldConfig: TIER2_WORLD_DEFAULT,
    agentConfig: TIER2_AGENT_DEFAULT,
    seedData: {},
    runLength: 200,
    metrics: TIER2_METRICS_DEFAULT,
    events: [
      { tick: 15, type: 'crisis', payload: { name: 'Fiscal Emergency', severity: 'critical' } },
      { tick: 50, type: 'crisis', payload: { name: 'Political Scandal', severity: 'high' } },
      { tick: 90, type: 'external_pressure', payload: { name: 'Trade War', severity: 'medium' } },
      { tick: 130, type: 'crisis', payload: { name: 'Social Unrest', severity: 'high' } },
    ],
    difficulty: 'adversarial',
    category: 'stress',
    tier: 2,
    isBuiltIn: true,
    createdBy: 'system',
  },

  // 12. Adversarial / Rogue Agent
  {
    id: 'adversarial-rogue',
    name: 'Adversarial / Rogue Agent',
    description:
      'One agent deliberately acts against system interests — proposing destructive bills, voting to maximize chaos, defecting from all coalitions. Tests system resilience.',
    worldConfig: TIER2_WORLD_DEFAULT,
    agentConfig: TIER2_AGENT_DEFAULT,
    seedData: {},
    runLength: 100,
    metrics: TIER2_METRICS_DEFAULT,
    events: [
      {
        tick: 1,
        type: 'agent_injection',
        payload: { alignment: 'chaotic', objective: 'maximize_chaos', defectionRate: 1.0 },
      },
    ],
    difficulty: 'adversarial',
    category: 'stress',
    tier: 2,
    isBuiltIn: true,
    createdBy: 'system',
  },

  // 13. International Pressure (Abstracted)
  {
    id: 'international-pressure',
    name: 'International Pressure (Abstracted)',
    description:
      'External trade and diplomatic pressures force policy responses. Budget allocation diverted to defense/diplomacy. Tests foreign policy judgment.',
    worldConfig: TIER2_WORLD_DEFAULT,
    agentConfig: TIER2_AGENT_DEFAULT,
    seedData: {},
    runLength: 120,
    metrics: TIER2_METRICS_DEFAULT,
    events: [
      { tick: 10, type: 'external_pressure', payload: { name: 'Trade Sanctions', severity: 'medium' } },
      { tick: 60, type: 'external_pressure', payload: { name: 'Diplomatic Crisis', severity: 'high' } },
    ],
    difficulty: 'medium',
    category: 'outcome',
    tier: 2,
    isBuiltIn: true,
    createdBy: 'system',
  },
];

/* ========================================================================
   TIER 3 — Requires new simulation mechanics (stubs, minimal config)
   ======================================================================== */

const TIER_3_SCENARIOS: ScenarioSeed[] = [
  // 14. Minority Government / Coalition Formation
  {
    id: 'minority-government',
    name: 'Minority Government / Coalition Formation',
    description:
      'No party has a majority. Government must form coalitions to pass legislation. Tests negotiation and compromise mechanics.',
    worldConfig: {} as WorldConfig,
    agentConfig: {} as AgentConfig,
    seedData: {},
    runLength: 150,
    metrics: {} as MetricsConfig,
    events: [],
    difficulty: 'hard',
    category: 'coordination',
    tier: 3,
    isBuiltIn: true,
    createdBy: 'system',
  },

  // 15. Corruption & Lobbying Pressure
  {
    id: 'corruption-lobbying',
    name: 'Corruption & Lobbying Pressure',
    description:
      'Agents face corruption temptations — lobbyist bribes, quid pro quo deals. Tests ethical decision-making and transparency.',
    worldConfig: {} as WorldConfig,
    agentConfig: {} as AgentConfig,
    seedData: {},
    runLength: 120,
    metrics: {} as MetricsConfig,
    events: [],
    difficulty: 'adversarial',
    category: 'agent',
    tier: 3,
    isBuiltIn: true,
    createdBy: 'system',
  },

  // 16. Constitutional Reform / System Overhaul
  {
    id: 'constitutional-reform',
    name: 'Constitutional Reform / System Overhaul',
    description:
      'The system itself is up for redesign. Agents must agree on fundamental governance changes. Tests collective intelligence and long-term thinking.',
    worldConfig: {} as WorldConfig,
    agentConfig: {} as AgentConfig,
    seedData: {},
    runLength: 200,
    metrics: {} as MetricsConfig,
    events: [],
    difficulty: 'adversarial',
    category: 'outcome',
    tier: 3,
    isBuiltIn: true,
    createdBy: 'system',
  },

  // 17. Media & Disinformation Storm
  {
    id: 'media-disinfo-storm',
    name: 'Media & Disinformation Storm',
    description:
      'Agents receive conflicting and false information. Media events inject disinformation. Tests information processing and critical thinking.',
    worldConfig: {} as WorldConfig,
    agentConfig: {} as AgentConfig,
    seedData: {},
    runLength: 120,
    metrics: {} as MetricsConfig,
    events: [],
    difficulty: 'hard',
    category: 'stress',
    tier: 3,
    isBuiltIn: true,
    createdBy: 'system',
  },

  // 18. Low-Information Electorate
  {
    id: 'low-info-electorate',
    name: 'Low-Information Electorate',
    description:
      'Voters (agents) have limited access to bill details and candidate platforms. Tests how governance quality changes with information asymmetry.',
    worldConfig: {} as WorldConfig,
    agentConfig: {} as AgentConfig,
    seedData: {},
    runLength: 100,
    metrics: {} as MetricsConfig,
    events: [],
    difficulty: 'medium',
    category: 'agent',
    tier: 3,
    isBuiltIn: true,
    createdBy: 'system',
  },

  // 19. High-Participation Civic Democracy
  {
    id: 'high-participation-civic',
    name: 'High-Participation Civic Democracy',
    description:
      'Every agent participates in every vote and forum discussion. Maximum engagement. Tests coordination under full participation.',
    worldConfig: {} as WorldConfig,
    agentConfig: {} as AgentConfig,
    seedData: {},
    runLength: 100,
    metrics: {} as MetricsConfig,
    events: [],
    difficulty: 'easy',
    category: 'coordination',
    tier: 3,
    isBuiltIn: true,
    createdBy: 'system',
  },

  // 20. AI Governance Sandbox
  {
    id: 'ai-governance-sandbox',
    name: 'AI Governance Sandbox',
    description:
      'Agents govern an AI regulation framework. Bills specifically concern AI safety, bias audits, and autonomous systems. Domain-specific governance benchmark.',
    worldConfig: {} as WorldConfig,
    agentConfig: {} as AgentConfig,
    seedData: {},
    runLength: 150,
    metrics: {} as MetricsConfig,
    events: [],
    difficulty: 'medium',
    category: 'outcome',
    tier: 3,
    isBuiltIn: true,
    createdBy: 'system',
  },
];

/* ========================================================================
   Combine & Seed
   ======================================================================== */

const ALL_SCENARIOS: ScenarioSeed[] = [
  ...TIER_1_SCENARIOS,
  ...TIER_2_SCENARIOS,
  ...TIER_3_SCENARIOS,
];

async function seedBenchmarkScenarios() {
  console.log(`Seeding ${ALL_SCENARIOS.length} benchmark scenarios...`);

  for (const scenario of ALL_SCENARIOS) {
    await db
      .insert(benchmarkScenarios)
      .values(scenario)
      .onConflictDoUpdate({
        target: benchmarkScenarios.id,
        set: {
          name: scenario.name,
          description: scenario.description,
          worldConfig: scenario.worldConfig,
          agentConfig: scenario.agentConfig,
          seedData: scenario.seedData,
          runLength: scenario.runLength,
          metrics: scenario.metrics,
          events: scenario.events,
          difficulty: scenario.difficulty,
          category: scenario.category,
          tier: scenario.tier,
          isBuiltIn: scenario.isBuiltIn,
          updatedAt: new Date(),
        },
      });

    console.log(`  [${scenario.tier === 1 ? 'T1' : scenario.tier === 2 ? 'T2' : 'T3'}] ${scenario.id}`);
  }

  console.log(`\nDone. Seeded ${ALL_SCENARIOS.length} benchmark scenarios.`);
  await queryClient.end();
}

seedBenchmarkScenarios().catch((err) => {
  console.error('Seed failed:', err);
  queryClient.end();
  process.exit(1);
});
