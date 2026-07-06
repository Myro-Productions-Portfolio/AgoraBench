#!/usr/bin/env tsx
/**
 * Divergence Experiment — T0 baseline seed (E1 slice 2).
 *
 * One-time script, run MANUALLY on prod after a fresh pg_dump, once Slice 1
 * (mandatory fiscal lane + debt/interest engine, deployed dark) is verified.
 * See docs/DIVERGENCE_EXPERIMENT.md §2.2 + §3 "Slice 2" for the full spec.
 *
 * What it does:
 *   1. Refuses to run twice (divergenceT0Tick > 0 in runtime_config).
 *   2. Determines the current tick (seedTick) from fiscal_tick_summaries /
 *      tick_log.
 *   3. Pulls the live "Debt to the Penny" total from the Treasury Fiscal
 *      Data API (or accepts a --debt override for an offline run).
 *   4. Inserts 12 system-authored bills+laws: 5 `mandatory` programs (never
 *      lapse) and 7 `spend_recurring` programs (Defense + 6 named nondefense
 *      discretionary programs, subject to normal lapse/renewal — the AI
 *      government must actively keep these funded from day one). "Net
 *      Interest" is NOT inserted as a law; it accrues automatically via the
 *      debt engine (tickInterest() in fiscalMath.ts).
 *   5. Read-merge-writes the runtime_config JSONB (tax rate -> 19%,
 *      debtEngineEnabled -> true, T0 markers) and government_settings
 *      (debtOutstanding, agoraPopulation).
 *   6. Writes one activity_events row narrating the start of the experiment.
 *   7. Defaults to dry-run: prints everything it WOULD do and exits 0
 *      without writing. Pass --execute to actually write.
 *
 * Usage (dry run, safe, no DB writes):
 *   npx tsx scripts/seed-divergence-baseline.ts
 *   npx tsx scripts/seed-divergence-baseline.ts --dry-run
 *
 * Usage (writes to the DB — run once, on prod, after pg_dump):
 *   npx tsx scripts/seed-divergence-baseline.ts --execute
 *
 * Offline override (network can't reach Treasury Fiscal Data API):
 *   npx tsx scripts/seed-divergence-baseline.ts --execute --debt 30000000000000
 */

import 'dotenv/config';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../src/core/db/connection.js';
import {
  agents,
  bills,
  laws,
  positions,
  governmentSettings,
  fiscalTickSummaries,
  tickLog,
  activityEvents,
} from '../src/core/db/schema/index.js';
import { getRuntimeConfig, loadRuntimeConfig, updateRuntimeConfig } from '../src/core/server/runtimeConfig.js';
import { SEED_LAWS, SEED_TAX_RATE_PERCENT, SEED_POPULATION, computeExpectedDeficit } from '../src/core/server/lib/divergenceSeed.js';

const DEBT_TO_PENNY_URL =
  'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1';
const FETCH_TIMEOUT_MS = 15_000;

interface CliArgs {
  execute: boolean;
  dryRun: boolean;
  debtOverride: number | null;
}

function parseArgs(argv: string[]): CliArgs {
  let execute = false;
  let dryRun = false;
  let debtOverride: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--execute') execute = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--debt') {
      const raw = argv[i + 1];
      const n = raw !== undefined ? Number.parseInt(raw, 10) : NaN;
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`[SEED] --debt requires a positive integer dollar amount, got: ${raw}`);
        process.exit(1);
      }
      debtOverride = n;
      i++;
    }
  }

  if (execute && dryRun) {
    console.error('[SEED] --execute and --dry-run are mutually exclusive.');
    process.exit(1);
  }

  return { execute, dryRun, debtOverride };
}

/** Minimal fetch of the live Debt to the Penny total. Throws on any failure —
 *  callers must never seed with a guessed debt figure on a network error. */
async function fetchLiveDebtToPenny(): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(DEBT_TO_PENNY_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from Treasury Fiscal Data API`);
    const body = (await res.json()) as { data?: Array<{ tot_pub_debt_out_amt?: string; record_date?: string }> };
    const row = body.data?.[0];
    if (!row?.tot_pub_debt_out_amt) throw new Error('Debt to the Penny response missing tot_pub_debt_out_amt');
    const n = Number.parseFloat(row.tot_pub_debt_out_amt);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Debt to the Penny returned a non-positive value: ${row.tot_pub_debt_out_amt}`);
    console.warn(`[SEED] Live debt pull: $${Math.floor(n).toLocaleString()} as of ${row.record_date ?? 'unknown date'}`);
    return Math.floor(n);
  } finally {
    clearTimeout(timer);
  }
}

