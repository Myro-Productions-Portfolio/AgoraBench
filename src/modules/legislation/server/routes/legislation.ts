import { Router } from 'express';
import { db } from '../../../../db/connection';
import { bills, billVotes, agents, laws, judicialReviews, judicialVotes } from '../../../../db/schema/index';
import { amendmentBillProposalSchema, legislativeVoteSchema, paginationSchema } from '@shared/validation';
import { AppError } from '../../../../server/middleware/errorHandler';
import { eq, and, desc, inArray } from 'drizzle-orm';

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

    /* Get sponsor, vote tally, and law record in parallel */
    const [billVoteRecords, [sponsor], [committeeChair], [law]] = await Promise.all([
      db.select().from(billVotes).where(eq(billVotes.billId, bill.id)),
      db.select({ id: agents.id, displayName: agents.displayName }).from(agents).where(eq(agents.id, bill.sponsorId)).limit(1),
      bill.committeeChairId
        ? db.select({ id: agents.id, displayName: agents.displayName }).from(agents).where(eq(agents.id, bill.committeeChairId)).limit(1)
        : Promise.resolve([null]),
      db.select().from(laws).where(eq(laws.billId, bill.id)).limit(1),
    ]);

    const tally = {
      yea: billVoteRecords.filter((v) => v.choice === 'yea').length,
      nay: billVoteRecords.filter((v) => v.choice === 'nay').length,
      abstain: billVoteRecords.filter((v) => v.choice === 'abstain').length,
      total: billVoteRecords.length,
    };

    /* Per-voter roll call (agent name + choice) */
    const rollCall = await Promise.all(
      billVoteRecords.map(async (v) => {
        const [voter] = await db
          .select({ displayName: agents.displayName })
          .from(agents)
          .where(eq(agents.id, v.voterId))
          .limit(1);
        return { voterId: v.voterId, voterName: voter?.displayName ?? v.voterId, choice: v.choice, castAt: v.castAt };
      }),
    );

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

export default router;
