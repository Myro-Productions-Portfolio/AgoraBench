import { describe, it, expect, vi, beforeEach } from 'vitest';

/* stepMacroEngine couples DB reads (world_state latest row, laws), runtime
   config, and macroMath's pure step/seed functions. Mirrors the chainable-
   thenable db mock from worldFeedSweep.test.ts / worldEventsContext.test.ts:
   every chain method returns the same object; awaiting it resolves via a
   FIFO of queryResults (select #1 = world_state latest, select #2 = laws).
   insert().values() is captured separately so assertions can inspect what
   would have been written without a real DB. Module-level `let`s dodge the
   vi.mock hoist TDZ; vi.resetModules() + dynamic import gives each test a
   clean module (no cross-test state bleed from imports). */

let rc: Record<string, unknown>;
let queryResults: unknown[][];
let queryError: Error | null;
let insertedValues: Record<string, unknown> | null;
let selectCalls: number;
let insertCalls: number;

vi.mock('@core/server/runtimeConfig.js', () => ({
  getRuntimeConfig: () => rc,
}));

vi.mock('@db/connection', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'from', 'where', 'orderBy', 'limit']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.select = vi.fn(() => {
    selectCalls++;
    return chain;
  });
  chain.insert = vi.fn(() => {
    insertCalls++;
    return chain;
  });
  chain.values = vi.fn((v: Record<string, unknown>) => {
    insertedValues = v;
    return chain;
  });
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
    if (queryError) return Promise.reject(queryError).then(resolve, reject);
    const next = queryResults.shift() ?? [];
    return Promise.resolve(next).then(resolve, reject);
  };
  return { db: chain };
});

const P = {
  macroRecessionHazardMonthly: 0.0156, macroRecoveryHazardMonthly: 0.0971,
  macroGdpTrendExpansionPct: 2.25, macroGdpTrendRecessionPct: -2.0,
  macroGdpPhiQuarterly: 0.35, macroGdpShockSigmaPct: 0.15,
  macroOkunCoeff: 0.45, macroNaturalUnemploymentPct: 4.4, macroUnemploymentFloorPct: 2.0,
  macroPhillipsSlopeNormal: 0.18, macroPhillipsSlopeTight: 1.1, macroPhillipsTightThresholdPct: 4.0,
  macroInflationPhiQuarterly: 0.6, macroInflationAnchorPct: 2.0,
  macroMultiplierPurchases: 1.5, macroMultiplierTransfers: 0.9, macroMultiplierTax: 0.7,
  macroMultiplierRecessionScale: 1.6, macroSentimentAdjustSpeed: 0.05,
};

function baseRc(overrides: Record<string, unknown> = {}) {
  return {
    macroEngineEnabled: true,
    macroRngSeedInit: 20260713,
    gdpAnnual: 28_000_000_000_000,
    tickIntervalMs: 90 * 60 * 1000,
    ...P,
    ...overrides,
  };
}

function priorRow(overrides: Record<string, unknown> = {}) {
  return {
    tickNumber: 100,
    rngSeed: 42,
    regime: 'expansion',
    gdpAnnualized: 28_000_000_000_000,
    gdpGrowthPct: 2.25,
    coreGrowthPct: 2.25,
    unemploymentPct: 4.2,
    inflationPct: 4.2,
    sentiment: 44.8,
    sentimentBase: 44.8,
    policyPipeline: new Array(12).fill(0),
    dayInQuarter: 5,
    recurringStanceAnnualized: 0,
    ...overrides,
  };
}

async function loadEngine() {
  vi.resetModules();
  return import('@modules/world/server/lib/macroEngine');
}

beforeEach(() => {
  rc = baseRc();
  queryResults = [];
  queryError = null;
  insertedValues = null;
  selectCalls = 0;
  insertCalls = 0;
});

