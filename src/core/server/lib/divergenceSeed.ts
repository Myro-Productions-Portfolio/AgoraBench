/**
 * Divergence experiment — T0 baseline seed manifest + pure math.
 *
 * Slice 2 of docs/DIVERGENCE_EXPERIMENT.md §2.2 / §3. Extracted from
 * scripts/seed-divergence-baseline.ts so the seed figures and the
 * expected-deficit arithmetic are unit-testable without a DB connection.
 *
 * All dollar figures are whole-dollar integers (the economy's convention —
 * see fiscalMath.ts). Every $/day figure below is the verified FY2025
 * CBO/Treasury reconciliation cited in docs/DIVERGENCE_EXPERIMENT.md §2.2.
 */

import type { FiscalKind } from './fiscalMath.js';

export interface SeedLawDef {
  /** Law/bill title, e.g. "Social Security Act (Baseline)". */
  title: string;
  /** One-line summary naming it part of the T0 divergence baseline. */
  summary: string;
  /** Short paragraph of full bill/law text. */
  fullText: string;
  kind: Extract<FiscalKind, 'mandatory' | 'spend_recurring'>;
  /** Per-tick (per-day) dollar amount at T0. */
  amountPerDay: number;
  /** fiscalProgramName stored on the bill/law row. */
  programName: string;
}

