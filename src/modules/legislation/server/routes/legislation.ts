import { Router } from 'express';
import { db } from '@db/connection';
import { bills, billVotes, agents, laws, judicialReviews, judicialVotes, billAmendments, lobbyingEvents, agentDeals, agentStatements, activityEvents, agentDecisions } from '@db/schema/index';
import { amendmentBillProposalSchema, legislativeVoteSchema, paginationSchema } from '@shared/validation';
import { AppError } from '@core/server/middleware/errorHandler';
import { eq, and, desc, inArray, like, sql } from 'drizzle-orm';

/* Escape LIKE wildcards so a bill title is matched literally (Postgres default escape char is backslash) */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const router = Router();

async function enrichBillsWithSponsorAndTally(rows: (typeof bills.$inferSelect)[]) {
  return Promise.all(
    rows.map(async (bill) => {
      const [sponsor] = await db
        .select({ displayName: agents.displayName })
        .from(agents)
        .where(eq(agents.id, bill.sponsorId))
        .limit(1);

      const billVoteRecords = await db
        .select()
        .from(billVotes)
        .where(eq(billVotes.billId, bill.id));

      const tally = {
        yea: billVoteRecords.filter((v) => v.choice === 'yea').length,
        nay: billVoteRecords.filter((v) => v.choice === 'nay').length,
        abstain: billVoteRecords.filter((v) => v.choice === 'abstain').length,
        total: billVoteRecords.length,
      };

      return {
        ...bill,
        sponsorDisplayName: sponsor?.displayName ?? bill.sponsorId,
        tally,
      };
    }),
  );
}

/* GET /api/legislation/active -- List active bills */
router.get('/legislation/active', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const offset = (page - 1) * limit;

    const results = await db
      .select()
      .from(bills)
      .where(eq(bills.status, 'floor'))
      .limit(limit)
      .offset(offset);

    const enriched = await enrichBillsWithSponsorAndTally(results);

    res.json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
});

/* GET /api/legislation -- List all bills */
router.get('/legislation', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const offset = (page - 1) * limit;

    const results = await db.select().from(bills).limit(limit).offset(offset);

    const enriched = await enrichBillsWithSponsorAndTally(results);

    res.json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
});

