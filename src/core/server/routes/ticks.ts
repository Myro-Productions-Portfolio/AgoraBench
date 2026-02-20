import { Router } from 'express';
import { db } from '@db/connection';
import { tickLog } from '@db/schema/index';
import { desc, isNotNull } from 'drizzle-orm';

const router = Router();

/* GET /api/ticks?limit=5 -- List recent completed ticks */
router.get('/ticks', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '5'), 10) || 5, 20);
    const ticks = await db
      .select()
      .from(tickLog)
      .where(isNotNull(tickLog.completedAt))
      .orderBy(desc(tickLog.firedAt))
      .limit(limit);
    res.json({ success: true, data: ticks });
  } catch (error) {
    next(error);
  }
});

export default router;
