import { Router } from 'express';
import { db } from '@db/connection';
import {
  courtCases,
  courtCaseEvents,
  courtCaseVotes,
  judicialReviews,
  judicialVotes,
  laws,
  agents,
  positions,
  tickLog,
} from '@db/schema/index';
import { AppError } from '@core/server/middleware/errorHandler';
import { eq, desc, asc, and, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { ACTIVE_CASE_STATUSES } from '@core/server/lib/courtMath';

/* Phase 4 judicial arc — case-centric court API over court_cases.
   judicial_reviews stopped receiving writes when the Phase 10 state
   machine shipped; its 459 historical rulings stay readable via the
   read-only /court/archive endpoint below.                            */

const router = Router();

const CASE_STATUSES = ['filed', 'docketed', 'argued', 'deliberating', 'decided', 'dismissed'] as const;

/* Petitioner/respondent both live in agents — alias to join twice */
const petitionerAgents = alias(agents, 'petitioner');
const respondentAgents = alias(agents, 'respondent');

const caseListSelection = {
  id: courtCases.id,
  caseNumber: courtCases.caseNumber,
  caption: courtCases.caption,
  caseType: courtCases.caseType,
  status: courtCases.status,
  lawId: courtCases.lawId,
  dealId: courtCases.dealId,
  petitionerId: courtCases.petitionerId,
  respondentId: courtCases.respondentId,
  questionPresented: courtCases.questionPresented,
  filedTick: courtCases.filedTick,
  hearingTick: courtCases.hearingTick,
  decidedTick: courtCases.decidedTick,
  outcome: courtCases.outcome,
  votesFor: courtCases.votesFor,
  votesAgainst: courtCases.votesAgainst,
  createdAt: courtCases.createdAt,
  decidedAt: courtCases.decidedAt,
  petitionerName: petitionerAgents.displayName,
  petitionerAvatarConfig: petitionerAgents.avatarConfig,
  respondentName: respondentAgents.displayName,
  respondentAvatarConfig: respondentAgents.avatarConfig,
  lawTitle: laws.title,
};

/* GET /api/court/cases -- Docket, newest first, joined party names (no N+1) */
router.get('/court/cases', async (req, res, next) => {
  try {
    const { status } = req.query as { status?: string };

    if (status && !(CASE_STATUSES as readonly string[]).includes(status)) {
      throw new AppError(400, `Invalid status. Must be one of: ${CASE_STATUSES.join(', ')}`);
    }

    const joined = db
      .select(caseListSelection)
      .from(courtCases)
      .leftJoin(petitionerAgents, eq(courtCases.petitionerId, petitionerAgents.id))
      .leftJoin(respondentAgents, eq(courtCases.respondentId, respondentAgents.id))
      .leftJoin(laws, eq(courtCases.lawId, laws.id));

    const rows = status
      ? await joined.where(eq(courtCases.status, status)).orderBy(desc(courtCases.createdAt)).limit(100)
      : await joined.orderBy(desc(courtCases.createdAt)).limit(100);

    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

/* GET /api/court/stats -- Status counts + active docket + current sim day.
   currentTick is the completed tick_log count — the same derivation the
   fiscal endpoints use (government.ts) and the base the sim increments
   from, so Day math lines up with filedTick/hearingTick/decidedTick.    */
router.get('/court/stats', async (_req, res, next) => {
  try {
    const [statusRows, [aggRow], [tickCountRow]] = await Promise.all([
      db
        .select({ status: courtCases.status, count: sql<number>`COUNT(*)` })
        .from(courtCases)
        .groupBy(courtCases.status),
      db
        .select({
          total: sql<number>`COUNT(*)`,
          struckDown: sql<number>`COUNT(*) FILTER (WHERE ${courtCases.outcome} = 'struck_down')`,
          upheld: sql<number>`COUNT(*) FILTER (WHERE ${courtCases.outcome} = 'upheld')`,
          disputes: sql<number>`COUNT(*) FILTER (WHERE ${courtCases.caseType} = 'agent_dispute')`,
        })
        .from(courtCases),
      db
        .select({ completed: sql<number>`COUNT(*) FILTER (WHERE ${tickLog.completedAt} IS NOT NULL)` })
        .from(tickLog),
    ]);

    const byStatus: Record<string, number> = {};
    for (const s of CASE_STATUSES) byStatus[s] = 0;
    for (const row of statusRows) byStatus[row.status] = Number(row.count);

    const activeDocket = (ACTIVE_CASE_STATUSES as readonly string[]).reduce(
      (sum, s) => sum + (byStatus[s] ?? 0),
      0,
    );

    res.json({
      success: true,
      data: {
        total: Number(aggRow?.total ?? 0),
        byStatus,
        activeDocket,
        decided: byStatus.decided ?? 0,
        dismissed: byStatus.dismissed ?? 0,
        struckDown: Number(aggRow?.struckDown ?? 0),
        upheld: Number(aggRow?.upheld ?? 0),
        disputes: Number(aggRow?.disputes ?? 0),
        currentTick: Number(tickCountRow?.completed ?? 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

/* GET /api/court/archive -- Read-only legacy judicial_reviews (459 historical
   rulings). The old same-tick review system stopped receiving writes with
   Phase 4; this endpoint preserves its record on the site. No N+1: one
   joined reviews query + one grouped vote-count query.                     */
router.get('/court/archive', async (_req, res, next) => {
  try {
    const [reviews, voteAgg] = await Promise.all([
      db
        .select({
          id: judicialReviews.id,
          lawId: judicialReviews.lawId,
          status: judicialReviews.status,
          ruling: judicialReviews.ruling,
          createdAt: judicialReviews.createdAt,
          ruledAt: judicialReviews.ruledAt,
          lawTitle: laws.title,
          lawIsActive: laws.isActive,
        })
        .from(judicialReviews)
        .leftJoin(laws, eq(judicialReviews.lawId, laws.id))
        .orderBy(desc(judicialReviews.createdAt)),
      db
        .select({
          reviewId: judicialVotes.reviewId,
          constitutionalCount: sql<number>`COUNT(*) FILTER (WHERE ${judicialVotes.vote} = 'constitutional')`,
          unconstitutionalCount: sql<number>`COUNT(*) FILTER (WHERE ${judicialVotes.vote} = 'unconstitutional')`,
          totalVotes: sql<number>`COUNT(*)`,
        })
        .from(judicialVotes)
        .groupBy(judicialVotes.reviewId),
    ]);

    const votesByReview = new Map(voteAgg.map((v) => [v.reviewId, v]));

    const enriched = reviews.map((review) => {
      const votes = votesByReview.get(review.id);
      return {
        ...review,
        lawTitle: review.lawTitle ?? 'Unknown Law',
        constitutionalCount: Number(votes?.constitutionalCount ?? 0),
        unconstitutionalCount: Number(votes?.unconstitutionalCount ?? 0),
        totalVotes: Number(votes?.totalVotes ?? 0),
      };
    });

    res.json({ success: true, data: enriched });
  } catch (err) {
    next(err);
  }
});

/* GET /api/court/cases/:id -- Case + ordered record + enriched votes + bench */
router.get('/court/cases/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const [caseRow] = await db
      .select({
        ...caseListSelection,
        filingText: courtCases.filingText,
        hearingEventId: courtCases.hearingEventId,
        majorityOpinion: courtCases.majorityOpinion,
        majorityAuthorId: courtCases.majorityAuthorId,
        majorityCitations: courtCases.majorityCitations,
        dissentOpinion: courtCases.dissentOpinion,
        dissentAuthorId: courtCases.dissentAuthorId,
        dissentCitations: courtCases.dissentCitations,
      })
      .from(courtCases)
      .leftJoin(petitionerAgents, eq(courtCases.petitionerId, petitionerAgents.id))
      .leftJoin(respondentAgents, eq(courtCases.respondentId, respondentAgents.id))
      .leftJoin(laws, eq(courtCases.lawId, laws.id))
      .where(eq(courtCases.id, id))
      .limit(1);

    if (!caseRow) throw new AppError(404, 'Case not found');

    const [lawRow] = caseRow.lawId
      ? await db
          .select({ id: laws.id, title: laws.title, enactedDate: laws.enactedDate, isActive: laws.isActive })
          .from(laws)
          .where(eq(laws.id, caseRow.lawId))
          .limit(1)
      : [undefined];

    const [events, votes, benchRows] = await Promise.all([
      /* The record — ordered by sim day, then insertion order within a day */
      db
        .select({
          id: courtCaseEvents.id,
          tick: courtCaseEvents.tick,
          type: courtCaseEvents.type,
          actorId: courtCaseEvents.actorId,
          role: courtCaseEvents.role,
          content: courtCaseEvents.content,
          createdAt: courtCaseEvents.createdAt,
          actorName: agents.displayName,
          actorAvatarConfig: agents.avatarConfig,
        })
        .from(courtCaseEvents)
        .leftJoin(agents, eq(courtCaseEvents.actorId, agents.id))
        .where(eq(courtCaseEvents.caseId, id))
        .orderBy(asc(courtCaseEvents.tick), asc(courtCaseEvents.createdAt)),
      /* Votes enriched with justice identity */
      db
        .select({
          id: courtCaseVotes.id,
          justiceId: courtCaseVotes.justiceId,
          vote: courtCaseVotes.vote,
          reasoning: courtCaseVotes.reasoning,
          citedArticles: courtCaseVotes.citedArticles,
          castAt: courtCaseVotes.castAt,
          justiceName: agents.displayName,
          justiceAvatarConfig: agents.avatarConfig,
          justiceAlignment: agents.alignment,
        })
        .from(courtCaseVotes)
        .leftJoin(agents, eq(courtCaseVotes.justiceId, agents.id))
        .where(eq(courtCaseVotes.caseId, id))
        .orderBy(asc(courtCaseVotes.castAt)),
      /* Sitting bench — earliest-appointed active justice is the chief,
         matching the Phase 10 tick state machine exactly */
      db
        .select({
          agentId: positions.agentId,
          startDate: positions.startDate,
          displayName: agents.displayName,
          avatarConfig: agents.avatarConfig,
          alignment: agents.alignment,
        })
        .from(positions)
        .innerJoin(agents, eq(positions.agentId, agents.id))
        .where(
          and(
            eq(positions.isActive, true),
            eq(positions.type, 'supreme_justice'),
            eq(agents.isActive, true),
          ),
        )
        .orderBy(asc(positions.startDate)),
    ]);

    const bench = benchRows.map((j, idx) => ({
      id: j.agentId,
      displayName: j.displayName,
      avatarConfig: j.avatarConfig,
      alignment: j.alignment,
      isChief: idx === 0,
    }));

    res.json({
      success: true,
      data: {
        ...caseRow,
        law: lawRow ?? null,
        events,
        votes,
        bench,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
