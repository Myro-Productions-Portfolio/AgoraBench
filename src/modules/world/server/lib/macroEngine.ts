// E5 macro engine orchestration (world-model Layer 1). Observe-only: reads
// laws + world_state + config, writes ONE world_state row per step. Never
// throws into the tick (worldFeedPoller contract). Nothing reads world_state
// in this slice.
import { db } from '@db/connection';
import { worldState, laws } from '@db/schema/index';
import { desc, eq, and, isNotNull } from 'drizzle-orm';
import { getRuntimeConfig } from '@core/server/runtimeConfig.js';
import {
  seedMacroState, stepMacro,
  type MacroState, type MacroParams, type FiscalImpulse,
} from '@core/server/lib/macroMath.js';

function paramsFromConfig(): MacroParams {
  const rc = getRuntimeConfig();
  return {
    macroRecessionHazardMonthly: rc.macroRecessionHazardMonthly,
    macroRecoveryHazardMonthly: rc.macroRecoveryHazardMonthly,
    macroGdpTrendExpansionPct: rc.macroGdpTrendExpansionPct,
    macroGdpTrendRecessionPct: rc.macroGdpTrendRecessionPct,
    macroGdpPhiQuarterly: rc.macroGdpPhiQuarterly,
    macroGdpShockSigmaPct: rc.macroGdpShockSigmaPct,
    macroOkunCoeff: rc.macroOkunCoeff,
    macroNaturalUnemploymentPct: rc.macroNaturalUnemploymentPct,
    macroUnemploymentFloorPct: rc.macroUnemploymentFloorPct,
    macroPhillipsSlopeNormal: rc.macroPhillipsSlopeNormal,
    macroPhillipsSlopeTight: rc.macroPhillipsSlopeTight,
    macroPhillipsTightThresholdPct: rc.macroPhillipsTightThresholdPct,
    macroInflationPhiQuarterly: rc.macroInflationPhiQuarterly,
    macroInflationAnchorPct: rc.macroInflationAnchorPct,
    macroMultiplierPurchases: rc.macroMultiplierPurchases,
    macroMultiplierTransfers: rc.macroMultiplierTransfers,
    macroMultiplierTax: rc.macroMultiplierTax,
    macroMultiplierRecessionScale: rc.macroMultiplierRecessionScale,
    macroSentimentAdjustSpeed: rc.macroSentimentAdjustSpeed,
  };
}

/** Fiscal stance from structured law columns (never LLM text).
    purchasesSince: one-time spends enacted after sinceTick (spend_once $).
    recurringAnnualized: current annualized recurring+mandatory total.
    taxDeltaSince: net signed tax-point changes enacted after sinceTick. */
async function readFiscalStance(sinceTick: number, ticksPerDay: number) {
  const rows = await db
    .select({
      fiscalKind: laws.fiscalKind,
      fiscalAmount: laws.fiscalAmount,
      fiscalTaxDelta: laws.fiscalTaxDelta,
      programActive: laws.programActive,
      enactedTick: laws.enactedTick,
    })
    .from(laws)
    .where(and(isNotNull(laws.fiscalKind), eq(laws.isActive, true)));
  let purchasesSince = 0, recurringAnnualized = 0, taxDeltaSince = 0;
  for (const r of rows) {
    if ((r.fiscalKind === 'spend_recurring' || r.fiscalKind === 'mandatory') && r.programActive) {
      recurringAnnualized += (r.fiscalAmount ?? 0) * ticksPerDay * 365;
    }
    if (r.fiscalKind === 'spend_once' && (r.enactedTick ?? 0) > sinceTick) {
      purchasesSince += r.fiscalAmount ?? 0;
    }
    if (r.fiscalKind === 'tax_change' && (r.enactedTick ?? 0) > sinceTick) {
      taxDeltaSince += r.fiscalTaxDelta ?? 0;
    }
  }
  return { purchasesSince, recurringAnnualized, taxDeltaSince };
}

export async function stepMacroEngine(
  tickNumber: number,
  tickId: string | null,
): Promise<{ seeded: boolean; state: MacroState } | null> {
  const rc = getRuntimeConfig();
  if (!rc.macroEngineEnabled) return null;
  try {
    const p = paramsFromConfig();
    const ticksPerDay = Math.max(1, Math.round(86_400_000 / rc.tickIntervalMs));
    const [prevRow] = await db
      .select()
      .from(worldState)
      .orderBy(desc(worldState.tickNumber))
      .limit(1);

    let state: MacroState;
    let seeded = false;
    let recurringNow: number;

    if (!prevRow) {
      state = seedMacroState(rc.gdpAnnual, rc.macroRngSeedInit, p);
      recurringNow = (await readFiscalStance(tickNumber, ticksPerDay)).recurringAnnualized;
      seeded = true;
    } else {
      const stance = await readFiscalStance(prevRow.tickNumber, ticksPerDay);
      recurringNow = stance.recurringAnnualized;
      const impulse: FiscalImpulse = {
        purchases: stance.purchasesSince,
        transfers: stance.recurringAnnualized - Number(prevRow.recurringStanceAnnualized ?? 0),
        tax: (stance.taxDeltaSince / 100) * Number(prevRow.gdpAnnualized),
      };
      const prev: MacroState = {
        regime: prevRow.regime as MacroState['regime'],
        gdpAnnualized: Number(prevRow.gdpAnnualized),
        gdpGrowthPct: prevRow.gdpGrowthPct,
        coreGrowthPct: prevRow.coreGrowthPct,
        unemploymentPct: prevRow.unemploymentPct,
        inflationPct: prevRow.inflationPct,
        sentiment: prevRow.sentiment,
        sentimentBase: prevRow.sentimentBase,
        policyPipeline: prevRow.policyPipeline as number[],
        dayInQuarter: prevRow.dayInQuarter,
        rngSeed: Number(prevRow.rngSeed),
      };
      state = stepMacro(prev, impulse, p);
    }

    await db.insert(worldState).values({
      tickId, tickNumber,
      rngSeed: state.rngSeed,
      regime: state.regime,
      gdpAnnualized: state.gdpAnnualized,
      gdpGrowthPct: state.gdpGrowthPct,
      coreGrowthPct: state.coreGrowthPct,
      unemploymentPct: state.unemploymentPct,
      inflationPct: state.inflationPct,
      sentiment: state.sentiment,
      sentimentBase: state.sentimentBase,
      fiscalImpulsePct: state.fiscalImpulsePct ?? 0,
      policyEffectPct: state.policyPipeline[0] ?? 0,
      policyPipeline: state.policyPipeline,
      dayInQuarter: state.dayInQuarter,
      recurringStanceAnnualized: recurringNow,
    });
    return { seeded, state };
  } catch (err) {
    console.warn('[macroEngine] step failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}
