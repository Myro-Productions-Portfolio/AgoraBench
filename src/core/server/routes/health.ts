import { Router } from 'express';
import { testConnection } from '@db/connection';

const router = Router();

router.get('/health', async (_req, res) => {
  const dbOk = await testConnection();

  const status = dbOk ? 'healthy' : 'degraded';
  const statusCode = dbOk ? 200 : 503;

  res.status(statusCode).json({
    success: dbOk,
    data: {
      status,
      timestamp: new Date().toISOString(),
      version: '0.1.0',
      services: {
        database: dbOk ? 'connected' : 'disconnected',
      },
    },
  });
});

export default router;
