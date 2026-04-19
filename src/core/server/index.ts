import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import path from 'path';
import { clerkMiddleware } from '@clerk/express';
import { config } from './config';
import { errorHandler, requestLogger } from './middleware/index';
import apiRouter from './routes/index';
import mcpRouter from '../../modules/admin/server/mcp/routes.js';
import { initWebSocket } from './websocket';
import { startAgentTick } from './jobs/agentTick';
import { startAggeTick } from './jobs/aggeTick.js';
import { API_PREFIX } from '@shared/constants';

const app = express();
const server = createServer(app);

/* Security middleware */
app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);

/* CORS */
const extraOrigins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
const ALLOWED_ORIGINS = [
  config.clientUrl,
  'https://agorabench.com',
  'https://www.agorabench.com',
  'https://moltgovernment.com',
  'https://www.moltgovernment.com',
  ...extraOrigins,
];
app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (curl, mobile apps, same-origin)
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);

/* Body parsing */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

/* Clerk authentication middleware */
app.use(clerkMiddleware());

/* Request logging */
app.use(requestLogger);

/* API routes */
app.use(API_PREFIX, apiRouter);

/* MCP server — bearer-gated Streamable HTTP at /mcp */
app.use('/mcp', mcpRouter);

/* Static files + SPA catch-all (production only) */
if (config.isProd) {
  const clientDist = path.resolve(process.cwd(), 'dist/client');
  // Cache hashed assets forever, never cache HTML or service worker
  app.use(express.static(clientDist, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html') || filePath.endsWith('sw.js') || /workbox-[a-f0-9]+\.js$/.test(filePath)) {
        res.setHeader('Cache-Control', 'no-store');
      } else if (/\.[a-f0-9]{8}\.(js|css)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

/* Error handler (must be last middleware) */
app.use(errorHandler);

/* Load persisted runtime config from DB before starting tick engines */
import { loadRuntimeConfig } from './runtimeConfig.js';
loadRuntimeConfig().then(() => {
  /* Initialize WebSocket */
  initWebSocket(server);
  startAgentTick();
  startAggeTick();
}).catch((err) => {
  console.warn('[SERVER] Config load failed, starting with defaults:', err);
  initWebSocket(server);
  startAgentTick();
  startAggeTick();
});


/* Graceful shutdown — prevents orphaned processes on SIGTERM/SIGINT */
function shutdown(signal: string) {
  console.warn(`[SERVER] ${signal} received — shutting down gracefully`);
  server.close(() => {
    console.warn('[SERVER] HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.warn('[SERVER] Forced exit after timeout');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/* Start server */
server.listen(config.port, () => {
  console.warn(`[SERVER] Agora Bench API running on port ${config.port}`);
  console.warn(`[SERVER] Environment: ${config.nodeEnv}`);
  console.warn(`[SERVER] Client URL: ${config.clientUrl}`);
  console.warn(`[SERVER] Health check: http://localhost:${config.port}${API_PREFIX}/health`);
});

export { app, server };
