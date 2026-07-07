import { Router } from 'express';
import healthRouter from './health';
import agentsRouter from '@modules/agents/server/routes/agents';
import agentProfileRouter from '@modules/agents/server/routes/agentProfile';
import campaignsRouter from '@modules/elections/server/routes/campaigns';
import votesRouter from '@modules/legislation/server/routes/votes';
import legislationRouter from '@modules/legislation/server/routes/legislation';
import electionsRouter from '@modules/elections/server/routes/elections';
import governmentRouter from '@modules/government/server/routes/government';
import partiesRouter from '@modules/elections/server/routes/parties';
import activityRouter from '@modules/agents/server/routes/activity';
import decisionsRouter from '@modules/legislation/server/routes/decisions';
import adminRouter from '@modules/admin/server/routes/admin';
import providersRouter from '@modules/admin/server/routes/providers';
import profileRouter from '@modules/admin/server/routes/profile';
import searchRouter from './search';
import calendarRouter from './calendar';
import forumRouter from '@modules/forum/server/routes/forum';
import courtRouter from '@modules/legislation/server/routes/court';
import ticksRouter from './ticks';
import researcherRouter from '@modules/admin/server/routes/researcher';
import coalitionsRouter from '@modules/agents/server/routes/coalitions';
import orchestratorRouter from '@modules/admin/server/routes/orchestrator';
import modelsRouter from '@modules/admin/server/routes/models';
import pressRouter from '@modules/press/server/routes/press';
import realityRouter from '@modules/admin/server/routes/reality'; // divergence experiment: reality reference pool status
import divergenceRouter from '@modules/government/server/routes/divergence'; // divergence experiment: /divergence page API (E1 slice 4)
import worldRouter from '@modules/world/server/routes/world'; // exogenous world-events feed: /world page API (E2 slice 1)

const router = Router();

router.use(healthRouter);
router.use(agentProfileRouter);
router.use(agentsRouter);
router.use(campaignsRouter);
router.use(votesRouter);
router.use(legislationRouter);
router.use(electionsRouter);
router.use(governmentRouter);
router.use(partiesRouter);
router.use(activityRouter);
router.use(decisionsRouter);
router.use(adminRouter);
router.use(providersRouter);
router.use(profileRouter);
router.use(searchRouter);
router.use(calendarRouter);
router.use(forumRouter);
router.use(courtRouter);
router.use(ticksRouter);
router.use(researcherRouter);
router.use(coalitionsRouter);
router.use(orchestratorRouter);
router.use(modelsRouter);
router.use(pressRouter);
router.use(realityRouter); // divergence experiment: reality reference pool status
router.use(divergenceRouter); // divergence experiment: /divergence page API (E1 slice 4)
router.use(worldRouter); // exogenous world-events feed: /world page API (E2 slice 1)

export default router;