describe('stepMacroEngine', () => {
  it('returns null and makes zero db calls when disabled', async () => {
    rc.macroEngineEnabled = false;
    const { stepMacroEngine } = await loadEngine();
    expect(await stepMacroEngine(101, 'tick-101')).toBeNull();
    expect(selectCalls).toBe(0);
    expect(insertCalls).toBe(0);
  });

  it('seeds T0 when no prior row exists', async () => {
    queryResults = [[], []]; // no prior world_state row, no laws
    const { stepMacroEngine } = await loadEngine();
    const result = await stepMacroEngine(1, 'tick-1');
    expect(result).not.toBeNull();
    expect(result!.seeded).toBe(true);
    expect(result!.state.unemploymentPct).toBeCloseTo(4.2, 5);
    expect(result!.state.policyPipeline).toEqual(new Array(12).fill(0));
    expect(insertCalls).toBe(1);
  });

  it('seeds T0 with fiscalImpulsePct=0 and recurringStanceAnnualized from mocked laws', async () => {
    const recurringLaw = {
      fiscalKind: 'spend_recurring',
      fiscalAmount: 2_000_000,
      fiscalTaxDelta: null,
      programActive: true,
      isActive: true,
      enactedTick: 0,
    };
    const ticksPerDay = Math.max(1, Math.round(86_400_000 / (baseRc().tickIntervalMs as number)));
    const expectedRecurring = 2_000_000 * ticksPerDay * 365;
    queryResults = [[], [recurringLaw]]; // no prior world_state row, one recurring law
    const { stepMacroEngine } = await loadEngine();
    const result = await stepMacroEngine(1, 'tick-1');
    expect(result).not.toBeNull();
    expect(insertedValues).not.toBeNull();
    expect(insertedValues!.fiscalImpulsePct as number).toBe(0);
    expect(insertedValues!.recurringStanceAnnualized as number).toBe(expectedRecurring);
  });

  it('steps from a prior row, advancing rngSeed', async () => {
    const prior = priorRow();
    queryResults = [[prior], []]; // prior row, no active laws
    const { stepMacroEngine } = await loadEngine();
    const result = await stepMacroEngine(101, 'tick-101');
    expect(result).not.toBeNull();
    expect(result!.seeded).toBe(false);
    expect(result!.state.rngSeed).not.toBe(prior.rngSeed);
    expect(insertCalls).toBe(1);
  });

  it('computes a positive fiscal impulse from a newly active recurring program', async () => {
    const prior = priorRow({ recurringStanceAnnualized: 0 });
    const activeLaw = {
      fiscalKind: 'spend_recurring',
      fiscalAmount: 1_000_000,
      fiscalTaxDelta: null,
      programActive: true,
      isActive: true,
      enactedTick: 50,
    };
    queryResults = [[prior], [activeLaw]];
    const { stepMacroEngine } = await loadEngine();
    const result = await stepMacroEngine(101, 'tick-101');
    expect(result).not.toBeNull();
    expect(insertedValues).not.toBeNull();
    expect(insertedValues!.fiscalImpulsePct as number).toBeGreaterThan(0);
  });

  it('counts a struck one-shot enacted inside the window (survives Phase 10 strike-down)', async () => {
    const prior = priorRow({ recurringStanceAnnualized: 0 });
    const struckLaw = {
      fiscalKind: 'spend_once',
      fiscalAmount: 50_000_000_000,
      fiscalTaxDelta: null,
      programActive: false,
      isActive: false,
      enactedTick: 101,
    };
    queryResults = [[prior], [struckLaw]];
    const { stepMacroEngine } = await loadEngine();
    const result = await stepMacroEngine(150, 'tick-150');
    expect(result).not.toBeNull();
    expect(insertedValues).not.toBeNull();
    expect(insertedValues!.fiscalImpulsePct as number).toBeGreaterThan(0);
  });

  it('never throws: returns null on db error', async () => {
    queryError = new Error('connection refused');
    const { stepMacroEngine } = await loadEngine();
    await expect(stepMacroEngine(1, 'tick-1')).resolves.toBeNull();
  });
});
