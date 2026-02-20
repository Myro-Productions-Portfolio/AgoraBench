import { Router } from 'express';
import { db } from '@db/connection';
import { agents } from '@db/schema/index';
import { parties, partyMemberships } from '@db/schema/parties';
import { positions } from '@db/schema/government';
import { agentRegistrationSchema, paginationSchema } from '@shared/validation';
import { AppError } from '../middleware/errorHandler';
import { eq } from 'drizzle-orm';

const router = Router();

/* POST /api/agents/register -- Register a new agent */
router.post('/agents/register', async (req, res, next) => {
  try {
    const data = agentRegistrationSchema.parse(req.body);

    /* Check for duplicate agoraId or name */
    const existing = await db
      .select()
      .from(agents)
      .where(eq(agents.agoraId, data.agoraId))
      .limit(1);

    if (existing.length > 0) {
      throw new AppError(409, 'Agent with this Agora ID already exists');
    }

    const existingName = await db
      .select()
      .from(agents)
      .where(eq(agents.name, data.name))
      .limit(1);

    if (existingName.length > 0) {
      throw new AppError(409, 'Agent with this name already exists');
    }

    const [agent] = await db
      .insert(agents)
      .values({
        agoraId: data.agoraId,
        name: data.name,
        displayName: data.displayName,
        bio: data.bio || null,
      })
      .returning();

    res.status(201).json({
      success: true,
      data: agent,
      message: 'Agent registered successfully',
    });
  } catch (error) {
    next(error);
  }
});

/* GET /api/agents/directory -- Enriched listing for the agents directory page */
router.get('/agents/directory', async (_req, res, next) => {
  try {
    const allAgents = await db
      .select({
        id: agents.id,
        displayName: agents.displayName,
        name: agents.name,
        alignment: agents.alignment,
        avatarUrl: agents.avatarUrl,
        avatarConfig: agents.avatarConfig,
        reputation: agents.reputation,
        isActive: agents.isActive,
        bio: agents.bio,
        registrationDate: agents.registrationDate,
      })
      .from(agents);

    /* Party memberships for all agents in one query */
    const memberships = await db
      .select({
        agentId: partyMemberships.agentId,
        partyId: partyMemberships.partyId,
        role: partyMemberships.role,
        partyName: parties.name,
        partyAbbreviation: parties.abbreviation,
        partyAlignment: parties.alignment,
      })
      .from(partyMemberships)
      .innerJoin(parties, eq(partyMemberships.partyId, parties.id))
      .where(eq(parties.isActive, true));

    /* Active positions for all agents in one query */
    const activePositions = await db
      .select({
        agentId: positions.agentId,
        type: positions.type,
        title: positions.title,
      })
      .from(positions)
      .where(eq(positions.isActive, true));

    /* Merge into per-agent records */
    const membershipMap = new Map(memberships.map((m) => [m.agentId, m]));
    const positionMap = new Map(activePositions.map((p) => [p.agentId, p]));

    const directory = allAgents.map((agent) => ({
      ...agent,
      party: membershipMap.get(agent.id) ?? null,
      position: positionMap.get(agent.id) ?? null,
    }));

    res.json({ success: true, data: directory });
  } catch (error) {
    next(error);
  }
});

/* GET /api/agents -- List all agents */
router.get('/agents', async (req, res, next) => {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const offset = (page - 1) * limit;

    const results = await db.select().from(agents).limit(limit).offset(offset);
    res.json({
      success: true,
      data: results,
      pagination: {
        page,
        limit,
        total: results.length,
        totalPages: Math.ceil(results.length / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

/* GET /api/agents/:id -- Get agent by ID */
router.get('/agents/:id', async (req, res, next) => {
  try {
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, req.params.id))
      .limit(1);

    if (!agent) {
      throw new AppError(404, 'Agent not found');
    }

    res.json({ success: true, data: agent });
  } catch (error) {
    next(error);
  }
});

export default router;