/* GET /api/legislation/:id -- Get bill by ID */
router.get('/legislation/:id', async (req, res, next) => {
  try {
    const [bill] = await db
      .select()
      .from(bills)
      .where(eq(bills.id, req.params.id))
      .limit(1);

    if (!bill) {
      throw new AppError(404, 'Bill not found');
    }

    /* Get roll-call rows (single votes⋈agents join), sponsor, and law record in parallel */
    const [rollRows, [sponsor], [committeeChair], [law]] = await Promise.all([
      db
        .select({
          voterId: billVotes.voterId,
          voterName: agents.displayName,
          choice: billVotes.choice,
          castAt: billVotes.castAt,
        })
        .from(billVotes)
        .innerJoin(agents, eq(billVotes.voterId, agents.id))
        .where(eq(billVotes.billId, bill.id)),
      db.select({ id: agents.id, displayName: agents.displayName }).from(agents).where(eq(agents.id, bill.sponsorId)).limit(1),
      bill.committeeChairId
        ? db.select({ id: agents.id, displayName: agents.displayName }).from(agents).where(eq(agents.id, bill.committeeChairId)).limit(1)
        : Promise.resolve([null]),
      db.select().from(laws).where(eq(laws.billId, bill.id)).limit(1),
    ]);

    const tally = {
      yea: rollRows.filter((v) => v.choice === 'yea').length,
      nay: rollRows.filter((v) => v.choice === 'nay').length,
      abstain: rollRows.filter((v) => v.choice === 'abstain').length,
      total: rollRows.length,
    };

    /* Per-voter reasoning enrichment. Two sources, both optional — a mid-life DB
       where neither matches simply renders reasoning:null / followedWhip:false.
       (a) vote activityEvents metadata (new votes carry reasoning + followedWhip),
       (b) fallback for historical votes: agentDecisions phase='bill_voting' whose
           contextMessage quotes the bill title, nearest to castAt within ±30 min. */
    const reasoningMap = new Map<string, { reasoning: string | null; followedWhip: boolean }>();
    if (rollRows.length > 0) {
      try {
        /* Source (a): vote activityEvents metadata */
        const voteEvents = await db
          .select({ agentId: activityEvents.agentId, metadata: activityEvents.metadata })
          .from(activityEvents)
          .where(and(
            eq(activityEvents.type, 'vote'),
            like(activityEvents.metadata, `%"billId":"${bill.id}"%`),
          ))
          .orderBy(desc(activityEvents.createdAt))
          .limit(rollRows.length * 3);

        for (const ev of voteEvents) {
          if (!ev.agentId || reasoningMap.has(ev.agentId)) continue; /* keep newest per voter */
          try {
            const meta = JSON.parse(ev.metadata) as Record<string, unknown>;
            const reasoning = typeof meta['reasoning'] === 'string' && meta['reasoning'].trim().length > 0
              ? meta['reasoning'].slice(0, 500)
              : null;
            reasoningMap.set(ev.agentId, { reasoning, followedWhip: meta['followedWhip'] === true });
          } catch {
            /* unparseable metadata row — skip */
          }
        }

        /* Source (b): agentDecisions fallback for voters still lacking reasoning.
           Whip-forced votes never had an LLM call, so skip followedWhip entries. */
        const needFallback = rollRows
          .filter((r) => {
            const e = reasoningMap.get(r.voterId);
            return !e?.reasoning && !e?.followedWhip;
          })
          .map((r) => r.voterId);

        if (needFallback.length > 0) {
          const decisionRows = await db
            .select({
              agentId: agentDecisions.agentId,
              parsedReasoning: agentDecisions.parsedReasoning,
              createdAt: agentDecisions.createdAt,
            })
            .from(agentDecisions)
            .where(and(
              eq(agentDecisions.phase, 'bill_voting'),
              eq(agentDecisions.success, true),
              inArray(agentDecisions.agentId, needFallback),
              like(agentDecisions.contextMessage, `%${escapeLike(bill.title)}%`),
            ))
            .orderBy(desc(agentDecisions.createdAt))
            .limit(needFallback.length * 3);

          const THIRTY_MIN_MS = 30 * 60 * 1000;
          for (const row of rollRows) {
            if (reasoningMap.get(row.voterId)?.reasoning || reasoningMap.get(row.voterId)?.followedWhip) continue;
            const castMs = row.castAt ? new Date(row.castAt).getTime() : null;
            if (castMs === null) continue;
            let best: string | null = null;
            let bestDelta = Infinity;
            for (const d of decisionRows) {
              if (d.agentId !== row.voterId || !d.parsedReasoning) continue;
              const delta = Math.abs(new Date(d.createdAt).getTime() - castMs);
              if (delta < bestDelta) {
                bestDelta = delta;
                best = d.parsedReasoning;
              }
            }
            if (best !== null && bestDelta <= THIRTY_MIN_MS) {
              const existing = reasoningMap.get(row.voterId);
              reasoningMap.set(row.voterId, {
                reasoning: best.slice(0, 500),
                followedWhip: existing?.followedWhip ?? false,
              });
            }
          }
        }
      } catch (enrichErr) {
        /* Enrichment is best-effort — roll call still renders without reasoning */
        console.warn('[LEGISLATION] Roll-call reasoning enrichment failed:', enrichErr);
      }
    }

    const rollCall = rollRows.map((r) => {
      const e = reasoningMap.get(r.voterId);
      return {
        voterId: r.voterId,
        voterName: r.voterName ?? r.voterId,
        choice: r.choice,
        castAt: r.castAt,
        reasoning: e?.reasoning ?? null,
        followedWhip: e?.followedWhip ?? false,
      };
    });

    res.json({
      success: true,
      data: {
        ...bill,
        sponsorDisplayName: sponsor?.displayName ?? bill.sponsorId,
        committeeChairName: committeeChair?.displayName ?? null,
        law: law ?? null,
        tally,
        rollCall,
      },
    });
  } catch (error) {
    next(error);
  }
});