/** The 13 seed programs from DIVERGENCE_EXPERIMENT.md §2.2, in table order. */
export const SEED_LAWS: readonly SeedLawDef[] = [
  {
    title: 'Social Security Act (Baseline)',
    summary: 'T0 divergence baseline: Social Security old-age and survivors benefits.',
    fullText:
      'Establishes the baseline Social Security mandatory-spending program at simulation T0, ' +
      'carrying forward the real federal old-age, survivors, and disability insurance obligation ' +
      'as of the divergence baseline date. This program is exempt from budget-session lapse and ' +
      'grows automatically with mandatoryGrowthPctAnnual; the AI government may amend its base ' +
      'amount within the configured bound but cannot repeal it outright.',
    kind: 'mandatory',
    amountPerDay: 4_315_000_000,
    programName: 'Social Security',
  },
  {
    title: 'Medicare Act (Baseline)',
    summary: 'T0 divergence baseline: Medicare health coverage for seniors and the disabled.',
    fullText:
      'Establishes the baseline Medicare mandatory-spending program at simulation T0, carrying ' +
      'forward the real federal hospital and medical insurance obligation for seniors and ' +
      'qualifying disabled citizens as of the divergence baseline date. Exempt from budget-session ' +
      'lapse; grows automatically with mandatoryGrowthPctAnnual.',
    kind: 'mandatory',
    amountPerDay: 2_707_000_000,
    programName: 'Medicare',
  },
  {
    title: 'Medicaid Act (Baseline)',
    summary: 'T0 divergence baseline: Medicaid health coverage for low-income citizens.',
    fullText:
      'Establishes the baseline Medicaid mandatory-spending program at simulation T0, carrying ' +
      'forward the real joint federal obligation for low-income health coverage as of the ' +
      'divergence baseline date. Exempt from budget-session lapse; grows automatically with ' +
      'mandatoryGrowthPctAnnual.',
    kind: 'mandatory',
    amountPerDay: 1_830_000_000,
    programName: 'Medicaid',
  },
  {
    title: 'Federal Income Security and Veterans Programs (Baseline)',
    summary: 'T0 divergence baseline: SNAP, EITC, veterans benefits, and other mandatory income-security programs.',
    fullText:
      'Establishes the baseline mandatory-spending program at simulation T0 covering the real ' +
      'federal income-security and veterans-benefit obligations not separately itemized elsewhere ' +
      '(SNAP, Earned Income Tax Credit, veterans compensation and pensions, and related programs) ' +
      'as of the divergence baseline date. Exempt from budget-session lapse; grows automatically ' +
      'with mandatoryGrowthPctAnnual.',
    kind: 'mandatory',
    amountPerDay: 2_118_000_000,
    programName: 'Other Mandatory',
  },
  {
    title: 'ACA & CHIP Health Programs (Baseline)',
    summary:
      "T0 divergence baseline: Affordable Care Act marketplace subsidies and the Children's Health Insurance Program.",
    fullText:
      'Establishes the baseline mandatory-spending program at simulation T0 covering the real ' +
      "federal obligation for Affordable Care Act marketplace subsidies and the Children's Health " +
      'Insurance Program as of the divergence baseline date. Exempt from budget-session lapse; ' +
      'grows automatically with mandatoryGrowthPctAnnual.',
    kind: 'mandatory',
    amountPerDay: 449_000_000,
    programName: 'Other Health',
  },
  {
    title: 'National Defense Appropriations Act (Baseline)',
    summary: 'T0 divergence baseline: national defense discretionary appropriation.',
    fullText:
      'Establishes the baseline discretionary appropriation for national defense at simulation T0, ' +
      'carrying forward the real federal defense-spending level as of the divergence baseline ' +
      'date. Unlike the mandatory programs above, this is ordinary discretionary spending: it is ' +
      'subject to normal budget-session lapse and renewal, and the AI government must actively ' +
      'keep it funded.',
    kind: 'spend_recurring',
    amountPerDay: 2_447_000_000,
    programName: 'National Defense',
  },
  {
    title: 'Veterans Services Appropriations Act (Baseline)',
    summary: 'T0 divergence baseline: nondefense discretionary appropriation for veterans services.',
    fullText:
      'Establishes the baseline discretionary appropriation for veterans services (non-benefit ' +
      'administration and care) at simulation T0, one of six nondefense discretionary programs ' +
      'splitting the real federal nondefense discretionary total as of the divergence baseline ' +
      'date. Subject to normal budget-session lapse and renewal.',
    kind: 'spend_recurring',
    amountPerDay: 450_000_000,
    programName: 'Veterans Services',
  },
  {
    title: 'Education and Workforce Appropriations Act (Baseline)',
    summary: 'T0 divergence baseline: nondefense discretionary appropriation for education and workforce programs.',
    fullText:
      'Establishes the baseline discretionary appropriation for education and workforce development ' +
      'programs at simulation T0, one of six nondefense discretionary programs splitting the real ' +
      'federal nondefense discretionary total as of the divergence baseline date. Subject to ' +
      'normal budget-session lapse and renewal.',
    kind: 'spend_recurring',
    amountPerDay: 450_000_000,
    programName: 'Education & Workforce',
  },
  {
    title: 'Transportation and Infrastructure Appropriations Act (Baseline)',
    summary: 'T0 divergence baseline: nondefense discretionary appropriation for transportation and infrastructure.',
    fullText:
      'Establishes the baseline discretionary appropriation for transportation and infrastructure ' +
      'programs at simulation T0, one of six nondefense discretionary programs splitting the real ' +
      'federal nondefense discretionary total as of the divergence baseline date. Subject to ' +
      'normal budget-session lapse and renewal.',
    kind: 'spend_recurring',
    amountPerDay: 450_000_000,
    programName: 'Transportation & Infrastructure',
  },
  {
    title: 'Science and Research Appropriations Act (Baseline)',
    summary: 'T0 divergence baseline: nondefense discretionary appropriation for science and research programs.',
    fullText:
      'Establishes the baseline discretionary appropriation for science and research programs at ' +
      'simulation T0, one of six nondefense discretionary programs splitting the real federal ' +
      'nondefense discretionary total as of the divergence baseline date. Subject to normal ' +
      'budget-session lapse and renewal.',
    kind: 'spend_recurring',
    amountPerDay: 445_000_000,
    programName: 'Science & Research',
  },
  {
    title: 'Justice and Public Safety Appropriations Act (Baseline)',
    summary: 'T0 divergence baseline: nondefense discretionary appropriation for justice and public safety programs.',
    fullText:
      'Establishes the baseline discretionary appropriation for justice and public safety programs ' +
      'at simulation T0, one of six nondefense discretionary programs splitting the real federal ' +
      'nondefense discretionary total as of the divergence baseline date. Subject to normal ' +
      'budget-session lapse and renewal.',
    kind: 'spend_recurring',
    amountPerDay: 445_000_000,
    programName: 'Justice & Public Safety',
  },
  {
    title: 'General Government Appropriations Act (Baseline)',
    summary: 'T0 divergence baseline: nondefense discretionary appropriation for general government operations.',
    fullText:
      'Establishes the baseline discretionary appropriation for general government operations at ' +
      'simulation T0, one of six nondefense discretionary programs splitting the real federal ' +
      'nondefense discretionary total as of the divergence baseline date. Subject to normal ' +
      'budget-session lapse and renewal.',
    kind: 'spend_recurring',
    amountPerDay: 445_000_000,
    programName: 'General Government',
  },
] as const;

