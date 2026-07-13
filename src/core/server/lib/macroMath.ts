// E5 world-model Layer 1 pure math (docs/specs/world-model.md §2).
// Every empirical constant carries its source; "judgment" marks in-house
// defaults with no single citable number. All stochastic draws come from the
// caller-provided seeded PRNG -- no Math.random(), no clock reads.

export type MacroRegime = 'expansion' | 'recession';

export interface MacroParams {
  macroRecessionHazardMonthly: number; macroRecoveryHazardMonthly: number;
  macroGdpTrendExpansionPct: number; macroGdpTrendRecessionPct: number;
  macroGdpPhiQuarterly: number; macroGdpShockSigmaPct: number;
  macroOkunCoeff: number; macroNaturalUnemploymentPct: number; macroUnemploymentFloorPct: number;
  macroPhillipsSlopeNormal: number; macroPhillipsSlopeTight: number; macroPhillipsTightThresholdPct: number;
  macroInflationPhiQuarterly: number; macroInflationAnchorPct: number;
  macroMultiplierPurchases: number; macroMultiplierTransfers: number; macroMultiplierTax: number;
  macroMultiplierRecessionScale: number; macroSentimentAdjustSpeed: number;
}

export interface FiscalImpulse { purchases: number; transfers: number; tax: number }

export interface MacroState {
  regime: MacroRegime;
  gdpAnnualized: number;
  gdpGrowthPct: number;   // core + policy overlay (what Okun and observers see)
  coreGrowthPct: number;  // AR(1) trend/shock component only -- policy NEVER enters here
  unemploymentPct: number;
  inflationPct: number;
  sentiment: number;
  sentimentBase: number;
  policyPipeline: number[];
  dayInQuarter: number;
  rngSeed: number;
  fiscalImpulsePct?: number;
}

export const DAYS_PER_QUARTER = 90;

// Shape informed by Auerbach & Gorodnichenko (2012 AEJ:EP 4(2), Fig.2/Table 1)
// and Ramey (2019 JEP 33(2), Fig.1): normal conditions = hump peaking ~q4,
// ~zero by q12 (deliberate truncation; true IRFs run 16-20q). Recession =
// flatter, back-loaded (A&G's recession IRF is still rising at q20).
// The numeric weights are fitted in-house -- do not attribute them to the papers.
export const LAG_WEIGHTS_NORMAL: readonly number[] =
  [0.03, 0.08, 0.13, 0.16, 0.15, 0.13, 0.10, 0.08, 0.06, 0.04, 0.03, 0.01];
export const LAG_WEIGHTS_RECESSION: readonly number[] =
  [0.02, 0.05, 0.08, 0.10, 0.11, 0.11, 0.11, 0.10, 0.10, 0.09, 0.08, 0.05];

// T0 vector, world-model.md §4 (July 2026, sourced there):
const T0_UNEMPLOYMENT_PCT = 4.2;
const T0_INFLATION_PCT = 4.2;
const T0_SENTIMENT = 44.8;   // UMich UMCSENT, May 2026
// Sentiment-target coefficients (index points per pp of gap) -- judgment:
// UMich-style regressions weigh inflation ~2x unemployment.
const SENT_INFLATION_COEFF = 8;
const SENT_UNEMPLOYMENT_COEFF = 4;

export function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

export function nextSeed(seed: number): number {
  const rng = splitmix32(seed ^ 0x5bf03635);
  return Math.floor(rng() * 2_147_483_646) + 1;
}