/* POST /api/legislation/propose -- Propose a new bill (original or amendment) */
router.post('/legislation/propose', async (req, res, next) => {
  try {
    const data = amendmentBillProposalSchema.parse(req.body);

    /* Verify sponsor exists */
    const [sponsor] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, data.sponsorId))
      .limit(1);

    if (!sponsor) {
      throw new AppError(404, 'Sponsor agent not found');
    }

    /* Validate amendsLawId if amendment */
    let amendsLawId: string | undefined;
    if (data.billType === 'amendment' && data.amendsLawId) {
      const [law] = await db
        .select()
        .from(laws)
        .where(eq(laws.id, data.amendsLawId))
        .limit(1);

      if (!law) {
        throw new AppError(404, 'Law to amend not found');
      }
      amendsLawId = law.id;
    }

    const [bill] = await db
      .insert(bills)
      .values({
        title: data.title,
        summary: data.summary,
        fullText: data.fullText,
        sponsorId: data.sponsorId,
        coSponsorIds: JSON.stringify(data.coSponsorIds || []),
        committee: data.committee,
        billType: data.billType ?? 'original',
        amendsLawId: amendsLawId ?? undefined,
      })
      .returning();

    res.status(201).json({
      success: true,
      data: bill,
      message: 'Bill proposed successfully',
    });
  } catch (error) {
    next(error);
  }
});

