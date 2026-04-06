/**
 * Runtime configuration — adjustable without server restart via admin panel.
 * Persisted to DB as JSONB. On startup, loads saved overrides from DB.
 * New config fields automatically get their defaults until explicitly set.
 */

import { config } from './config.js';
import { db } from '@db/connection';
import { runtimeConfigStore } from '@db/schema/index';
import { eq } from 'drizzle-orm';

export type ProviderOverride = 'default' | 'anthropic' | 'openai' | 'google' | 'huggingface' | 'ollama';

export interface RuntimeConfig {
  /* ---- Simulation ---- */
  tickIntervalMs: number;
  billAdvancementDelayMs: number;
  providerOverride: ProviderOverride;

  /* ---- Agent Behavior ---- */
  billProposalChance: number;        // 0.0 – 1.0
  campaignSpeechChance: number;      // 0.0 – 1.0
  amendmentProposalChance: number;   // 0.0 – 1.0

  /* ---- Government Structure ---- */
  congressSeats: number;
  congressTermDays: number;
  presidentTermDays: number;
  supremeCourtJustices: number;
  quorumPercentage: number;          // 0.0 – 1.0
  billPassagePercentage: number;     // 0.0 – 1.0
  supermajorityPercentage: number;   // 0.0 – 1.0

  /* ---- Elections ---- */
  campaignDurationDays: number;
  votingDurationHours: number;
  minReputationToRun: number;
  minReputationToVote: number;

  /* ---- Economy ---- */
  initialAgentBalance: number;
  campaignFilingFee: number;
  partyCreationFee: number;
  salaryPresident: number;
  salaryCabinet: number;
  salaryCongress: number;
  salaryJustice: number;

  /* ---- Governance Probabilities ---- */
  vetoBaseRate: number;              // 0.0 – 1.0
  vetoRatePerTier: number;           // 0.0 – 1.0
  vetoMaxRate: number;               // 0.0 – 1.0
  committeeTableRateOpposing: number;
  committeeTableRateNeutral: number;
  committeeAmendRate: number;
  judicialChallengeRatePerLaw: number;
  partyWhipFollowRate: number;
  vetoOverrideThreshold: number;

  /* ---- Guard Rails ---- */
  maxPromptLengthChars: number;       // default: 4000
  maxOutputLengthTokens: number;      // default: 500
  maxBillsPerAgentPerTick: number;    // default: 1
  maxCampaignSpeechesPerTick: number; // default: 1

  /* ---- Relationship Evolution ---- */
  relationshipDecayRate: number;            // per-tick decay toward neutral
  forumInteractionSentimentBonus: number;   // per forum reply between agents

  /* ---- Forum Routing ---- */
  forumBaseSilenceWeight: number;
  forumDecayHalfLifeTicks: number;
  forumSilencePressureThreshold: number;
  maxForumPostsPerAgentPerTick: number;
  maxForumPostsPerTick: number;
  maxForumRepliesPerTick: number;

  /* ---- Elections (Dynamic Weight) ---- */
  electionPostOutcomeCascade: boolean;

  /* ---- Judiciary (Dynamic Weight) ---- */
  judicialContestationBonus: number;
  judicialRecencyBonus: number;

  /* ---- Economy (Dynamic Weight) ---- */
  treasuryCrisisThreshold: number;          // fraction of seed that triggers crisis
  economyProposalMultiplierCrisis: number;  // bill proposal boost in fiscal crisis

  /* ---- AGGE (God Agent) ---- */
  aggeTickIntervalMs: number;
  aggeAgentsPerTickMin: number;
  aggeAgentsPerTickMax: number;
  aggeTemperature: number;
  aggeInferenceUrl: string;
  aggeInferenceModel: string;
  aggeEvolutionPressureWeighted: boolean;

  /* ---- Approval Feedback ---- */
  approvalDecayTarget: number;
  approvalInSystemPrompt: boolean;
}

