import { Router } from 'express';
import { db } from '@db/connection';
import { agents, parties, partyMemberships, agentStatements, agentDeals } from '@db/schema/index';
import { positions } from '@modules/government/db/schema/government';
import { agentRegistrationSchema, paginationSchema } from '@shared/validation';
import { AppError } from '@core/server/middleware/errorHandler';
import { requireResearcher } from '@core/server/middleware/auth';
import { eq, desc, or, sql } from 'drizzle-orm';

const router = Router();

/* Sim-write gate: agent registration is a researcher action (inject an AI).
   Scoped to the exact write path because this router also serves public GETs
   (/agents, /agents/directory, /agents/:id). Router-level per rule #3, but
   path-scoped so it can't shadow the public reads. */
router.use('/agents/register', requireResearcher);

/* POST /api/agents/register -- Register a new agent (researcher/owner) */
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

/* GET /api/agents/:id/statements -- Recent public statements by an agent */
router.get('/agents/:id/statements', async (req, res, next) => {
  try {
    const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 10;
    const limit = Math.min(isNaN(rawLimit) || rawLimit < 1 ? 10 : rawLimit, 50);

    const rows = await db
      .select()
      .from(agentStatements)
      .where(eq(agentStatements.agentId, req.params.id))
      .orderBy(desc(agentStatements.createdAt))
      .limit(limit);

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

/* GET /api/agents/:id/deals -- Deals involving an agent (initiator or target) */
router.get('/agents/:id/deals', async (req, res, next) => {
  try {
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;

    const baseCondition = or(
      eq(agentDeals.initiatorId, req.params.id),
      eq(agentDeals.targetId, req.params.id),
    );

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
      .where(
        statusFilter
          ? sql`(${baseCondition}) AND ${agentDeals.status} = ${statusFilter}`
          : baseCondition,
      )
      .orderBy(desc(agentDeals.createdAt))
      .limit(50);

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

export default router;