/* POST /api/legislation/vote -- Vote on a bill */
router.post('/legislation/vote', async (req, res, next) => {
  try {
    const data = legislativeVoteSchema.parse(req.body);

    /* Verify bill exists and is on the floor */
    const [bill] = await db
      .select()
      .from(bills)
      .where(eq(bills.id, data.billId))
      .limit(1);

    if (!bill) {
      throw new AppError(404, 'Bill not found');
    }

    if (bill.status !== 'floor') {
      throw new AppError(400, 'Bill is not currently on the floor for voting');
    }

    /* Check for duplicate vote */
    const existing = await db
      .select()
      .from(billVotes)
      .where(
        and(
          eq(billVotes.billId, data.billId),
          eq(billVotes.voterId, data.voterId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new AppError(409, 'Agent has already voted on this bill');
    }

    const [vote] = await db
      .insert(billVotes)
      .values({
        billId: data.billId,
        voterId: data.voterId,
        choice: data.choice,
      })
      .returning();

    res.status(201).json({
      success: true,
      data: vote,
      message: 'Legislative vote cast successfully',
    });
  } catch (error) {
    next(error);
  }
});

/* GET /api/laws -- List all enacted laws (enriched) */
router.get('/laws', async (_req, res, next) => {
  try {
    const rawLaws = await db
      .select()
      .from(laws)
      .orderBy(desc(laws.enactedDate));

    const lawIds = rawLaws.map((l) => l.id);
    const reviewRows = lawIds.length > 0
      ? await db
          .select({
            lawId: judicialReviews.lawId,
            id: judicialReviews.id,
            status: judicialReviews.status,
          })
          .from(judicialReviews)
          .where(inArray(judicialReviews.lawId, lawIds))
      : [];
    const reviewMap = new Map(reviewRows.map((r) => [r.lawId, { id: r.id, status: r.status }]));

    const enriched = await Promise.all(
      rawLaws.map(async (law) => {
        const [bill] = await db
          .select({ id: bills.id, committee: bills.committee, sponsorId: bills.sponsorId })
          .from(bills)
          .where(eq(bills.id, law.billId))
          .limit(1);

        const [sponsor] = bill
          ? await db
              .select({ displayName: agents.displayName, avatarConfig: agents.avatarConfig, alignment: agents.alignment })
              .from(agents)
              .where(eq(agents.id, bill.sponsorId))
              .limit(1)
          : [null];

        const review = reviewMap.get(law.id) ?? null;

        return {
          ...law,
          committee: bill?.committee ?? null,
          sourceBillId: bill?.id ?? null,
          sponsorId: bill?.sponsorId ?? null,
          sponsorDisplayName: sponsor?.displayName ?? null,
          sponsorAvatarConfig: sponsor?.avatarConfig ?? null,
          sponsorAlignment: sponsor?.alignment ?? null,
          reviewStatus: review?.status ?? null,
          reviewId: review?.id ?? null,
        };
      }),
    );

    res.json({ success: true, data: enriched });
  } catch (error) {
    next(error);
  }
});

/* GET /api/laws/:id -- Get a single law with full enrichment */
router.get('/laws/:id', async (req, res, next) => {
  try {
    const [law] = await db
      .select()
      .from(laws)
      .where(eq(laws.id, req.params.id))
      .limit(1);

    if (!law) {
      throw new AppError(404, 'Law not found');
    }

    /* Parallel: source bill + amendment bills */
    const [[bill], amendmentBills] = await Promise.all([
      db
        .select({ id: bills.id, title: bills.title, committee: bills.committee, status: bills.status, introducedAt: bills.introducedAt, sponsorId: bills.sponsorId })
        .from(bills)
        .where(eq(bills.id, law.billId))
        .limit(1),
      db
        .select({ id: bills.id, title: bills.title, status: bills.status, introducedAt: bills.introducedAt })
        .from(bills)
        .where(eq(bills.amendsLawId, law.id)),
    ]);

    const [sponsor] = bill
      ? await db
          .select({ id: agents.id, displayName: agents.displayName, avatarConfig: agents.avatarConfig, alignment: agents.alignment })
          .from(agents)
          .where(eq(agents.id, bill.sponsorId))
          .limit(1)
      : [null];

    res.json({
      success: true,
      data: {
        ...law,
        sourceBill: bill
          ? { id: bill.id, title: bill.title, committee: bill.committee, status: bill.status, introducedAt: bill.introducedAt }
          : null,
        sponsor: sponsor
          ? { id: sponsor.id, displayName: sponsor.displayName, avatarConfig: sponsor.avatarConfig, alignment: sponsor.alignment }
          : null,
        amendmentBills,
      },
    });
  } catch (error) {
    next(error);
  }
});

/* GET /api/legislation/:id/judicial-reviews -- Get judicial review records for a law linked to a bill */
router.get('/legislation/:id/judicial-reviews', async (req, res, next) => {
  try {
    const [bill] = await db
      .select()
      .from(bills)
      .where(eq(bills.id, req.params.id))
      .limit(1);

    if (!bill) {
      throw new AppError(404, 'Bill not found');
    }

    /* Find the law linked to this bill */
    const [law] = await db
      .select()
      .from(laws)
      .where(eq(laws.billId, bill.id))
      .limit(1);

    if (!law) {
      return res.json({ success: true, data: [] });
    }

    /* Get all judicial reviews for this law */
    const reviews = await db
      .select()
      .from(judicialReviews)
      .where(eq(judicialReviews.lawId, law.id))
      .orderBy(desc(judicialReviews.createdAt));

    /* Enrich with votes */
    const enrichedReviews = await Promise.all(
      reviews.map(async (review) => {
        const votes = await db
          .select()
          .from(judicialVotes)
          .where(eq(judicialVotes.reviewId, review.id));
        return { ...review, votes };
      }),
    );

    res.json({ success: true, data: enrichedReviews });
  } catch (error) {
    next(error);
  }
});

/* GET /api/legislation/:id/amendments -- Floor amendments for a bill */
router.get('/legislation/:id/amendments', async (req, res, next) => {
  try {
    const rows = await db
      .select({
        id: billAmendments.id,
        billId: billAmendments.billId,
        proposerId: billAmendments.proposerId,
        proposerName: agents.displayName,
        amendmentText: billAmendments.amendmentText,
        type: billAmendments.type,
        status: billAmendments.status,
        reasoning: billAmendments.reasoning,
        votesFor: billAmendments.votesFor,
        votesAgainst: billAmendments.votesAgainst,
        proposedAt: billAmendments.proposedAt,
        resolvedAt: billAmendments.resolvedAt,
      })
      .from(billAmendments)
      .innerJoin(agents, eq(billAmendments.proposerId, agents.id))
      .where(eq(billAmendments.billId, req.params.id))
      .orderBy(
        sql`CASE WHEN ${billAmendments.status} = 'pending' THEN 0 WHEN ${billAmendments.status} = 'accepted' THEN 1 ELSE 2 END`,
        desc(billAmendments.proposedAt),
      );

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

/* GET /api/legislation/:id/lobbying -- Lobbying events for a bill */
router.get('/legislation/:id/lobbying', async (req, res, next) => {
  try {
    const rows = await db
      .select({
        id: lobbyingEvents.id,
        lobbyistId: lobbyingEvents.lobbyistId,
        lobbyistName: sql<string>`lobbyist.display_name`,
        targetId: lobbyingEvents.targetId,
        targetName: sql<string>`target.display_name`,
        billId: lobbyingEvents.billId,
        argument: lobbyingEvents.argument,
        desiredVote: lobbyingEvents.desiredVote,
        positionShifted: lobbyingEvents.positionShifted,
        sentimentDelta: lobbyingEvents.sentimentDelta,
        createdAt: lobbyingEvents.createdAt,
      })
      .from(lobbyingEvents)
      .innerJoin(sql`agents lobbyist`, sql`lobbyist.id = ${lobbyingEvents.lobbyistId}`)
      .innerJoin(sql`agents target`, sql`target.id = ${lobbyingEvents.targetId}`)
      .where(eq(lobbyingEvents.billId, req.params.id))
      .orderBy(desc(lobbyingEvents.createdAt))
      .limit(50);

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

/* GET /api/legislation/:id/deals -- Agent deals for a bill */
router.get('/legislation/:id/deals', async (req, res, next) => {
  try {
    const rows = await db
      .select({
        id: agentDeals.id,
        initiatorId: agentDeals.initiatorId,
        initiatorName: sql<string>`initiator.display_name`,
        targetId: agentDeals.targetId,
        targetName: sql<string>`target.display_name`,
        billId: agentDeals.billId,
        initiatorCommitment: agentDeals.initiatorCommitment,
        targetCommitment: agentDeals.targetCommitment,
        status: agentDeals.status,
        initiatorHonored: agentDeals.initiatorHonored,
        targetHonored: agentDeals.targetHonored,
        expiresAt: agentDeals.expiresAt,
        createdAt: agentDeals.createdAt,
        resolvedAt: agentDeals.resolvedAt,
      })
      .from(agentDeals)
      .innerJoin(sql`agents initiator`, sql`initiator.id = ${agentDeals.initiatorId}`)
      .innerJoin(sql`agents target`, sql`target.id = ${agentDeals.targetId}`)
      .where(eq(agentDeals.billId, req.params.id))
      .orderBy(desc(agentDeals.createdAt))
      .limit(50);

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

/* GET /api/legislation/:id/statements -- Public statements triggered by a bill */
router.get('/legislation/:id/statements', async (req, res, next) => {
  try {
    const rows = await db
      .select({
        id: agentStatements.id,
        agentId: agentStatements.agentId,
        agentName: agents.displayName,
        statementText: agentStatements.statementText,
        triggerType: agentStatements.triggerType,
        approvalDelta: agentStatements.approvalDelta,
        createdAt: agentStatements.createdAt,
      })
      .from(agentStatements)
      .innerJoin(agents, eq(agentStatements.agentId, agents.id))
      .where(eq(agentStatements.triggerBillId, req.params.id))
      .orderBy(desc(agentStatements.createdAt))
      .limit(20);

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

export default router;
