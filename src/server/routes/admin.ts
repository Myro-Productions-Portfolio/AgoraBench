import { Router } from 'express';
import { db } from '@db/connection';
import { agentDecisions, agents, governmentSettings, users, researcherRequests, approvalEvents, bills, laws, billVotes, elections, campaigns, aggeInterventions } from '@db/schema/index';
import { count, eq, sql, asc, desc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  pauseSimulation,
  resumeSimulation,
  triggerManualTick,
  getSimulationStatus,
  changeTickInterval,
  retryFailedJobs,
} from '../jobs/agentTick.js';
import { triggerManualAggeTick } from '../jobs/aggeTick.js';
import { runSeed } from '@db/seedFn';
import { getRuntimeConfig, updateRuntimeConfig } from '../runtimeConfig.js';
import type { ProviderOverride } from '../runtimeConfig.js';
import { requireOwner } from '../middleware/auth.js';

const router = Router();

/* ---- CSV helper ---- */
export function toCSV(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const escape = (v: string | number | boolean | null | undefined): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  return [headers.join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
}

/* All /admin/* routes are owner-only */
router.use('/admin', requireOwner);

/* GET /api/admin/status — simulation state + decision stats */
router.get('/admin/status', async (_req, res, next) => {
  try {
    const simStatus = await getSimulationStatus();

    const [stats] = await db
      .select({
        total: count(),
        errors: sql<number>`COUNT(*) FILTER (WHERE ${agentDecisions.success} = false)`,
        haikuCount: sql<number>`COUNT(*) FILTER (WHERE ${agentDecisions.provider} = 'haiku')`,
        ollamaCount: sql<number>`COUNT(*) FILTER (WHERE ${agentDecisions.provider} = 'ollama')`,
      })
      .from(agentDecisions);

    res.json({ success: true, data: { simulation: simStatus, decisions: stats } });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/pause */
router.post('/admin/pause', async (_req, res, next) => {
  try {
    await pauseSimulation();
    res.json({ success: true, data: { message: 'Simulation paused' } });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/resume */
router.post('/admin/resume', async (_req, res, next) => {
  try {
    await resumeSimulation();
    res.json({ success: true, data: { message: 'Simulation resumed' } });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/tick — trigger one immediate tick */
router.post('/admin/tick', async (_req, res, next) => {
  try {
    await triggerManualTick();
    res.json({ success: true, data: { message: 'Tick queued' } });
  } catch (error) {
    next(error);
  }
});

/* POST /admin/retry-failed -- Retry all failed Bull jobs */
router.post('/admin/retry-failed', async (_req, res, next) => {
  try {
    const count = await retryFailedJobs();
    res.json({ success: true, data: { retriedCount: count }, message: `Retried ${count} failed jobs` });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/reseed — wipe and reseed the database (owner only) */
router.post('/admin/reseed', requireOwner, async (_req, res, next) => {
  try {
    await runSeed();
    res.json({ success: true, data: { message: 'Database reseeded' } });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/decisions — decision log with agent name, all fields */
router.get('/admin/decisions', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10)));
    const offset = (page - 1) * limit;

    const rows = await db
      .select({
        id: agentDecisions.id,
        agentName: agents.displayName,
        provider: agentDecisions.provider,
        phase: agentDecisions.phase,
        parsedAction: agentDecisions.parsedAction,
        parsedReasoning: agentDecisions.parsedReasoning,
        success: agentDecisions.success,
        latencyMs: agentDecisions.latencyMs,
        createdAt: agentDecisions.createdAt,
      })
      .from(agentDecisions)
      .leftJoin(agents, eq(agentDecisions.agentId, agents.id))
      .orderBy(sql`${agentDecisions.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/config — current runtime configuration (owner only) */
router.get('/admin/config', requireOwner, (_req, res) => {
  res.json({ success: true, data: getRuntimeConfig() });
});

/* POST /api/admin/config — update runtime configuration (owner only) */
router.post('/admin/config', requireOwner, async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const update: Parameters<typeof updateRuntimeConfig>[0] = {};

    const num = (key: string, min: number, max: number): number | undefined => {
      const v = body[key];
      if (typeof v === 'number' && !isNaN(v)) return Math.max(min, Math.min(max, v));
      return undefined;
    };
    const prob = (key: string): number | undefined => num(key, 0, 1);
    const posInt = (key: string, min = 1, max = 9999): number | undefined => {
      const v = num(key, min, max);
      return v !== undefined ? Math.round(v) : undefined;
    };

    /* Simulation */
    if (typeof body.tickIntervalMs === 'number' && body.tickIntervalMs >= 30_000) {
      update.tickIntervalMs = body.tickIntervalMs;
      await changeTickInterval(body.tickIntervalMs);
    }
    const badMs = num('billAdvancementDelayMs', 10_000, 86_400_000);
    if (badMs !== undefined) update.billAdvancementDelayMs = badMs;
    const VALID_PROVIDERS = ['default', 'anthropic', 'openai', 'google', 'huggingface', 'ollama'];
    if (typeof body.providerOverride === 'string' && VALID_PROVIDERS.includes(body.providerOverride)) {
      update.providerOverride = body.providerOverride as ProviderOverride;
    }

    /* Guard Rails */
    const mplc = posInt('maxPromptLengthChars', 500, 32000);
    if (mplc !== undefined) update.maxPromptLengthChars = mplc;
    const molt = posInt('maxOutputLengthTokens', 50, 4000);
    if (molt !== undefined) update.maxOutputLengthTokens = molt;
    const mbpat = posInt('maxBillsPerAgentPerTick', 1, 20);
    if (mbpat !== undefined) update.maxBillsPerAgentPerTick = mbpat;
    const mcspt = posInt('maxCampaignSpeechesPerTick', 1, 20);
    if (mcspt !== undefined) update.maxCampaignSpeechesPerTick = mcspt;

    /* Agent Behavior */
    const bpc = prob('billProposalChance');       if (bpc !== undefined) update.billProposalChance = bpc;
    const csc = prob('campaignSpeechChance');     if (csc !== undefined) update.campaignSpeechChance = csc;
    const apc = prob('amendmentProposalChance');  if (apc !== undefined) update.amendmentProposalChance = apc;

    /* Government Structure */
    const cs = posInt('congressSeats', 1, 500);           if (cs !== undefined) update.congressSeats = cs;
    const ctd = posInt('congressTermDays', 7, 3650);      if (ctd !== undefined) update.congressTermDays = ctd;
    const ptd = posInt('presidentTermDays', 7, 3650);     if (ptd !== undefined) update.presidentTermDays = ptd;
    const scj = posInt('supremeCourtJustices', 1, 25);   if (scj !== undefined) update.supremeCourtJustices = scj;
    const qp = prob('quorumPercentage');                   if (qp !== undefined) update.quorumPercentage = qp;
    const bpp = prob('billPassagePercentage');             if (bpp !== undefined) update.billPassagePercentage = bpp;
    const smp = prob('supermajorityPercentage');           if (smp !== undefined) update.supermajorityPercentage = smp;

    /* Elections */
    const cdd = posInt('campaignDurationDays', 1, 365);   if (cdd !== undefined) update.campaignDurationDays = cdd;
    const vdh = posInt('votingDurationHours', 1, 720);    if (vdh !== undefined) update.votingDurationHours = vdh;
    const mrr = posInt('minReputationToRun', 0, 10000);  if (mrr !== undefined) update.minReputationToRun = mrr;
    const mrv = posInt('minReputationToVote', 0, 10000); if (mrv !== undefined) update.minReputationToVote = mrv;

    /* Economy */
    const iab = posInt('initialAgentBalance', 0, 1_000_000); if (iab !== undefined) update.initialAgentBalance = iab;
    const cff = posInt('campaignFilingFee', 0, 100_000);     if (cff !== undefined) update.campaignFilingFee = cff;
    const pcf = posInt('partyCreationFee', 0, 100_000);      if (pcf !== undefined) update.partyCreationFee = pcf;
    const sp = posInt('salaryPresident', 0, 100_000);         if (sp !== undefined) update.salaryPresident = sp;
    const sc = posInt('salaryCabinet', 0, 100_000);           if (sc !== undefined) update.salaryCabinet = sc;
    const scg = posInt('salaryCongress', 0, 100_000);         if (scg !== undefined) update.salaryCongress = scg;
    const sj = posInt('salaryJustice', 0, 100_000);           if (sj !== undefined) update.salaryJustice = sj;

    /* Governance Probabilities */
    const vbr = prob('vetoBaseRate');                     if (vbr !== undefined) update.vetoBaseRate = vbr;
    const vrpt = prob('vetoRatePerTier');                 if (vrpt !== undefined) update.vetoRatePerTier = vrpt;
    const vmr = prob('vetoMaxRate');                      if (vmr !== undefined) update.vetoMaxRate = vmr;
    const ctro = prob('committeeTableRateOpposing');      if (ctro !== undefined) update.committeeTableRateOpposing = ctro;
    const ctrn = prob('committeeTableRateNeutral');       if (ctrn !== undefined) update.committeeTableRateNeutral = ctrn;
    const car = prob('committeeAmendRate');               if (car !== undefined) update.committeeAmendRate = car;
    const jcr = prob('judicialChallengeRatePerLaw');      if (jcr !== undefined) update.judicialChallengeRatePerLaw = jcr;
    const pwf = prob('partyWhipFollowRate');              if (pwf !== undefined) update.partyWhipFollowRate = pwf;
    const vot = prob('vetoOverrideThreshold');            if (vot !== undefined) update.vetoOverrideThreshold = vot;

    const updated = updateRuntimeConfig(update);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/economy — live treasury + tax rate from DB */
router.get('/admin/economy', async (_req, res, next) => {
  try {
    const [row] = await db.select().from(governmentSettings).limit(1);
    res.json({ success: true, data: row ?? { treasuryBalance: 0, taxRatePercent: 2 } });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/economy — update treasury balance or tax rate in DB */
router.post('/admin/economy', async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (typeof body.treasuryBalance === 'number' && body.treasuryBalance >= 0) {
      patch.treasuryBalance = Math.round(body.treasuryBalance);
    }
    if (typeof body.taxRatePercent === 'number' && body.taxRatePercent >= 0 && body.taxRatePercent <= 100) {
      patch.taxRatePercent = body.taxRatePercent;
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ success: false, error: 'No valid fields provided' });
      return;
    }

    patch.updatedAt = new Date();

    const [existing] = await db.select({ id: governmentSettings.id }).from(governmentSettings).limit(1);
    let row;
    if (existing) {
      [row] = await db.update(governmentSettings).set(patch).where(eq(governmentSettings.id, existing.id)).returning();
    } else {
      [row] = await db.insert(governmentSettings).values({ treasuryBalance: 50000, taxRatePercent: 2, ...patch }).returning();
    }

    res.json({ success: true, data: row });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/agents — list all agents with status */
router.get('/admin/agents', async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: agents.id,
        displayName: agents.displayName,
        alignment: agents.alignment,
        modelProvider: agents.modelProvider,
        isActive: agents.isActive,
        reputation: agents.reputation,
        balance: agents.balance,
      })
      .from(agents)
      .orderBy(agents.displayName);

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/agents/:id/toggle — enable/disable an agent */
router.post('/admin/agents/:id/toggle', async (req, res, next) => {
  try {
    const { id } = req.params;
    const [agent] = await db.select({ isActive: agents.isActive }).from(agents).where(eq(agents.id, id));

    if (!agent) {
      res.status(404).json({ success: false, error: 'Agent not found' });
      return;
    }

    const newActive = !agent.isActive;
    await db.update(agents).set({ isActive: newActive }).where(eq(agents.id, id));
    res.json({ success: true, data: { isActive: newActive } });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/agents/create — create a new agent */
router.post('/admin/agents/create', async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const rc = getRuntimeConfig();

    const displayName = String(body.displayName ?? '').trim();
    const name = String(body.name ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const alignment = String(body.alignment ?? 'moderate');
    const bio = String(body.bio ?? '').trim();
    const personality = String(body.personality ?? '').trim();
    const modelProvider = String(body.modelProvider ?? 'anthropic');
    const model = String(body.model ?? '').trim();
    const startingBalance = typeof body.startingBalance === 'number'
      ? Math.round(body.startingBalance)
      : rc.initialAgentBalance;

    if (!displayName || !name) {
      res.status(400).json({ success: false, error: 'displayName and name are required' });
      return;
    }

    const VALID_ALIGNMENTS = ['progressive', 'moderate', 'conservative', 'libertarian', 'technocrat'];
    const VALID_PROVIDERS_LIST = ['anthropic', 'openai', 'google', 'huggingface', 'ollama'];

    if (!VALID_ALIGNMENTS.includes(alignment)) {
      res.status(400).json({ success: false, error: 'Invalid alignment' });
      return;
    }
    if (!VALID_PROVIDERS_LIST.includes(modelProvider)) {
      res.status(400).json({ success: false, error: 'Invalid modelProvider' });
      return;
    }

    const [newAgent] = await db.insert(agents).values({
      displayName,
      name,
      agoraId: `agora_${name}_${Date.now()}`,
      alignment,
      bio: bio || undefined,
      personality: personality || undefined,
      modelProvider,
      model: model || undefined,
      balance: startingBalance,
      reputation: 100,
      isActive: true,
    }).returning();

    res.json({ success: true, data: newAgent });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/users — list all registered users (owner only — contains PII) */
router.get('/admin/users', requireOwner, async (_req, res, next) => {
  try {
    const rows = await db
      .select({ id: users.id, username: users.username, email: users.email, role: users.role, clerkUserId: users.clerkUserId, createdAt: users.createdAt })
      .from(users)
      .orderBy(users.createdAt);
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/users/:id/role — set a user's role (owner only) */
router.post('/admin/users/:id/role', requireOwner, async (req, res, next) => {
  try {
    const id = String(req.params['id']);
    const body = req.body as Record<string, unknown>;
    const role = String(body.role ?? '');
    if (!['researcher', 'user'].includes(role)) {
      res.status(400).json({ success: false, error: 'role must be "researcher" or "user"' });
      return;
    }
    const [updated] = await db.update(users).set({ role }).where(eq(users.id, id)).returning();
    if (!updated) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/researcher-requests (owner only — contains PII) */
router.get('/admin/researcher-requests', requireOwner, async (req, res, next) => {
  try {
    const statusFilter = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
    const baseQuery = db
      .select({
        id: researcherRequests.id,
        userId: researcherRequests.userId,
        message: researcherRequests.message,
        status: researcherRequests.status,
        createdAt: researcherRequests.createdAt,
        reviewedAt: researcherRequests.reviewedAt,
        reviewedBy: researcherRequests.reviewedBy,
        username: users.username,
        email: users.email,
      })
      .from(researcherRequests)
      .leftJoin(users, eq(researcherRequests.userId, users.id))
      .orderBy(asc(researcherRequests.createdAt));

    const rows = statusFilter
      ? await baseQuery.where(eq(researcherRequests.status, statusFilter))
      : await baseQuery;

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/researcher-requests/:id/approve (owner only) */
router.post('/admin/researcher-requests/:id/approve', requireOwner, async (req, res, next) => {
  try {
    const requestId = String(req.params['id']);
    const [request] = await db
      .select()
      .from(researcherRequests)
      .where(eq(researcherRequests.id, requestId))
      .limit(1);
    if (!request) {
      res.status(404).json({ success: false, error: 'Request not found' });
      return;
    }
    await db.update(researcherRequests).set({
      status: 'approved',
      reviewedAt: new Date(),
      reviewedBy: req.user!.id,
    }).where(eq(researcherRequests.id, requestId));
    await db.update(users).set({ role: 'researcher' }).where(eq(users.id, request.userId));
    res.json({ success: true, data: { approved: true } });
  } catch (error) {
    next(error);
  }
});

/* POST /api/admin/researcher-requests/:id/reject (owner only) */
router.post('/admin/researcher-requests/:id/reject', requireOwner, async (req, res, next) => {
  try {
    const requestId = String(req.params['id']);
    const [request] = await db
      .select({ id: researcherRequests.id })
      .from(researcherRequests)
      .where(eq(researcherRequests.id, requestId))
      .limit(1);
    if (!request) {
      res.status(404).json({ success: false, error: 'Request not found' });
      return;
    }
    await db.update(researcherRequests).set({
      status: 'rejected',
      reviewedAt: new Date(),
      reviewedBy: req.user!.id,
    }).where(eq(researcherRequests.id, requestId));
    res.json({ success: true, data: { rejected: true } });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/export/counts — row counts for all exportable datasets (owner only) */
router.get('/admin/export/counts', requireOwner, async (_req, res, next) => {
  try {
    const [
      [decisions],
      [approvals],
      [billsCount],
      [billVotesCount],
      [lawsCount],
      [electionsCount],
      [agentsCount],
    ] = await Promise.all([
      db.select({ n: count() }).from(agentDecisions),
      db.select({ n: count() }).from(approvalEvents),
      db.select({ n: count() }).from(bills),
      db.select({ n: count() }).from(billVotes),
      db.select({ n: count() }).from(laws),
      db.select({ n: count() }).from(elections),
      db.select({ n: count() }).from(agents),
    ]);
    res.json({
      success: true,
      data: {
        agentDecisions: decisions.n,
        approvalEvents: approvals.n,
        bills: billsCount.n,
        billVotes: billVotesCount.n,
        laws: lawsCount.n,
        elections: electionsCount.n,
        agents: agentsCount.n,
      },
    });
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/export/agent-decisions (owner only) */
router.get('/admin/export/agent-decisions', requireOwner, async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: agentDecisions.id,
        createdAt: agentDecisions.createdAt,
        agentName: agents.displayName,
        provider: agentDecisions.provider,
        phase: agentDecisions.phase,
        parsedAction: agentDecisions.parsedAction,
        parsedReasoning: agentDecisions.parsedReasoning,
        success: agentDecisions.success,
        latencyMs: agentDecisions.latencyMs,
      })
      .from(agentDecisions)
      .leftJoin(agents, eq(agentDecisions.agentId, agents.id))
      .orderBy(desc(agentDecisions.createdAt));

    const csv = toCSV(
      ['id', 'createdAt', 'agentName', 'provider', 'phase', 'parsedAction', 'parsedReasoning', 'success', 'latencyMs'],
      rows.map((r) => [r.id, r.createdAt?.toISOString(), r.agentName, r.provider, r.phase, r.parsedAction, r.parsedReasoning, r.success, r.latencyMs]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="agent-decisions.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/export/approval-events (owner only) */
router.get('/admin/export/approval-events', requireOwner, async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: approvalEvents.id,
        createdAt: approvalEvents.createdAt,
        agentName: agents.displayName,
        eventType: approvalEvents.eventType,
        delta: approvalEvents.delta,
        reason: approvalEvents.reason,
      })
      .from(approvalEvents)
      .leftJoin(agents, eq(approvalEvents.agentId, agents.id))
      .orderBy(desc(approvalEvents.createdAt));

    const csv = toCSV(
      ['id', 'createdAt', 'agentName', 'eventType', 'delta', 'reason'],
      rows.map((r) => [r.id, r.createdAt?.toISOString(), r.agentName, r.eventType, r.delta, r.reason]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="approval-events.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/export/bills (owner only) */
router.get('/admin/export/bills', requireOwner, async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: bills.id,
        introducedAt: bills.introducedAt,
        title: bills.title,
        sponsorName: agents.displayName,
        committee: bills.committee,
        status: bills.status,
        billType: bills.billType,
        lastActionAt: bills.lastActionAt,
      })
      .from(bills)
      .leftJoin(agents, eq(bills.sponsorId, agents.id))
      .orderBy(desc(bills.introducedAt));

    const csv = toCSV(
      ['id', 'introducedAt', 'title', 'sponsorName', 'committee', 'status', 'billType', 'lastActionAt'],
      rows.map((r) => [r.id, r.introducedAt?.toISOString(), r.title, r.sponsorName, r.committee, r.status, r.billType, r.lastActionAt?.toISOString()]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bills.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/export/bill-votes (owner only) */
router.get('/admin/export/bill-votes', requireOwner, async (_req, res, next) => {
  try {
    const voterAgents = alias(agents, 'voter');
    const rows = await db
      .select({
        id: billVotes.id,
        castAt: billVotes.castAt,
        voterName: voterAgents.displayName,
        billTitle: bills.title,
        choice: billVotes.choice,
      })
      .from(billVotes)
      .leftJoin(voterAgents, eq(billVotes.voterId, voterAgents.id))
      .leftJoin(bills, eq(billVotes.billId, bills.id))
      .orderBy(desc(billVotes.castAt));

    const csv = toCSV(
      ['id', 'castAt', 'voterName', 'billTitle', 'choice'],
      rows.map((r) => [r.id, r.castAt?.toISOString(), r.voterName, r.billTitle, r.choice]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bill-votes.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/export/laws (owner only) */
router.get('/admin/export/laws', requireOwner, async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: laws.id,
        enactedDate: laws.enactedDate,
        title: laws.title,
        isActive: laws.isActive,
        billId: laws.billId,
      })
      .from(laws)
      .orderBy(desc(laws.enactedDate));

    const csv = toCSV(
      ['id', 'enactedDate', 'title', 'isActive', 'billId'],
      rows.map((r) => [r.id, r.enactedDate?.toISOString(), r.title, r.isActive, r.billId]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="laws.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/export/elections (owner only) */
router.get('/admin/export/elections', requireOwner, async (_req, res, next) => {
  try {
    const winnerAgents = alias(agents, 'winner');
    const candidateAgents = alias(agents, 'candidate');

    const rows = await db
      .select({
        electionId: elections.id,
        positionType: elections.positionType,
        status: elections.status,
        scheduledDate: elections.scheduledDate,
        votingStartDate: elections.votingStartDate,
        votingEndDate: elections.votingEndDate,
        certifiedDate: elections.certifiedDate,
        winnerName: winnerAgents.displayName,
        totalVotes: elections.totalVotes,
        campaignId: campaigns.id,
        candidateName: candidateAgents.displayName,
        campaignStatus: campaigns.status,
        contributions: campaigns.contributions,
      })
      .from(elections)
      .leftJoin(winnerAgents, eq(elections.winnerId, winnerAgents.id))
      .leftJoin(campaigns, eq(campaigns.electionId, elections.id))
      .leftJoin(candidateAgents, eq(campaigns.agentId, candidateAgents.id))
      .orderBy(desc(elections.createdAt));

    const csv = toCSV(
      ['electionId', 'positionType', 'status', 'scheduledDate', 'votingStartDate', 'votingEndDate', 'certifiedDate', 'winnerName', 'totalVotes', 'campaignId', 'candidateName', 'campaignStatus', 'contributions'],
      rows.map((r) => [r.electionId, r.positionType, r.status, r.scheduledDate?.toISOString(), r.votingStartDate?.toISOString(), r.votingEndDate?.toISOString(), r.certifiedDate?.toISOString(), r.winnerName, r.totalVotes, r.campaignId, r.candidateName, r.campaignStatus, r.contributions]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="elections.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/* GET /api/admin/export/agents (owner only) */
router.get('/admin/export/agents', requireOwner, async (_req, res, next) => {
  try {
    const rows = await db
      .select({
        id: agents.id,
        displayName: agents.displayName,
        name: agents.name,
        alignment: agents.alignment,
        modelProvider: agents.modelProvider,
        model: agents.model,
        reputation: agents.reputation,
        balance: agents.balance,
        approvalRating: agents.approvalRating,
        isActive: agents.isActive,
        registrationDate: agents.registrationDate,
      })
      .from(agents)
      .orderBy(asc(agents.displayName));

    const csv = toCSV(
      ['id', 'displayName', 'name', 'alignment', 'modelProvider', 'model', 'reputation', 'balance', 'approvalRating', 'isActive', 'registrationDate'],
      rows.map((r) => [r.id, r.displayName, r.name, r.alignment, r.modelProvider, r.model, r.reputation, r.balance, r.approvalRating, r.isActive, r.registrationDate?.toISOString()]),
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="agents-snapshot.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/god/interventions — paginated AGGE intervention log
router.get('/god/interventions', requireOwner, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    const rows = await db
      .select({
        id: aggeInterventions.id,
        agentId: aggeInterventions.agentId,
        displayName: agents.displayName,
        action: aggeInterventions.action,
        previousMod: aggeInterventions.previousMod,
        newMod: aggeInterventions.newMod,
        reasoning: aggeInterventions.reasoning,
        createdAt: aggeInterventions.createdAt,
      })
      .from(aggeInterventions)
      .innerJoin(agents, eq(aggeInterventions.agentId, agents.id))
      .orderBy(desc(aggeInterventions.createdAt))
      .limit(limit)
      .offset(offset);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/god/tick — manually trigger an AGGE tick
router.post('/god/tick', requireOwner, async (_req, res, next) => {
  try {
    await triggerManualAggeTick();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
