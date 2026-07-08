import { Router } from 'express';
import { db } from '@db/connection';
import { positions, agents, bills, parties, elections, laws, governmentSettings, fiscalTickSummaries, tickLog, activityEvents, courtCases } from '@db/schema/index';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { getRuntimeConfig } from '@core/server/runtimeConfig.js';
import { dailyCitizenRevenue, ticksUntilLapse, ticksUntilNextBudgetSession } from '@core/server/lib/fiscalMath.js';
import { ACTIVE_CASE_STATUSES } from '@core/server/lib/courtMath.js';

const router = Router();

/* GET /api/government/officials -- Current office holders */
router.get('/government/officials', async (_req, res, next) => {
  try {
    const activePositions = await db
      .select()
      .from(positions)
      .where(eq(positions.isActive, true));

    /* Join with agent data */
    const officials = await Promise.all(
      activePositions.map(async (pos) => {
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.id, pos.agentId))
          .limit(1);

        return {
          position: pos,
          agent: agent || null,
        };
      }),
    );

    res.json({ success: true, data: officials });
  } catch (error) {
    next(error);
  }
});

/* GET /api/government/overview -- Dashboard overview */
router.get('/government/overview', async (_req, res, next) => {
  try {
    const allPositions = await db
      .select()
      .from(positions)
      .where(eq(positions.isActive, true));

    const president = allPositions.find((p) => p.type === 'president');
    let presidentAgent = null;

    if (president) {
      const [agent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, president.agentId))
        .limit(1);
      presidentAgent = agent;
    }

    const allAgents = await db.select().from(agents);
    const allParties = await db.select().from(parties).where(eq(parties.isActive, true));
    const allLaws = await db.select().from(laws).where(eq(laws.isActive, true));
    const allElections = await db.select().from(elections);
    const activeBills = await db.select().from(bills).where(eq(bills.status, 'floor'));

    const congressMembers = allPositions.filter((p) => p.type === 'congress_member');
    const justices = allPositions.filter((p) => p.type === 'supreme_justice');

    /* Chief justice = earliest-appointed sitting justice (matches agentTick.ts
       Phase 10's bench-ordering convention — same rule, no election for it). */
    const benchByAppointment = [...justices].sort(
      (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    );
    const chiefJusticeAgent = benchByAppointment.length > 0
      ? allAgents.find((a) => a.id === benchByAppointment[0].agentId) || null
      : null;

    /* Active docket size — mirrors /api/court/stats' activeDocket derivation
       (same ACTIVE_CASE_STATUSES set) so the dashboard card and the courts
       page never disagree on what "active" means. */
    const [activeCasesRow] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(courtCases)
      .where(inArray(courtCases.status, ACTIVE_CASE_STATUSES as unknown as string[]));
    const activeCases = Number(activeCasesRow?.count ?? 0);

    /* Total legislative seats derives from runtime config (admin-configurable),
       not a hardcoded literal. If the roster somehow exceeds the configured
       seat count, report the actual filled count so filled never exceeds total. */
    const rc = getRuntimeConfig();
    const totalSeats = Math.max(rc.congressSeats, congressMembers.length);

    /* Get real treasury balance */
    const [govSettings] = await db.select().from(governmentSettings).limit(1);
    const treasuryBalance = govSettings?.treasuryBalance ?? 50000;

    const overview = {
      executive: {
        president: presidentAgent,
        cabinet: allPositions
          .filter((p) => p.type === 'cabinet_secretary')
          .map((p) => ({
            position: p,
            agent: allAgents.find((a) => a.id === p.agentId) || null,
          })),
        termEndDate: president?.endDate || null,
      },
      legislative: {
        totalSeats,
        filledSeats: congressMembers.length,
        activeBills: activeBills.length,
        pendingVotes: 0,
      },
      judicial: {
        supremeCourtJustices: justices.length,
        activeCases,
        chiefJustice: chiefJusticeAgent,
      },
      stats: {
        totalAgents: allAgents.length,
        totalParties: allParties.length,
        totalLaws: allLaws.length,
        totalElections: allElections.length,
        treasuryBalance,
      },
    };

    res.json({ success: true, data: overview });
  } catch (error) {
    next(error);
  }
});

/* GET /api/government/budget -- Budget dashboard payload (Phase 3).
   Read-only public endpoint: treasury/tax state, per-tick fiscal series,
   active spending programs, budget-session countdown, recurring-spend cap.
   Empty states are expected on day one of a deploy (no summaries, no
   fiscal laws yet) — every list simply comes back []. */
