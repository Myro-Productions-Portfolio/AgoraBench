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
  campaignFilingFee: number;             // charged at candidacy filing
  partyCreationFee: number;              // charged at party creation
  salaryPresident: number;               // annual $ (paid annual/26 every payPeriodTicks)
  salaryCabinet: number;                 // annual $
  salaryCongress: number;                // annual $
  salaryJustice: number;                 // annual $
  payPeriodTicks: number;                // ticks between paydays (7-28); 1 tick = 1 sim day
  gdpAnnual: number;                     // annual GDP in $ — citizen tax base
  agoraPopulation: number;               // citizen count (display/flavor + wiki)

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
  maxFloorBillsPerTick: number;       // default: 5 — caps the floor working set (phases 1, 1.5, 1.7, 2)

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

  /* ---- Simulation Inference ---- */
  simInferenceUrl: string;
  simInferenceModel: string;

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

  /* ---- Lobbying ---- */
  lobbyingEnabled: boolean;
  maxLobbyistsPerTick: number;
  lobbyingPositionShiftChance: number;

  /* ---- Floor Amendments ---- */
  floorAmendmentsEnabled: boolean;
  maxAmendmentsPerBillPerTick: number;

  /* ---- Committees ---- */
  committeeMarkupEnabled: boolean;   // Phase 3 markup: scoped amendment + member ratification (false = legacy full-text amend)

  /* ---- Bill Withdrawal ---- */
  billWithdrawalEnabled: boolean;

  /* ---- Public Statements ---- */
  publicStatementsEnabled: boolean;
  proactiveStatementChance: number;
  maxStatementsPerAgentPerTick: number;

  /* ---- Daily Gazette ---- */
  gazetteEnabled: boolean;           // one LLM recap of the tick, failure-soft

  /* ---- Vote-Pact Deals ---- */
  dealParsingEnabled: boolean;       // parse optional 'deal' field from Phase 1.5 lobbying output
  maxDealsPerTick: number;           // cap on agentDeals inserts per tick (1-10)

  /* ---- Fiscal Policy (Phase 3) ---- */
  fiscalEffectsEnabled: boolean;             // kill switch: provisions stored but never applied when false
  budgetCycleTicks: number;                  // ticks per budget cycle (4-200); 24 = 36h at 90-min ticks
  fiscalMaxOneTimePctOfTreasury: number;     // spend_once cap as % of current treasury (1-20)
  fiscalMaxProgramPctOfRevenue: number;      // per-program per-tick cap as % of expected tick revenue (1-50)
  fiscalRecurringCapPctOfRevenue: number;    // aggregate recurring-spend cap as % of expected tick revenue (10-100)
  fiscalMaxTaxDeltaPerLaw: number;           // max whole percentage points a revenue law can move the tax rate (1-5)
  taxRateMinPercent: number;                 // hard floor for the tax rate (0-40)
  taxRateMaxPercent: number;                 // hard ceiling for the tax rate (5-60); must exceed taxRateMinPercent
  maxSunsetTicks: number;                    // longest allowed sunset clause in ticks (10-1000)
  treasuryHardFloor: number;                 // program debits suspend below this (may be negative; -10T-0)

  /* ---- Judicial (Phase 4) ---- */
  courtEnabled: boolean;                     // kill switch: Phase 10 freezes (no mutations) when false
  courtMaxConcurrentCases: number;           // active-docket cap, gates FILING only (1-10)
  courtMaxNewCasesPerTick: number;           // total new filings per tick, both sources (1-5)
  courtHearingDelayTicks: number;            // ticks between docketing and oral argument (1-4)
  courtDisputeChancePerBrokenDeal: number;   // 0.0 - 1.0 roll per broken deal
  courtJusticeQuestionsPerHearing: number;   // LLM justice questions per hearing (0-4)
  courtDamagesAmount: number;                // $ transferred loser -> winner in disputes (0-10M)

  /* ---- Debt Engine (Divergence E1 slice 1) ---- */
  debtEngineEnabled: boolean;                // kill switch: mandatory debits, interest, settlement all no-op when false (deploy dark)
  mandatoryGrowthPctAnnual: number;          // daily-compounding annual growth on mandatory programs (0-15)
  debtInterestRatePct: number;               // annual rate accrued daily on debtOutstanding (0-15)
  treasuryOperatingBufferDollars: number;    // surplus above this retires debt automatically (0-1e13)
  fiscalMaxMandatoryDeltaPct: number;        // max % an amendment may move a mandatory law's base amount (1-25)
  debtCrisisRatioPct: number;                // debt/GDP % that trips the debt-based crisis condition (50-500)
  divergenceT0Tick: number;                  // tick number of the T0 baseline seed (>= 0; 0 = unset)
  divergenceT0Date: string;                  // ISO date string anchoring T0 (real-date <-> tick-date mapping); '' = unset

  /* ---- World Events Feed (E2 slice 1) — deployed dark, read-only ---- */
  worldFeedEnabled: boolean;                 // master kill switch: no polling at all when false (deploy dark)
  worldFeedPollTicks: number;                // poll cadence in ticks (1-48)
  worldFeedUsgsEnabled: boolean;              // per-source flag, only matters once worldFeedEnabled is true
  worldFeedNwsEnabled: boolean;               // per-source flag, only matters once worldFeedEnabled is true
  worldFeedFemaEnabled: boolean;              // per-source flag, only matters once worldFeedEnabled is true
  worldFeedGdeltEnabled: boolean;             // reserved: no adapter yet (Tier 2), always a no-op today

  /* ---- Fiscal Consequence Loop — deployed dark, zero-effect defaults ---- */
  fiscalConsequenceEnabled: boolean;         // master kill switch: fiscal->approval phase is a no-op when false (deploy dark)
  fiscalApprovalDebtWeight: number;          // debt/GDP -> approval strength (0-50)
  fiscalApprovalTreasuryWeight: number;      // treasury depletion -> approval strength (0-50)
  fiscalApprovalDeficitWeight: number;       // deficit -> approval strength (0-50)
  fiscalApprovalTaxWeight: number;           // tax burden -> approval strength (0-50)
  fiscalConsequencePartyWeight: number;      // party/constituency weighting (0 = blind .. 1)
  fiscalApprovalMaxDeltaPerTick: number;     // clamp on total fiscal approval move per tick (1-20)
  fiscalApprovalDebtHealthBand: number;      // debt/GDP ratio where drag begins (1.0 = mild drag from 100%)
  fiscalApprovalDebtCrisisBand: number;      // debt/GDP ratio treated as full crisis (signal saturates to -1)
  fiscalApprovalDeficitCrisisRatio: number;  // deficit/revenue share at which the deficit signal saturates to -1
  ballotFiscalRecordEnabled: boolean;        // show each candidate's tenure fiscal record on ballots (deploy dark)
  taxElasticityStrength: number;             // 0 = linear revenue (today); 1 = full Laffer response
  taxNeutralRatePercent: number;             // tax rate below which elasticity ~inert AND tax-burden signal is neutral (0-40)
  taxRevenuePeakPercent: number;             // tax rate of max revenue on the elastic curve (20-60)

  /* ---- Office-Selection Fidelity — deployed dark, off by default ---- */
  speakerElectionEnabled: boolean;           // Slice 2: Legislature elects its own Speaker by internal roll-call. Off = no speaker seat exists (byte-identical to today).
  speakerReballotCap: number;                // re-ballots per tick before a deadlocked Speaker race carries to the next tick (1-10)
  appointmentConfirmationEnabled: boolean;   // Slice 3: justices + cabinet filled by president-nominate → Legislature-confirm. Off = today's reputation-rank justice auto-fill, no cabinet.
  appointmentConfirmationThreshold: number;  // confirmation vote pass threshold, share of weighted alignment (0-1; 0.5 = simple majority)
  electoralCollegeEnabled: boolean;          // Slice 4: president tallied per-state → Electoral College (270 to win). Off = today's single honest national popular-vote count.
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
  initialAgentBalance: 25_000,
  campaignFilingFee: 2_500,
  partyCreationFee: 10_000,
  salaryPresident: 400_000,
  salaryCabinet: 253_100,
  salaryCongress: 174_000,
  salaryJustice: 306_600,
  payPeriodTicks: 14,
  gdpAnnual: 28_000_000_000_000,
  agoraPopulation: 330_000_000,

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
  maxFloorBillsPerTick: 5,

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

  /* Simulation Inference */
  simInferenceUrl: '',
  simInferenceModel: '',

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

  /* Lobbying */
  lobbyingEnabled: true,
  maxLobbyistsPerTick: 3,
  lobbyingPositionShiftChance: 0.35,

  /* Floor Amendments */
  floorAmendmentsEnabled: true,
  maxAmendmentsPerBillPerTick: 2,

  /* Committees */
  committeeMarkupEnabled: true,

  /* Bill Withdrawal */
  billWithdrawalEnabled: true,

  /* Public Statements */
  publicStatementsEnabled: true,
  proactiveStatementChance: 0.05,
  maxStatementsPerAgentPerTick: 1,

  /* Daily Gazette */
  gazetteEnabled: true,

  /* Vote-Pact Deals */
  dealParsingEnabled: true,
  maxDealsPerTick: 3,

  /* Fiscal Policy (Phase 3) */
  fiscalEffectsEnabled: true,
  budgetCycleTicks: 24,
  fiscalMaxOneTimePctOfTreasury: 5,
  fiscalMaxProgramPctOfRevenue: 10,
  fiscalRecurringCapPctOfRevenue: 50,
  fiscalMaxTaxDeltaPerLaw: 2,
  taxRateMinPercent: 10,
  taxRateMaxPercent: 40,
  maxSunsetTicks: 200,
  treasuryHardFloor: -2_000_000_000_000,

  /* Judicial (Phase 4) */
  courtEnabled: true,
  courtMaxConcurrentCases: 2,
  courtMaxNewCasesPerTick: 1,
  courtHearingDelayTicks: 2,
  courtDisputeChancePerBrokenDeal: 0.25,
  courtJusticeQuestionsPerHearing: 2,
  courtDamagesAmount: 25_000,

  /* Debt Engine (Divergence E1 slice 1) — deployed dark */
  debtEngineEnabled: false,
  mandatoryGrowthPctAnnual: 5,
  debtInterestRatePct: 2.7,
  treasuryOperatingBufferDollars: 1_500_000_000_000,
  fiscalMaxMandatoryDeltaPct: 10,
  debtCrisisRatioPct: 150,
  divergenceT0Tick: 0,
  divergenceT0Date: '',

  /* World Events Feed (E2 slice 1) — deployed dark, read-only */
  worldFeedEnabled: false,
  worldFeedPollTicks: 1,
  worldFeedUsgsEnabled: true,
  worldFeedNwsEnabled: true,
  worldFeedFemaEnabled: true,
  worldFeedGdeltEnabled: false,

  /* Fiscal Consequence Loop — deployed dark, zero-effect defaults */
  fiscalConsequenceEnabled: false,
  fiscalApprovalDebtWeight: 0,
  fiscalApprovalTreasuryWeight: 0,
  fiscalApprovalDeficitWeight: 0,
  fiscalApprovalTaxWeight: 0,
  fiscalConsequencePartyWeight: 0,
  fiscalApprovalMaxDeltaPerTick: 5,
  fiscalApprovalDebtHealthBand: 1.0,
  fiscalApprovalDebtCrisisBand: 2.0,
  fiscalApprovalDeficitCrisisRatio: 0.5,
  ballotFiscalRecordEnabled: false,
  taxElasticityStrength: 0,
  taxNeutralRatePercent: 19,
  taxRevenuePeakPercent: 45,

  /* Office-Selection Fidelity — deployed dark, off by default */
  speakerElectionEnabled: false,
  speakerReballotCap: 3,
  appointmentConfirmationEnabled: false,
  appointmentConfirmationThreshold: 0.5,
  electoralCollegeEnabled: false,
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
