/**
 * Runtime configuration — adjustable without server restart via admin panel.
 * All values start from constants.ts defaults and can be changed via admin API.
 */

import { config } from './config.js';

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
}

let current: RuntimeConfig = {
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
};

export function getRuntimeConfig(): Readonly<RuntimeConfig> {
  return current;
}

export function updateRuntimeConfig(partial: Partial<RuntimeConfig>): RuntimeConfig {
  current = { ...current, ...partial };
  return current;
}
