import { Router } from 'express';
import { requireOrchestrator } from '../middleware/orchestratorAuth.js';
import { observeSimulation, executeIntervention, getInterventionHistory, type InterventionInput } from '../lib/orchestratorCore.js';

const router = Router();

router.use('/orchestrator', requireOrchestrator);

router.post('/orchestrator/observe', async (_req, res, next) => {
  try {
    const data = await observeSimulation();
    res.json({ success: true, data });
  } catch (error) { next(error); }
});

router.post('/orchestrator/intervene', async (req, res, next) => {
  try {
    const body = req.body as InterventionInput;
    const intervention = await executeIntervention(body);
    res.json({ success: true, intervention });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unknown type:')) {
      res.status(400).json({ success: false, error: error.message });
      return;
    }
    next(error);
  }
});

router.get('/orchestrator/history', async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const rows = await getInterventionHistory(limit, offset);
    res.json({ success: true, data: rows });
  } catch (error) { next(error); }
});

export default router;