export function normalDraw(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function dailyHazard(pMonthly: number): number {
  return 1 - Math.pow(1 - pMonthly, 1 / 30);
}

export function dailyPhi(phiQuarterly: number): number {
  return Math.pow(phiQuarterly, 1 / DAYS_PER_QUARTER);
}

function trendFor(regime: MacroRegime, p: MacroParams): number {
  return regime === 'expansion' ? p.macroGdpTrendExpansionPct : p.macroGdpTrendRecessionPct;
}

/** Sentiment base self-calibrates so the T0 state is a fixed point of the
    sentiment dynamics (the 2026 "gloom residual" folds into the base --
    otherwise seeding at 44.8 with a formula-implied target would fabricate
    a recovery drift the data doesn't support). */
export function seedMacroState(gdpAnnual: number, seed: number, p: MacroParams): MacroState {
  const base = T0_SENTIMENT
    + SENT_INFLATION_COEFF * (T0_INFLATION_PCT - p.macroInflationAnchorPct)
    + SENT_UNEMPLOYMENT_COEFF * (T0_UNEMPLOYMENT_PCT - p.macroNaturalUnemploymentPct);
  return {
    regime: 'expansion',
    gdpAnnualized: gdpAnnual,
    gdpGrowthPct: p.macroGdpTrendExpansionPct,
    coreGrowthPct: p.macroGdpTrendExpansionPct,
    unemploymentPct: T0_UNEMPLOYMENT_PCT,
    inflationPct: T0_INFLATION_PCT,
    sentiment: T0_SENTIMENT,
    sentimentBase: base,
    policyPipeline: new Array(12).fill(0),
    dayInQuarter: 0,
    rngSeed: seed,
  };
}

export function stepMacro(prev: MacroState, impulse: FiscalImpulse, p: MacroParams): MacroState {
  const rng = splitmix32(prev.rngSeed);

  // 1. regime transition (spec §2.1)
  const hazard = prev.regime === 'expansion'
    ? dailyHazard(p.macroRecessionHazardMonthly)
    : dailyHazard(p.macroRecoveryHazardMonthly);
  const regime: MacroRegime = rng() < hazard
    ? (prev.regime === 'expansion' ? 'recession' : 'expansion')
    : prev.regime;

  // 2. policy pipeline (spec §2.5): $ level-effect impulses distributed over
  //    12 quarters; bucket q holds the annualized growth addition applied
  //    during that quarter. Integrating bucket*(90/365)/100 over the 12
  //    buckets recovers the full multiplier*X/GDP level effect.
  const spendScale = regime === 'recession' ? p.macroMultiplierRecessionScale : 1;
  const weights = regime === 'recession' ? LAG_WEIGHTS_RECESSION : LAG_WEIGHTS_NORMAL;
  const levelEffect =
    p.macroMultiplierPurchases * spendScale * impulse.purchases +
    p.macroMultiplierTransfers * spendScale * impulse.transfers -
    p.macroMultiplierTax * impulse.tax;   // tax mult flat: state-dependence runs opposite (Ramey 2019)
  const impulsePct = (levelEffect / prev.gdpAnnualized) * 100;
  const pipeline = prev.policyPipeline.slice();
  if (impulsePct !== 0) {
    const annualize = 365 / DAYS_PER_QUARTER;
    for (let q = 0; q < 12; q++) pipeline[q] += impulsePct * weights[q] * annualize;
  }

  // 3. GDP growth (spec §2.2, one deliberate correction): the spec's literal
  //    equation feeds policy_t through the AR(1), which would amplify a
  //    sustained input by ~1/(1-phi_daily) (~86x) -- but CBO multipliers are
  //    TOTAL effects and the lag weights already encode the full time path.
  //    So the AR(1) runs on a policy-free core, and policy is an additive
  //    overlay: cumulative level gain = multiplier * X / GDP exactly.
  const phiD = dailyPhi(p.macroGdpPhiQuarterly);
  const gStar = trendFor(regime, p);
  const shock = p.macroGdpShockSigmaPct > 0 ? normalDraw(rng) * p.macroGdpShockSigmaPct : 0;
  const core = (1 - phiD) * gStar + phiD * prev.coreGrowthPct + shock;
  const growth = core + pipeline[0];
  const gdp = Math.round(prev.gdpAnnualized * Math.pow(1 + growth / 100, 1 / 365));

  // 4. unemployment (spec §2.3): Okun growth-gap form; hysteresis = level accumulation
  const du = -p.macroOkunCoeff * (growth - gStar) / 365;
  const unemployment = Math.max(p.macroUnemploymentFloorPct, prev.unemploymentPct + du);

  // 5. inflation (spec §2.4): AR(1) toward anchor + state-dependent Phillips on the u-gap
  const slope = unemployment < p.macroPhillipsTightThresholdPct
    ? p.macroPhillipsSlopeTight : p.macroPhillipsSlopeNormal;
  const phiPiD = dailyPhi(p.macroInflationPhiQuarterly);
  const inflation = prev.inflationPct
    + (1 - phiPiD) * (p.macroInflationAnchorPct - prev.inflationPct)
    + slope * (p.macroNaturalUnemploymentPct - unemployment) / DAYS_PER_QUARTER;

  // 6. sentiment (spec §2.7): partial adjustment toward the state-driven target
  const target = prev.sentimentBase
    - SENT_INFLATION_COEFF * (inflation - p.macroInflationAnchorPct)
    - SENT_UNEMPLOYMENT_COEFF * (unemployment - p.macroNaturalUnemploymentPct);
  const sentiment = prev.sentiment + p.macroSentimentAdjustSpeed * (target - prev.sentiment);

  // 7. advance the quarter window
  let dayInQuarter = prev.dayInQuarter + 1;
  let outPipeline = pipeline;
  if (dayInQuarter >= DAYS_PER_QUARTER) {
    dayInQuarter = 0;
    outPipeline = [...pipeline.slice(1), 0];
  }

  return {
    regime, gdpAnnualized: gdp, gdpGrowthPct: growth, coreGrowthPct: core,
    unemploymentPct: unemployment, inflationPct: inflation,
    sentiment, sentimentBase: prev.sentimentBase,
    policyPipeline: outPipeline, dayInQuarter,
    rngSeed: nextSeed(prev.rngSeed),
    fiscalImpulsePct: impulsePct,
  };
}
