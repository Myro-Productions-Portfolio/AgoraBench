import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { requireOrchestrator } from '../middleware/orchestratorAuth.js';
import { createAgoraBenchMcpServer } from './server.js';

const router = Router();

/* Session-scoped transports, keyed by sessionId.
 * Streamable HTTP uses mcp-session-id header; legacy SSE uses ?sessionId= on the POST. */
const streamableTransports: Record<string, StreamableHTTPServerTransport> = {};
const sseTransports: Record<string, SSEServerTransport> = {};

/* Every /mcp call requires a valid Bearer BOB_ORCHESTRATOR_KEY
 * (header, X-Orchestrator-Key, or ?key= query param). */
router.use(requireOrchestrator);

/* =========================================================================
 * Streamable HTTP transport — modern MCP clients (Claude Desktop, Cursor,
 * @modelcontextprotocol/sdk client). Session-scoped via mcp-session-id header.
 * ========================================================================= */

router.post('/', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && streamableTransports[sessionId]) {
    transport = streamableTransports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        streamableTransports[sid] = transport;
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) delete streamableTransports[transport.sessionId];
    };
    const mcp = createAgoraBenchMcpServer();
    await mcp.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
      id: null,
    });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

const streamableSessionHandler = async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !streamableTransports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await streamableTransports[sessionId].handleRequest(req, res);
};

router.get('/', streamableSessionHandler);
router.delete('/', streamableSessionHandler);

/* =========================================================================
 * Legacy SSE transport — compatibility shim for bundle loaders (OpenClaw,
 * older MCP clients) that only know plain SSE. Client opens GET /mcp/sse,
 * receives an `endpoint` event telling it to POST to /mcp/messages?sessionId=…,
 * and the server pushes responses back down the open GET stream.
 * ========================================================================= */

router.get('/sse', async (_req: Request, res: Response) => {
  /* The SSE transport writes SSE headers + its `endpoint` event itself. We give
   * it the POST path; the session ID is generated inside the transport. */
  const transport = new SSEServerTransport('/mcp/messages', res);
  sseTransports[transport.sessionId] = transport;

  res.on('close', () => {
    delete sseTransports[transport.sessionId];
  });

  const mcp = createAgoraBenchMcpServer();
  await mcp.connect(transport);
});

router.post('/messages', async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId;
  if (typeof sessionId !== 'string' || !sseTransports[sessionId]) {
    res.status(400).send('Invalid or missing sessionId');
    return;
  }
  await sseTransports[sessionId].handlePostMessage(req, res, req.body);
});

export default router;
