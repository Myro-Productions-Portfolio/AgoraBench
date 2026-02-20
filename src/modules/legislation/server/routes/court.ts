import { Router } from 'express';
import { db } from '@db/connection';
import { judicialReviews, judicialVotes, laws, agents } from '@db/schema/index';
import { AppError } from '@core/server/middleware/errorHandler';
import { eq, desc } from 'drizzle-orm';

const router = Router();

const VALID_STATUSES = ['pending', 'deliberating', 'upheld', 'struck_down'] as const;

/* GET /api/court/cases -- All judicial reviews, enriched */
router.get('/court/cases', async (req, res, next) => {
  try {
    const { status } = req.query as { status?: string };

    if (status && !(VALID_STATUSES as readonly string[]).includes(status)) {
      throw new AppError(400, `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    const allReviews = status
      ? await db.select().from(judicialReviews).where(eq(judicialReviews.status, status)).orderBy(desc(judicialReviews.createdAt))
      : await db.select().from(judicialReviews).orderBy(desc(judicialReviews.createdAt));

    const enriched = await Promise.all(
      allReviews.map(async (review) => {
        const [law] = await db
          .select({ id: laws.id, title: laws.title, enactedDate: laws.enactedDate, isActive: laws.isActive })
          .from(laws)
          .where(eq(laws.id, review.lawId))
          .limit(1);

        const votes = await db
          .select({ vote: judicialVotes.vote })
          .from(judicialVotes)
          .where(eq(judicialVotes.reviewId, review.id));

        const constitutionalCount = votes.filter((v) => v.vote === 'constitutional').length;
        const unconstitutionalCount = votes.filter((v) => v.vote === 'unconstitutional').length;

        return {
          ...review,
          lawTitle: law?.title ?? 'Unknown Law',
          lawId: law?.id ?? review.lawId,
          constitutionalCount,
          unconstitutionalCount,
          totalVotes: votes.length,
        };
      }),
    );

    res.json({ success: true, data: enriched });
  } catch (err) {
    next(err);
  }
});

/* GET /api/court/stats -- Aggregate counts by status */
router.get('/court/stats', async (_req, res, next) => {
  try {
    const all = await db.select({ status: judicialReviews.status }).from(judicialReviews);
    const stats = {
      total: all.length,
      deliberating: all.filter((r) => r.status === 'deliberating').length,
      upheld: all.filter((r) => r.status === 'upheld').length,
      struckDown: all.filter((r) => r.status === 'struck_down').length,
      pending: all.filter((r) => r.status === 'pending').length,
    };
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

/* GET /api/court/cases/:id -- Single case with full vote detail */
router.get('/court/cases/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const [review] = await db
      .select()
      .from(judicialReviews)
      .where(eq(judicialReviews.id, id))
      .limit(1);

    if (!review) throw new AppError(404, 'Case not found');

    const [law] = await db
      .select({ id: laws.id, title: laws.title, enactedDate: laws.enactedDate, isActive: laws.isActive })
      .from(laws)
      .where(eq(laws.id, review.lawId))
      .limit(1);

    const votes = await db
      .select()
      .from(judicialVotes)
      .where(eq(judicialVotes.reviewId, review.id))
      .orderBy(desc(judicialVotes.castAt));

    const enrichedVotes = await Promise.all(
      votes.map(async (vote) => {
        const [justice] = await db
          .select({
            id: agents.id,
            displayName: agents.displayName,
            avatarConfig: agents.avatarConfig,
            alignment: agents.alignment,
          })
          .from(agents)
          .where(eq(agents.id, vote.justiceId))
          .limit(1);

        return {
          ...vote,
          justiceName: justice?.displayName ?? 'Unknown',
          justiceAvatarConfig: justice?.avatarConfig ?? null,
          justiceAlignment: justice?.alignment ?? null,
          justiceId: justice?.id ?? vote.justiceId,
        };
      }),
    );

    res.json({
      success: true,
      data: {
        ...review,
        law: law ?? null,
        votes: enrichedVotes,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
