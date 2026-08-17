/**
 * Capitol City driver (docs/specs/city-effect-layer.md §3): declarative mapping
 * from live government/macro state to engine knobs. computeCityKnobs() is pure;
 * gatherCityDriverInputs() is the thin one-read-per-source DB wrapper.
 *
 * One-way by doctrine: nothing computed here or inside the engine ever flows
 * back into approval, elections, macro state, or agent prompts.
 */

import { desc, inArray } from 'drizzle-orm';
import { db } from '@db/connection';
import { governmentSettings, laws, worldState } from '@db/schema/index';
import { getRuntimeConfig } from '@core/server/runtimeConfig.js';
import { isFiscallyActive } from '@modules/government/server/lib/divergenceMath.js';
import { SEED_LAWS, SEED_TAX_RATE_PERCENT } from '@core/server/lib/divergenceSeed.js';
import type { CityKnobs, ExternalDemand } from '../../engine/types';

/* Program names matched EXACTLY against laws.fiscal_program_name. Fuzzy /
   agent-created program names (e.g. a new "Highway Modernization Fund") are
   Phase 2 — this slice only tracks the two T0 baseline appropriations. */
export const PUBLIC_SAFETY_PROGRAM = 'Justice & Public Safety';
export const TRANSPORT_PROGRAM = 'Transportation & Infrastructure';

function seedBaselineDaily(programName: string): number {
  const row = SEED_LAWS.find((l) => l.programName === programName);
  if (!row) throw new Error(`No SEED_LAWS row for program "${programName}"`);
  return row.amountPerDay;
}

/* T0 baseline daily amounts, derived from SEED_LAWS (divergenceSeed.ts, the
   verified FY2025 CBO/Treasury reconciliation) rather than mirrored, so a seed
   change can never drift: Justice & Public Safety $445M/day, Transportation &
   Infrastructure $450M/day. */
export const PUBLIC_SAFETY_BASELINE_DAILY = seedBaselineDaily(PUBLIC_SAFETY_PROGRAM);
export const TRANSPORT_BASELINE_DAILY = seedBaselineDaily(TRANSPORT_PROGRAM);

/* Engine tax range (0-20, ENGINE-NOTES.md). The sim range
   [taxRateMinPercent..taxRateMaxPercent] maps linearly onto it: a direct clamp
   would saturate at 20 forever (sim tax is currently 34), killing the signal
   across the sim's whole range. */
export const ENGINE_TAX_MAX = 20;

/* Valve-offset anchors and gains (native ranges ±2000 res / ±1500 com+ind).
   Neutral anchors = the macro engine's defaults (trend growth 2.25%/yr,
   u* ≈ 5.0%); gains sized so a ±3pp gap produces a ±600 offset — clearly
   visible against the range without pinning the valve. */
export const NEUTRAL_GDP_GROWTH_PCT = 2.25;
export const NEUTRAL_UNEMPLOYMENT_PCT = 5.0;
export const K_GROWTH_VALVE = 200; // com + ind offset per pp of growth gap
export const K_UNEMP_VALVE = 200;  // res offset per pp of unemployment below neutral

export interface CityDriverInputs {
  taxRatePercent: number;
  taxRateMinPercent: number;
  taxRateMaxPercent: number;
  /** SUM(fiscalAmount) over fiscally active laws with the exact program name, $/day. */
  publicSafetyDailySpend: number;
  transportDailySpend: number;
  gdpGrowthPct: number;
  unemploymentPct: number;
}

export interface CityDriverOutputs {
  knobs: Required<CityKnobs>;
  externalDemand: ExternalDemand;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeCityKnobs(inputs: CityDriverInputs): CityDriverOutputs {
  const span = inputs.taxRateMaxPercent - inputs.taxRateMinPercent;
  const taxRate = span > 0
    ? clamp(
        Math.round(((inputs.taxRatePercent - inputs.taxRateMinPercent) / span) * ENGINE_TAX_MAX),
        0,
        ENGINE_TAX_MAX,
      )
    : clamp(Math.round(inputs.taxRatePercent), 0, ENGINE_TAX_MAX);

  const safetyFunding = clamp(inputs.publicSafetyDailySpend / PUBLIC_SAFETY_BASELINE_DAILY, 0, 1);
  const roadFunding = clamp(inputs.transportDailySpend / TRANSPORT_BASELINE_DAILY, 0, 1);

  const growthGap = inputs.gdpGrowthPct - NEUTRAL_GDP_GROWTH_PCT;
  const ci = Math.round(K_GROWTH_VALVE * growthGap);
  const r = Math.round(K_UNEMP_VALVE * (NEUTRAL_UNEMPLOYMENT_PCT - inputs.unemploymentPct));

  return {
    knobs: {
      taxRate,
      roadFunding,
      fireFunding: safetyFunding,
      policeFunding: safetyFunding,
      /* Spec §3: disasters arrive in Phase 2 from world-model Layer 2 events,
         never from the engine's own random rolls. */
      disastersEnabled: false,
    },
    externalDemand: { r, c: ci, i: ci },
  };
}

export interface GatheredCityInputs extends CityDriverInputs {
  /** For the tick log line only — the mapping consumes growth + unemployment. */
  regime: string;
}

export async function gatherCityDriverInputs(): Promise<GatheredCityInputs> {
  const rc = getRuntimeConfig();

  const [gov] = await db
    .select({ taxRatePercent: governmentSettings.taxRatePercent })
    .from(governmentSettings)
    .limit(1);

  const spendRows = await db
    .select({
      fiscalProgramName: laws.fiscalProgramName,
      fiscalAmount: laws.fiscalAmount,
      isActive: laws.isActive,
      fiscalKind: laws.fiscalKind,
      programActive: laws.programActive,
    })
    .from(laws)
    .where(inArray(laws.fiscalProgramName, [PUBLIC_SAFETY_PROGRAM, TRANSPORT_PROGRAM]));

  const [macro] = await db
    .select({
      regime: worldState.regime,
      gdpGrowthPct: worldState.gdpGrowthPct,
      unemploymentPct: worldState.unemploymentPct,
    })
    .from(worldState)
    .orderBy(desc(worldState.tickNumber))
    .limit(1);

  let publicSafetyDailySpend = 0;
  let transportDailySpend = 0;
  for (const row of spendRows) {
    if (!isFiscallyActive(row)) continue;
    if (row.fiscalProgramName === PUBLIC_SAFETY_PROGRAM) publicSafetyDailySpend += row.fiscalAmount ?? 0;
    else transportDailySpend += row.fiscalAmount ?? 0;
  }

  return {
    taxRatePercent: gov?.taxRatePercent ?? SEED_TAX_RATE_PERCENT,
    taxRateMinPercent: rc.taxRateMinPercent,
    taxRateMaxPercent: rc.taxRateMaxPercent,
    publicSafetyDailySpend,
    transportDailySpend,
    /* No world_state row yet (macro dark) -> neutral anchors: the city must
       work with macroEngineEnabled=false. */
    gdpGrowthPct: macro?.gdpGrowthPct ?? NEUTRAL_GDP_GROWTH_PCT,
    unemploymentPct: macro?.unemploymentPct ?? NEUTRAL_UNEMPLOYMENT_PCT,
    regime: macro?.regime ?? 'expansion',
  };
}