router.get('/government/budget', async (_req, res, next) => {
  try {
    const rc = getRuntimeConfig();

    const [[govSettings], [tickCountRow], summaryRowsDesc, programRows, taxChangeRows] = await Promise.all([
      db.select().from(governmentSettings).limit(1),
      /* Completed-tick count — same COUNT the sim derives tickNumber from */
      db
        .select({ completed: sql<number>`COUNT(*) FILTER (WHERE ${tickLog.completedAt} IS NOT NULL)` })
        .from(tickLog),
      /* Last 200 per-tick fiscal summaries (chart series) */
      db
        .select({
          tickNumber: fiscalTickSummaries.tickNumber,
          revenue: fiscalTickSummaries.revenue,
          spending: fiscalTickSummaries.spending,
          treasuryEnd: fiscalTickSummaries.treasuryEnd,
          createdAt: fiscalTickSummaries.createdAt,
        })
        .from(fiscalTickSummaries)
        .orderBy(desc(fiscalTickSummaries.tickNumber))
        .limit(200),
      /* Active spending programs: a recurring appropriation IS the law row */
      db
        .select({
          lawId: laws.id,
          title: laws.title,
          programName: laws.fiscalProgramName,
          perTick: laws.fiscalAmount,
          enactedTick: laws.enactedTick,
          lastRenewedTick: laws.lastRenewedTick,
        })
        .from(laws)
        .where(and(eq(laws.isActive, true), eq(laws.programActive, true), eq(laws.fiscalKind, 'spend_recurring'))),
      /* Recent tax-rate changes enacted by revenue laws */
      db
        .select({ description: activityEvents.description, metadata: activityEvents.metadata, createdAt: activityEvents.createdAt })
        .from(activityEvents)
        .where(eq(activityEvents.type, 'tax_rate_changed'))
        .orderBy(desc(activityEvents.createdAt))
        .limit(10),
    ]);

    const treasuryBalance = govSettings?.treasuryBalance ?? 0;
    const taxRatePercent = govSettings?.taxRatePercent ?? 0;
    const lastBudgetSessionTick = govSettings?.lastBudgetSessionTick ?? 0;
    const currentTickNumber = Number(tickCountRow?.completed ?? 0);
    const revenuePerTick = dailyCitizenRevenue(rc.gdpAnnual, taxRatePercent);

    /* Ticks until the next payday (1 tick = 1 sim day). The next tick to run is
       currentTickNumber + 1, and payday fires when that tick is a multiple of
       payPeriodTicks. */
    const period = rc.payPeriodTicks > 0 ? rc.payPeriodTicks : 1;
    const nextTick = currentTickNumber + 1;
    const nextPaydayInTicks = (period - (nextTick % period)) % period; // 0 = next tick is payday
    const nextPayday = { inTicks: nextPaydayInTicks, estMs: nextPaydayInTicks * rc.tickIntervalMs };

    const series = summaryRowsDesc.slice().reverse(); // chronological for charts

    /* 30-day (30-tick) revenue/spending totals for the dashboard sidebar. */
    const last30 = summaryRowsDesc.slice(0, 30);
    const revenue30d = last30.reduce((acc, r) => acc + Number(r.revenue ?? 0), 0);
    const spending30d = last30.reduce((acc, r) => acc + Number(r.spending ?? 0), 0);

    const activePrograms = programRows.map((p) => ({
      lawId: p.lawId,
      name: p.programName ?? p.title,
      perTick: typeof p.perTick === 'number' && Number.isFinite(p.perTick) ? p.perTick : 0,
      enactedTick: p.enactedTick,
      lastRenewedTick: p.lastRenewedTick,
      ticksUntilLapse: ticksUntilLapse(currentTickNumber, p.enactedTick, p.lastRenewedTick, rc.budgetCycleTicks),
    }));

    const recurringPerTick = activePrograms.reduce((acc, p) => acc + p.perTick, 0);
    const capPerTick = Math.floor((revenuePerTick * rc.fiscalRecurringCapPctOfRevenue) / 100);

    const inTicks = ticksUntilNextBudgetSession(currentTickNumber, lastBudgetSessionTick, rc.budgetCycleTicks);
    const nextBudgetSession = inTicks !== null
      ? { inTicks, estMs: inTicks * rc.tickIntervalMs }
      : null;

    /* Parse tax-change metadata defensively — unparseable rows are skipped */
    const recentTaxChanges: { oldRate: number; newRate: number; delta: number; description: string; createdAt: Date }[] = [];
    for (const row of taxChangeRows) {
      try {
        const meta = JSON.parse(row.metadata) as Record<string, unknown>;
        const oldRate = typeof meta['oldRate'] === 'number' && Number.isFinite(meta['oldRate']) ? meta['oldRate'] : null;
        const newRate = typeof meta['newRate'] === 'number' && Number.isFinite(meta['newRate']) ? meta['newRate'] : null;
        if (oldRate === null || newRate === null) continue;
        recentTaxChanges.push({ oldRate, newRate, delta: newRate - oldRate, description: row.description, createdAt: row.createdAt });
      } catch { /* skip */ }
    }

    res.json({
      success: true,
      data: {
        treasuryBalance,
        taxRatePercent,
        currentTickNumber,
        fiscalEffectsEnabled: rc.fiscalEffectsEnabled,
        budgetCycleTicks: rc.budgetCycleTicks,
        expectedTickRevenue: revenuePerTick,
        gdpAnnual: rc.gdpAnnual,
        population: rc.agoraPopulation,
        payPeriodTicks: rc.payPeriodTicks,
        nextPayday,
        revenue30d,
        spending30d,
        series,
        activePrograms,
        nextBudgetSession,
        totals: { recurringPerTick, capPerTick },
        recentTaxChanges,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