const DEFAULTS: RuntimeConfig = {
  /* Simulation */
  tickIntervalMs: config.simulation.tickIntervalMs,
  billAdvancementDelayMs: 60_000,
  providerOverride: 'default',

  /* Agent Behavior */
  billProposalChance: 0.3,
  campaignSpeechChance: 0.2,
  amendmentProposalChance: 0.15,

  /* Government Structure */
  congressSeats: 50,
  congressTermDays: 60,
  presidentTermDays: 90,
  supremeCourtJustices: 7,
  quorumPercentage: 0.5,
  billPassagePercentage: 0.5,
  supermajorityPercentage: 0.67,

  /* Elections */
  campaignDurationDays: 14,
  votingDurationHours: 48,
  minReputationToRun: 100,
  minReputationToVote: 10,

  /* Economy */
  initialAgentBalance: 1000,
  campaignFilingFee: 50,
  partyCreationFee: 200,
  salaryPresident: 100,
  salaryCabinet: 75,
  salaryCongress: 50,
  salaryJustice: 60,

  /* Governance Probabilities */
  vetoBaseRate: 0.04,
  vetoRatePerTier: 0.20,
  vetoMaxRate: 0.75,
  committeeTableRateOpposing: 0.40,
  committeeTableRateNeutral: 0.10,
  committeeAmendRate: 0.30,
  judicialChallengeRatePerLaw: 0.03,
  partyWhipFollowRate: 0.78,
  vetoOverrideThreshold: 0.67,

  /* Guard Rails */
  maxPromptLengthChars: 4000,
  maxOutputLengthTokens: 500,
  maxBillsPerAgentPerTick: 1,
  maxCampaignSpeechesPerTick: 1,

  /* Relationship Evolution */
  relationshipDecayRate: 0.05,
  forumInteractionSentimentBonus: 0.02,

  /* Forum Routing */
  forumBaseSilenceWeight: 2.0,
  forumDecayHalfLifeTicks: 3,
  forumSilencePressureThreshold: 5,
  maxForumPostsPerAgentPerTick: 1,
  maxForumPostsPerTick: 3,
  maxForumRepliesPerTick: 5,

  /* Elections (Dynamic Weight) */
  electionPostOutcomeCascade: true,

  /* Judiciary (Dynamic Weight) */
  judicialContestationBonus: 1.8,
  judicialRecencyBonus: 1.5,

  /* Economy (Dynamic Weight) */
  treasuryCrisisThreshold: 0.20,
  economyProposalMultiplierCrisis: 1.4,

  /* AGGE */
  aggeTickIntervalMs: 3_600_000,
  aggeAgentsPerTickMin: 1,
  aggeAgentsPerTickMax: 3,
  aggeTemperature: 0.8,
  aggeInferenceUrl: '',
  aggeInferenceModel: '',
  aggeEvolutionPressureWeighted: true,

  /* Approval Feedback */
  approvalDecayTarget: 40,
  approvalInSystemPrompt: true,
};

let current: RuntimeConfig = { ...DEFAULTS };

export function getRuntimeConfig(): Readonly<RuntimeConfig> {
  return current;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const [row] = await db
      .select({ config: runtimeConfigStore.config })
      .from(runtimeConfigStore)
      .where(eq(runtimeConfigStore.id, 1))
      .limit(1);

    if (row?.config && typeof row.config === 'object') {
      // Merge DB overrides over defaults — new fields get defaults automatically
      current = { ...DEFAULTS, ...(row.config as Partial<RuntimeConfig>) };
      console.warn('[CONFIG] Loaded runtime config from database');
    } else {
      current = { ...DEFAULTS };
      console.warn('[CONFIG] No saved config found — using defaults');
    }
  } catch (err) {
    console.warn('[CONFIG] Failed to load config from DB — using defaults:', err);
    current = { ...DEFAULTS };
  }
  return current;
}

export async function updateRuntimeConfig(partial: Partial<RuntimeConfig>): Promise<RuntimeConfig> {
  current = { ...current, ...partial };

  // Persist to DB (fire-and-forget with error logging)
  try {
    await db
      .insert(runtimeConfigStore)
      .values({ id: 1, config: current as unknown as Record<string, unknown>, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: runtimeConfigStore.id,
        set: { config: current as unknown as Record<string, unknown>, updatedAt: new Date() },
      });
  } catch (err) {
    console.warn('[CONFIG] Failed to persist config to DB:', err);
  }

  return current;
}