/** taxRatePercent set at T0 (real effective rate ~18.7%, rounded to 19). */
export const SEED_TAX_RATE_PERCENT = 19;

/** agoraPopulation set at T0 (real 2025 US population; config previously said 330M). */
export const SEED_POPULATION = 341_800_000;

/** Sum of amountPerDay across every SEED_LAWS row with the given kind. */
export function sumSeedAmountByKind(kind: 'mandatory' | 'spend_recurring'): number {
  return SEED_LAWS.filter((l) => l.kind === kind).reduce((acc, l) => acc + l.amountPerDay, 0);
}

export interface ExpectedDeficitMath {
  /** floor(gdpAnnual * taxRatePercent / 100 / 365). */
  dailyRevenue: number;
  /** Sum of all mandatory program amounts/day. */
  totalMandatoryPerDay: number;
  /** Sum of all spend_recurring program amounts/day. */
  totalRecurringPerDay: number;
  /** floor(debtOutstanding * debtInterestRatePct / 100 / 365). */
  dailyInterest: number;
  /** totalMandatoryPerDay + totalRecurringPerDay + dailyInterest. */
  totalSpendingPerDay: number;
  /** dailyRevenue - totalSpendingPerDay (negative = deficit). */
  netPerDay: number;
}

/**
 * The T0 sanity-check arithmetic from DIVERGENCE_EXPERIMENT.md §2.2:
 * revenue = floor(gdpAnnual * taxRatePercent / 100 / 365); spending = seeded
 * mandatory + seeded recurring + interest on the seeded debt; net = revenue -
 * spending (negative is a deficit, matching reality's ~-$4.9B/day at T0).
 * Pure integer arithmetic — mirrors fiscalMath.ts's dailyCitizenRevenue /
 * tickInterest conventions exactly so the printed sanity check matches what
 * the engine will actually compute at tick T0+1.
 */
export function computeExpectedDeficit(
  gdpAnnual: number,
  taxRatePercent: number,
  debtOutstanding: number,
  debtInterestRatePct: number,
): ExpectedDeficitMath {
  const dailyRevenue =
    Number.isFinite(gdpAnnual) && Number.isFinite(taxRatePercent) && gdpAnnual > 0 && taxRatePercent > 0
      ? Math.floor((gdpAnnual * taxRatePercent) / 100 / 365)
      : 0;
  const totalMandatoryPerDay = sumSeedAmountByKind('mandatory');
  const totalRecurringPerDay = sumSeedAmountByKind('spend_recurring');
  const dailyInterest =
    Number.isFinite(debtOutstanding) &&
    Number.isFinite(debtInterestRatePct) &&
    debtOutstanding > 0 &&
    debtInterestRatePct > 0
      ? Math.floor((debtOutstanding * debtInterestRatePct) / 100 / 365)
      : 0;
  const totalSpendingPerDay = totalMandatoryPerDay + totalRecurringPerDay + dailyInterest;
  const netPerDay = dailyRevenue - totalSpendingPerDay;
  return { dailyRevenue, totalMandatoryPerDay, totalRecurringPerDay, dailyInterest, totalSpendingPerDay, netPerDay };
}
