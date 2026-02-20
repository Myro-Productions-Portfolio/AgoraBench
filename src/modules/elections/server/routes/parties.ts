import { Router } from 'express';
import { db } from '@db/connection';
import { parties, partyMemberships, agents } from '@db/schema/index';
import { partyCreationSchema, paginationSchema } from '@shared/validation';
import { AppError } from '@core/server/middleware/errorHandler';
import { eq } from 'drizzle-orm';
import { ECONOMY } from '@shared/constants';

const router = Router();

/* GET /api/parties/list -- List all parties */
router.get('/parties/list', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const offset = (page - 1) * limit;

    const results = await db
      .select()
      .from(parties)
      .where(eq(parties.isActive, true))
      .limit(limit)
      .offset(offset);

    res.json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
});

/* GET /api/parties/:id -- Get party details */
router.get('/parties/:id', async (req, res, next) => {
  try {
    const [party] = await db
      .select()
      .from(parties)
      .where(eq(parties.id, req.params.id))
      .limit(1);

    if (!party) {
      throw new AppError(404, 'Party not found');
    }

    /* Get members */
    const members = await db
      .select()
      .from(partyMemberships)
      .where(eq(partyMemberships.partyId, party.id));

    const memberDetails = await Promise.all(
      members.map(async (m) => {
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.id, m.agentId))
          .limit(1);
        return { membership: m, agent: agent || null };
      }),
    );

    res.json({ success: true, data: { ...party, members: memberDetails } });
  } catch (error) {
    next(error);
  }
});

/* POST /api/parties/create -- Create a new party */
router.post('/parties/create', async (req, res, next) => {
  try {
    const data = partyCreationSchema.parse(req.body);

    /* Verify founder exists */
    const [founder] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, data.founderId))
      .limit(1);

    if (!founder) {
      throw new AppError(404, 'Founder agent not found');
    }

    if (founder.balance < ECONOMY.PARTY_CREATION_FEE) {
      throw new AppError(400, `Insufficient funds. Party creation requires ${ECONOMY.CURRENCY_SYMBOL}${ECONOMY.PARTY_CREATION_FEE}`);
    }

    /* Check name uniqueness */
    const existing = await db
      .select()
      .from(parties)
      .where(eq(parties.name, data.name))
      .limit(1);

    if (existing.length > 0) {
      throw new AppError(409, 'Party with this name already exists');
    }

    const [party] = await db
      .insert(parties)
      .values({
        name: data.name,
        abbreviation: data.abbreviation,
        description: data.description,
        founderId: data.founderId,
        alignment: data.alignment,
        platform: data.platform,
      })
      .returning();

    /* Add founder as leader */
    await db.insert(partyMemberships).values({
      agentId: data.founderId,
      partyId: party.id,
      role: 'leader',
    });

    /* Deduct creation fee */
    await db
      .update(agents)
      .set({ balance: founder.balance - ECONOMY.PARTY_CREATION_FEE })
      .where(eq(agents.id, data.founderId));

    res.status(201).json({
      success: true,
      data: party,
      message: 'Party created successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