/** seedTick = max(tick_number) from fiscal_tick_summaries, falling back to
 *  COUNT(*) from tick_log when no fiscal summaries exist yet. */
async function determineSeedTick(): Promise<number> {
  const [fiscalMax] = await db
    .select({ maxTick: sql<number | null>`MAX(${fiscalTickSummaries.tickNumber})` })
    .from(fiscalTickSummaries);
  if (fiscalMax?.maxTick !== null && fiscalMax?.maxTick !== undefined) {
    return Number(fiscalMax.maxTick);
  }

  const [tickCount] = await db.select({ count: sql<number>`COUNT(*)` }).from(tickLog);
  return Number(tickCount?.count ?? 0);
}

/** Picks a sponsor agent for the system-authored baseline bills: the current
 *  president if one holds office, otherwise the highest-reputation active
 *  agent (bills.sponsorId is NOT NULL — every bill needs a real agent FK). */
async function pickSystemSponsor(): Promise<{ id: string; displayName: string } | null> {
  const [president] = await db
    .select({ agentId: positions.agentId })
    .from(positions)
    .where(and(eq(positions.type, 'president'), eq(positions.isActive, true)))
    .limit(1);

  const sponsorId = president?.agentId;
  if (sponsorId) {
    const [agent] = await db
      .select({ id: agents.id, displayName: agents.displayName })
      .from(agents)
      .where(eq(agents.id, sponsorId))
      .limit(1);
    if (agent) return agent;
  }

  const [fallback] = await db
    .select({ id: agents.id, displayName: agents.displayName })
    .from(agents)
    .where(eq(agents.isActive, true))
    .orderBy(desc(agents.reputation))
    .limit(1);
  return fallback ?? null;
}

