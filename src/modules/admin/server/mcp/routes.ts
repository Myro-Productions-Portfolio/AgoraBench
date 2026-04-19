import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { requireOrchestrator } from '../middleware/orchestratorAuth.js';
import { createAgoraBenchMcpServer } from './server.js';

const router = Router();

/* Session-scoped transports. An MCP client initializes once, gets a session ID,
 * then reuses it across subsequent requests. */
const transports: Record<string, StreamableHTTPServerTransport> = {};

/* Every /mcp call requires a valid Bearer BOB_ORCHESTRATOR_KEY */
router.use(requireOrchestrator);

/* POST /mcp — client→server JSON-RPC messages (incl. initialize) */
router.post('/', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports[sessionId]) {
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports[sid] = transport;
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
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

/* GET /mcp — server→client SSE stream */
/* DELETE /mcp — session termination */
const sessionHandler = async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await transports[sessionId].handleRequest(req, res);
};

router.get('/', sessionHandler);
router.delete('/', sessionHandler);

export default router;
