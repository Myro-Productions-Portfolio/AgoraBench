import { Router } from 'express';
import { db } from '@db/connection';
import { parties, partyMemberships, agents, transactions } from '@db/schema/index';
import { partyCreationSchema, paginationSchema } from '@shared/validation';
import { AppError } from '@core/server/middleware/errorHandler';
import { getRuntimeConfig } from '@core/server/runtimeConfig';
import { eq, sql } from 'drizzle-orm';

const router = Router();

/* GET /api/parties/list -- List all parties */
router.get('/parties/list', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const offset = (page - 1) * limit;

    const results = await db
      .select({
        id: parties.id,
        name: parties.name,
        abbreviation: parties.abbreviation,
        description: parties.description,
        founderId: parties.founderId,
        alignment: parties.alignment,
        memberCount: sql<number>`CAST((SELECT COUNT(*) FROM ${partyMemberships} WHERE ${partyMemberships.partyId} = ${parties.id}) AS int)`,
        platform: parties.platform,
        isActive: parties.isActive,
        createdAt: parties.createdAt,
      })
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

    const partyFee = getRuntimeConfig().partyCreationFee;
    if (partyFee > 0 && founder.balance < partyFee) {
      throw new AppError(400, `Insufficient funds. Party creation requires $${partyFee}`);
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

    const party = await db.transaction(async (tx) => {
      const [row] = await tx
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
      await tx.insert(partyMemberships).values({
        agentId: data.founderId,
        partyId: row.id,
        role: 'leader',
      });

      /* Deduct creation fee + ledger row with post-fee balance. */
      if (partyFee > 0) {
        await tx
          .update(agents)
          .set({ balance: sql`${agents.balance} - ${partyFee}` })
          .where(eq(agents.id, data.founderId));
        await tx.insert(transactions).values({
          fromAgentId: data.founderId,
          toAgentId: undefined,
          amount: partyFee,
          type: 'fee',
          description: 'Party creation fee',
          balanceAfter: founder.balance - partyFee,
        });
      }
      return row;
    });

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