function formatMoney(n: number): string {
  return `$${n.toLocaleString()}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const willExecute = args.execute;

  if (!willExecute) {
    console.warn('[SEED] Running in DRY-RUN mode (no flag or --dry-run given). Pass --execute to write to the DB.\n');
  }

  /* ---- Step 1: refuse to re-run ---- */
  await loadRuntimeConfig();
  const rc = getRuntimeConfig();
  if (rc.divergenceT0Tick > 0) {
    console.error(
      `[SEED] REFUSING to run — divergenceT0Tick is already set to ${rc.divergenceT0Tick} ` +
        `(divergenceT0Date=${rc.divergenceT0Date || '(unset)'}). The T0 baseline has already been seeded.`,
    );
    process.exit(1);
  }

  /* ---- Step 2: determine seedTick ---- */
  const seedTick = await determineSeedTick();
  console.warn(`[SEED] seedTick = ${seedTick}`);

  /* ---- Step 3: live debt pull (or override) ---- */
  let debtOutstanding: number;
  if (args.debtOverride !== null) {
    debtOutstanding = args.debtOverride;
    console.warn(`[SEED] Using --debt override: ${formatMoney(debtOutstanding)} (skipped live pull)`);
  } else {
    try {
      debtOutstanding = await fetchLiveDebtToPenny();
    } catch (err) {
      console.error(
        '[SEED] HARD FAIL — could not pull the live Debt to the Penny figure, and no --debt override was given.',
      );
      console.error('[SEED] Refusing to seed with a guessed debt figure. Error:', err instanceof Error ? err.message : err);
      console.error('[SEED] Retry once connectivity is restored, or pass --debt <dollars> for a deliberate offline run.');
      process.exit(1);
    }
  }

  /* ---- Step 4: pick sponsor for system-authored bills (needed for both the
     printed preview and the actual insert, so resolved unconditionally) ---- */
  const sponsor = await pickSystemSponsor();
  if (!sponsor) {
    console.error('[SEED] REFUSING — no active agent found to sponsor the baseline bills (bills.sponsorId is NOT NULL).');
    process.exit(1);
  }
  console.warn(`[SEED] System sponsor: ${sponsor.displayName} (${sponsor.id})`);

  /* ---- Compute expected deficit math for the summary/epilogue ---- */
  const expected = computeExpectedDeficit(rc.gdpAnnual, SEED_TAX_RATE_PERCENT, debtOutstanding, rc.debtInterestRatePct);

  const nowIso = new Date().toISOString().slice(0, 10);

  console.warn('\n[SEED] ==== Seed manifest ====');
  for (const law of SEED_LAWS) {
    console.warn(`  [${law.kind.padEnd(15)}] ${law.programName.padEnd(32)} ${formatMoney(law.amountPerDay)}/day  — "${law.title}"`);
  }
  console.warn('[SEED] ==== End manifest ====\n');

  console.warn('[SEED] ==== Arithmetic ====');
  console.warn(`  Revenue/day    = floor(gdpAnnual(${formatMoney(rc.gdpAnnual)}) * ${SEED_TAX_RATE_PERCENT}% / 365) = ${formatMoney(expected.dailyRevenue)}`);
  console.warn(`  Mandatory/day  = ${formatMoney(expected.totalMandatoryPerDay)}`);
  console.warn(`  Recurring/day  = ${formatMoney(expected.totalRecurringPerDay)}`);
  console.warn(`  Interest/day   = floor(debt(${formatMoney(debtOutstanding)}) * ${rc.debtInterestRatePct}% / 365) = ${formatMoney(expected.dailyInterest)}`);
  console.warn(`  Total spend/day= ${formatMoney(expected.totalSpendingPerDay)}`);
  console.warn(`  Net/day        = revenue - spend = ${formatMoney(expected.netPerDay)} ${expected.netPerDay < 0 ? '(DEFICIT)' : '(SURPLUS)'}`);
  console.warn('[SEED] ==== End arithmetic ====\n');

  console.warn('[SEED] ==== Config changes ====');
  console.warn(`  debtEngineEnabled                 : ${rc.debtEngineEnabled} -> true`);
  console.warn(`  divergenceT0Tick                  : ${rc.divergenceT0Tick} -> ${seedTick}`);
  console.warn(`  divergenceT0Date                  : "${rc.divergenceT0Date}" -> "${nowIso}"`);
  console.warn(`  government_settings.taxRatePercent -> ${SEED_TAX_RATE_PERCENT}`);
  console.warn(`  government_settings.debtOutstanding -> ${formatMoney(debtOutstanding)}`);
  console.warn(`  runtime_config.agoraPopulation     : ${rc.agoraPopulation.toLocaleString()} -> ${SEED_POPULATION.toLocaleString()}`);
  console.warn('[SEED] ==== End config changes ====\n');

  if (!willExecute) {
    console.warn('[SEED] Dry run complete. No rows were written. Re-run with --execute to write to the DB.');
    process.exit(0);
  }

  /* ==================== WRITE PATH ==================== */
  console.warn('[SEED] --execute given. Writing...');

  const insertedLaws: Array<{ id: string; title: string; programName: string; amountPerDay: number; kind: string }> = [];

  for (const law of SEED_LAWS) {
    const [insertedBill] = await db
      .insert(bills)
      .values({
        title: law.title,
        summary: law.summary,
        fullText: law.fullText,
        sponsorId: sponsor.id,
        committee: 'Budget',
        status: 'passed',
        billType: 'original',
        fiscalKind: law.kind,
        fiscalAmount: law.amountPerDay,
        fiscalProgramName: law.programName,
        introducedAt: new Date(),
        lastActionAt: new Date(),
      })
      .returning({ id: bills.id });

    const [insertedLaw] = await db
      .insert(laws)
      .values({
        billId: insertedBill.id,
        title: law.title,
        text: law.fullText,
        enactedDate: new Date(),
        isActive: true,
        fiscalKind: law.kind,
        fiscalAmount: law.amountPerDay,
        fiscalProgramName: law.programName,
        programActive: law.kind === 'spend_recurring' ? true : null,
        enactedTick: seedTick,
        lastRenewedTick: seedTick,
      })
      .returning({ id: laws.id });

    insertedLaws.push({ id: insertedLaw.id, title: law.title, programName: law.programName, amountPerDay: law.amountPerDay, kind: law.kind });
    console.warn(`[SEED]   inserted law "${law.title}" (${insertedLaw.id})`);
  }

  /* ---- Config: read-merge-write the runtime_config JSONB (Rule 6) ---- */
  await updateRuntimeConfig({
    debtEngineEnabled: true,
    divergenceT0Tick: seedTick,
    divergenceT0Date: nowIso,
    agoraPopulation: SEED_POPULATION,
  });
  console.warn('[SEED] runtime_config updated (debtEngineEnabled, divergenceT0Tick, divergenceT0Date, agoraPopulation)');

  /* ---- government_settings: taxRatePercent + debtOutstanding ---- */
  const [existingSettings] = await db.select().from(governmentSettings).limit(1);
  if (!existingSettings) {
    console.error('[SEED] REFUSING — no government_settings row found. This table must already have exactly one row.');
    process.exit(1);
  }
  await db
    .update(governmentSettings)
    .set({
      taxRatePercent: SEED_TAX_RATE_PERCENT,
      debtOutstanding,
      updatedAt: new Date(),
    })
    .where(eq(governmentSettings.id, existingSettings.id));
  console.warn(`[SEED] government_settings updated (taxRatePercent=${SEED_TAX_RATE_PERCENT}, debtOutstanding=${formatMoney(debtOutstanding)})`);

  /* ---- Activity event ---- */
  const debtTrillions = (debtOutstanding / 1_000_000_000_000).toFixed(1);
  await db.insert(activityEvents).values({
    type: 'divergence_t0',
    title: 'The Divergence Experiment begins',
    description:
      `The simulation now carries the real United States fiscal baseline: ~$19.2B/day in spending, ` +
      `$${debtTrillions}T in national debt, and a 19% tax rate. From this tick forward, the AI government ` +
      `owns every fiscal outcome — no endogenous state will ever sync from reality again.`,
    metadata: JSON.stringify({
      seedTick,
      seedDate: nowIso,
      debtOutstanding,
      taxRatePercent: SEED_TAX_RATE_PERCENT,
      agoraPopulation: SEED_POPULATION,
      expected: {
        dailyRevenue: expected.dailyRevenue,
        totalMandatoryPerDay: expected.totalMandatoryPerDay,
        totalRecurringPerDay: expected.totalRecurringPerDay,
        dailyInterest: expected.dailyInterest,
        totalSpendingPerDay: expected.totalSpendingPerDay,
        netPerDay: expected.netPerDay,
      },
      programs: insertedLaws.map((l) => ({ lawId: l.id, name: l.programName, kind: l.kind, amountPerDay: l.amountPerDay })),
    }),
  });
  console.warn('[SEED] activity_events row written (type=divergence_t0)');

  /* ---- Final summary ---- */
  console.warn('\n[SEED] ==== T0 SEED COMPLETE ====');
  console.warn(`  seedTick             : ${seedTick}`);
  console.warn(`  debt seeded          : ${formatMoney(debtOutstanding)}`);
  console.warn(`  mandatory/day        : ${formatMoney(expected.totalMandatoryPerDay)}`);
  console.warn(`  recurring/day        : ${formatMoney(expected.totalRecurringPerDay)}`);
  console.warn(`  interest/day (est.)  : ${formatMoney(expected.dailyInterest)}`);
  console.warn(`  expected deficit/day : ${formatMoney(expected.netPerDay)}`);
  console.warn('[SEED] ==========================\n');

  console.warn('[SEED] ==== Verification epilogue — run after the next 3 ticks ====');
  console.warn(`
-- 1) Spending this tick should be roughly $19.2B + interest (mandatory + recurring debited every tick):
SELECT tick_number, revenue, spending, treasury_end
FROM fiscal_tick_summaries
WHERE tick_number > ${seedTick}
ORDER BY tick_number ASC
LIMIT 3;

