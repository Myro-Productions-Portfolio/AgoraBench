import { Router } from 'express';
import { db } from '@db/connection';
import { governmentSettings, laws, fiscalTickSummaries, realitySnapshots, tickLog } from '@db/schema/index';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getRuntimeConfig } from '@core/server/runtimeConfig.js';
import { mandatoryEffectiveAmount, tickInterest } from '@core/server/lib/fiscalMath.js';
import {
  categoryShares,
  l1CategoryDistance,
  fytdToDailyAverage,
  debtToGdpPct,
  annualizedShareOfGdpPct,
  PROGRAM_TO_MTS_CATEGORY,
  isFiscallyActive,
  programContinuityStatus,
} from '../lib/divergenceMath.js';

const router = Router();

/* GET /api/divergence -- Sim vs Reality scoreboard (Divergence experiment,
   E1 slice 4, docs/DIVERGENCE_EXPERIMENT.md §2.4). Public, read-only, same
   posture as GET /government/budget: no auth gate, nothing here mutates
   state. This is the ONLY consumer of reality_snapshots outside the puller
   itself (realityFeed.ts) -- see the hard rule in the divergence spec §2.3. */
router.get('/divergence', async (_req, res, next) => {
  try {
    const rc = getRuntimeConfig();

    const t0 = rc.divergenceT0Tick > 0
      ? { tick: rc.divergenceT0Tick, date: rc.divergenceT0Date }
      : null;

    const [[govSettings], [tickCountRow]] = await Promise.all([
      db.select().from(governmentSettings).limit(1),
      db
        .select({ completed: sql<number>`COUNT(*) FILTER (WHERE ${tickLog.completedAt} IS NOT NULL)` })
        .from(tickLog),
    ]);

    const currentTickNumber = Number(tickCountRow?.completed ?? 0);
    const treasuryBalance = govSettings?.treasuryBalance ?? 0;
    const debtOutstanding = govSettings?.debtOutstanding ?? 0;
    const taxRatePercent = govSettings?.taxRatePercent ?? 0;

    /* ---- Sim aggregates ------------------------------------------------ */

    const revenuePerDay = Math.floor((rc.gdpAnnual * taxRatePercent) / 100 / 365);

    /* Mandatory + spend_recurring programs, fetched WITHOUT a programActive
       filter (mandatory rows are seeded with programActive = null -- see
       isFiscallyActive's doc comment -- so filtering on it here would drop
       every mandatory row from the query itself, before isFiscallyActive
       ever gets a chance to run). The per-row inclusion rule below mirrors
       agentTick.ts Phase 12 exactly via isFiscallyActive():
         - mandatory:       isActive && fiscalKind === 'mandatory' (never
           gated by programActive, which mandatory rows don't carry)
         - spend_recurring: isActive && programActive === true
       Mandatory amounts are computed at their GROWN effective value
       (fiscalMath.ts mandatoryEffectiveAmount), matching what Phase 12
       actually debits this tick -- never the stale stored base. */
    const candidateProgramRows = await db
      .select({
        lawId: laws.id,
        title: laws.title,
        programName: laws.fiscalProgramName,
        fiscalKind: laws.fiscalKind,
        fiscalAmount: laws.fiscalAmount,
        enactedTick: laws.enactedTick,
        lastRenewedTick: laws.lastRenewedTick,
        programActive: laws.programActive,
        isActive: laws.isActive,
      })
      .from(laws)
      .where(sql`${laws.fiscalKind} IN ('mandatory', 'spend_recurring')`);

    const activeProgramRows = candidateProgramRows.filter(isFiscallyActive);

    const spendingByCategory: { name: string; perDay: number }[] = [];
    let spendingPerDay = 0;
    for (const p of activeProgramRows) {
      const base = typeof p.fiscalAmount === 'number' && Number.isFinite(p.fiscalAmount) ? p.fiscalAmount : 0;
      const perDay = p.fiscalKind === 'mandatory' && p.enactedTick !== null
        ? mandatoryEffectiveAmount(base, p.enactedTick, currentTickNumber, rc.mandatoryGrowthPctAnnual)
        : base;
      if (perDay <= 0) continue;
      spendingPerDay += perDay;
      spendingByCategory.push({ name: p.programName ?? p.title, perDay });
    }

    /* Net interest is an automatic outflow, not a law (fiscalMath.ts
       tickInterest) -- add it as its own synthetic category so the mix
       comparison against MTS Table 9's 'Net Interest' bucket is apples to
       apples, and so it counts toward total sim spending below. */
    const dailyInterest = rc.debtEngineEnabled ? tickInterest(debtOutstanding, rc.debtInterestRatePct) : 0;
    if (dailyInterest > 0) {
      spendingByCategory.push({ name: 'Net Interest', perDay: dailyInterest });
      spendingPerDay += dailyInterest;
    }

    const deficitPerDay = spendingPerDay - revenuePerDay;

    const sim = {
      treasuryBalance,
      debtOutstanding,
      taxRatePercent,
      revenuePerDay,
      spendingPerDay,
      deficitPerDay,
      debtToGdpPct: debtToGdpPct(debtOutstanding, rc.gdpAnnual),
      spendingByCategory,
    };

    /* ---- Reality aggregates -------------------------------------------- */

    const [latestTopLine] = await db
      .select()
      .from(realitySnapshots)
      .where(and(eq(realitySnapshots.source, 'mts_table_1'), eq(realitySnapshots.category, '')))
      .orderBy(desc(realitySnapshots.recordDate))
      .limit(1);

    const [latestDebt] = await db
      .select()
      .from(realitySnapshots)
      .where(eq(realitySnapshots.source, 'debt_to_penny'))
      .orderBy(desc(realitySnapshots.recordDate))
      .limit(1);

    /* Latest month's MTS Table 9 category rows -- all rows sharing the max
       record_date for that source, one row per budget-function category. */
    const [latestMts9Date] = await db
      .select({ maxDate: sql<string | null>`MAX(${realitySnapshots.recordDate})` })
      .from(realitySnapshots)
      .where(eq(realitySnapshots.source, 'mts_table_9'));

    const mts9CategoryRows = latestMts9Date?.maxDate
      ? await db
          .select({ category: realitySnapshots.category, outlaysFytd: realitySnapshots.outlaysFytd })
          .from(realitySnapshots)
          .where(and(eq(realitySnapshots.source, 'mts_table_9'), eq(realitySnapshots.recordDate, latestMts9Date.maxDate)))
      : [];

    let reality: {
      asOf: string;
      debtOutstanding: number;
      outlaysFytd: number;
      receiptsFytd: number;
      deficitFytd: number;
      outlaysPerDayAvg: number;
      deficitPerDayAvg: number;
      debtToGdpPct: number;
      taxBurdenPct: number;
      spendingByCategory: { name: string; fytd: number }[];
    } | null = null;

    if (latestTopLine || latestDebt) {
      const asOf = latestTopLine?.recordDate ?? latestDebt?.recordDate ?? '';
      const outlaysFytd = latestTopLine?.outlaysFytd ?? 0;
      const receiptsFytd = latestTopLine?.receiptsFytd ?? 0;
      const deficitFytd = latestTopLine?.deficitFytd ?? 0;
      const realityDebt = latestDebt?.debtOutstanding ?? 0;
      const outlaysPerDayAvg = fytdToDailyAverage(outlaysFytd, asOf);
      const receiptsPerDayAvg = fytdToDailyAverage(receiptsFytd, asOf);
      const deficitPerDayAvg = fytdToDailyAverage(deficitFytd, asOf);

      reality = {
        asOf,
        debtOutstanding: realityDebt,
        outlaysFytd,
        receiptsFytd,
        deficitFytd,
        outlaysPerDayAvg,
        deficitPerDayAvg,
        debtToGdpPct: debtToGdpPct(realityDebt, rc.gdpAnnual),
        taxBurdenPct: annualizedShareOfGdpPct(receiptsPerDayAvg, rc.gdpAnnual),
        spendingByCategory: mts9CategoryRows
          .filter((r) => (r.outlaysFytd ?? 0) > 0)
          .map((r) => ({ name: r.category ?? '', fytd: r.outlaysFytd ?? 0 })),
      };
    }

    /* ---- Trajectories since T0 ------------------------------------------
       Sim: fiscal_tick_summaries since T0, deficit = spending - revenue per
       tick. Reality: reality_snapshots (mts_table_1 top-line rows) ordered
       by record_date -- gives a monthly-cadence deficit/debt series.
       NOTE deliberately scoped down from the spec's literal ask: only the
       CURRENT debtOutstanding is stored on the sim side (governmentSettings
       is a single-row snapshot, not a per-tick ledger), so there is no
       historical sim debt series to plot -- reconstructing one by summing
       tick deficits backwards from today would silently assume zero
       interest and zero debt-engine retirement/issuance noise, which is
       exactly the kind of invented number fiscalMath.ts's guard style
       forbids. Sim debt series is omitted for v1; this comment is the
       "documented the choice" the task asked for. */
    const series = t0
      ? await db
          .select({
            tickNumber: fiscalTickSummaries.tickNumber,
            revenue: fiscalTickSummaries.revenue,
            spending: fiscalTickSummaries.spending,
          })
          .from(fiscalTickSummaries)
          .where(sql`${fiscalTickSummaries.tickNumber} >= ${t0.tick}`)
          .orderBy(fiscalTickSummaries.tickNumber)
          .limit(2000)
      : [];

    const simSeries = series.map((s) => ({
      tickNumber: s.tickNumber,
      deficit: s.spending - s.revenue,
    }));

    const realitySeriesRows = t0
      ? await db
          .select({
            recordDate: realitySnapshots.recordDate,
            deficitFytd: realitySnapshots.deficitFytd,
            debtOutstanding: realitySnapshots.debtOutstanding,
          })
          .from(realitySnapshots)
          .where(sql`${realitySnapshots.source} IN ('mts_table_1', 'debt_to_penny') AND ${realitySnapshots.recordDate} >= ${t0.date}`)
          .orderBy(realitySnapshots.recordDate)
          .limit(2000)
      : [];

    /* mts_table_1 and debt_to_penny rows land on the same record_date but
       are separate rows (different `source`) -- merge by date so each
       series point can carry both fields when available. */
    const realityByDate = new Map<string, { recordDate: string; deficitFytd: number | null; debtOutstanding: number | null }>();
    for (const r of realitySeriesRows) {
      const existing = realityByDate.get(r.recordDate) ?? { recordDate: r.recordDate, deficitFytd: null, debtOutstanding: null };
      if (r.deficitFytd !== null) existing.deficitFytd = r.deficitFytd;
      if (r.debtOutstanding !== null) existing.debtOutstanding = r.debtOutstanding;
      realityByDate.set(r.recordDate, existing);
    }
    const realitySeries = Array.from(realityByDate.values()).sort((a, b) => a.recordDate.localeCompare(b.recordDate));

    /* ---- Program continuity ---------------------------------------------
       Seeded programs (fiscalKind in mandatory/spend_recurring, enacted at
       or after T0) and their funding status. Queried independently of
       activeProgramRows above (which excludes lapsed/inactive rows) so a
       program that has lapsed since T0 still shows up as "Lapsed" rather
       than silently disappearing from the table. Status precedence is
       programContinuityStatus() in divergenceMath.ts -- shared so the
       mandatory programActive=null case (always "Funded" while isActive,
       since mandatory rows never lapse -- Phase 9.7) is an explicit rule,
       not an accidental fallthrough of the old `programActive === false ?
       Lapsed : ...` ternary (which happened to render the right label only
       because mandatory rows' programActive is null, never false -- by
       design here, not luck, now that it's spelled out in one place). */
    const programContinuity = t0
      ? (
          await db
            .select({
              lawId: laws.id,
              title: laws.title,
              programName: laws.fiscalProgramName,
              fiscalKind: laws.fiscalKind,
              fiscalAmount: laws.fiscalAmount,
              enactedTick: laws.enactedTick,
              lastRenewedTick: laws.lastRenewedTick,
              programActive: laws.programActive,
            })
            .from(laws)
            .where(
              and(
                sql`${laws.fiscalKind} IN ('mandatory', 'spend_recurring')`,
                sql`${laws.enactedTick} IS NOT NULL AND ${laws.enactedTick} >= ${t0.tick}`,
              ),
            )
        ).map((p) => {
          const base = typeof p.fiscalAmount === 'number' && Number.isFinite(p.fiscalAmount) ? p.fiscalAmount : 0;
          const perDay = p.fiscalKind === 'mandatory' && p.enactedTick !== null
            ? mandatoryEffectiveAmount(base, p.enactedTick, currentTickNumber, rc.mandatoryGrowthPctAnnual)
            : base;
          return {
            lawId: p.lawId,
            name: p.programName ?? p.title,
            perDay,
            status: programContinuityStatus(p),
          };
        })
      : [];

    /* ---- Mix divergence score -------------------------------------------
       L1 distance between normalized category-share vectors. Sim side maps
       fiscalProgramName -> MTS category via PROGRAM_TO_MTS_CATEGORY (v1
       covers Social Security / Medicare / National Defense / Net Interest --
       everything else funnels into UNMAPPED_CATEGORY_LABEL on both sides so
       an incomplete mapping never artificially shrinks the score). */
    const simShares = categoryShares(
      sim.spendingByCategory.map((c) => ({ name: c.name, amount: c.perDay })),
      (name) => PROGRAM_TO_MTS_CATEGORY[name] ?? null,
    );
    const realityShares = reality
      ? categoryShares(
          reality.spendingByCategory.map((c) => ({ name: c.name, amount: c.fytd })),
          (name) => (Object.values(PROGRAM_TO_MTS_CATEGORY).includes(name) ? name : null),
        )
      : new Map<string, number>();
    const mixDivergence = l1CategoryDistance(simShares, realityShares);

    res.json({
      success: true,
      data: {
        t0,
        sim,
        reality,
        series: { sim: simSeries, reality: realitySeries },
        mixDivergence,
        programContinuity,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