-- 2) Deficit per tick should be roughly ${formatMoney(expected.netPerDay)} (revenue - spending), and
--    government_settings.debt_outstanding should grow by (deficit magnitude + interest) each tick:
SELECT tax_rate_percent, debt_outstanding, treasury_balance FROM government_settings;

-- 3) Fiscal summary should reconcile against the transaction ledger for the same tick window
--    (sum of transactions.amount for type IN ('mandatory_spend','recurring_spend','tax_revenue',...)
--    should net to the same delta as fiscal_tick_summaries.revenue - fiscal_tick_summaries.spending):
SELECT type, COUNT(*), SUM(amount) FROM transactions
WHERE created_at > (SELECT enacted_date FROM laws WHERE enacted_tick = ${seedTick} LIMIT 1)
GROUP BY type
ORDER BY type;

-- 4) Every seeded law should still be active and correctly flagged:
SELECT title, fiscal_kind, fiscal_amount, program_active, enacted_tick, last_renewed_tick, is_active
FROM laws
WHERE enacted_tick = ${seedTick}
ORDER BY fiscal_kind, title;
`);
  console.warn('[SEED] ==== End verification epilogue ====');

  process.exit(0);
}

main().catch((err) => {
  console.error('[SEED] FAILED:', err);
  process.exit(1);
});
