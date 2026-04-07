import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { WS_EVENTS } from '@shared/constants';
import type { WsMessage } from '@shared/types';

let wss: WebSocketServer | null = null;

export function initWebSocket(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    console.warn('[WS] Client connected');

    /* Send connection established message */
    const msg: WsMessage = {
      event: WS_EVENTS.CONNECTION_ESTABLISHED,
      data: { message: 'Connected to Agora Bench WebSocket' },
      timestamp: new Date().toISOString(),
    };
    ws.send(JSON.stringify(msg));

    /* Heartbeat */
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            event: WS_EVENTS.HEARTBEAT,
            data: null,
            timestamp: new Date().toISOString(),
          }),
        );
      }
    }, 30000);

    ws.on('close', () => {
      console.warn('[WS] Client disconnected');
      clearInterval(heartbeat);
    });

    ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
      clearInterval(heartbeat);
    });
  });

  console.warn('[WS] WebSocket server initialized on /ws');
  return wss;
}

/* Broadcast a message to all connected clients */
export function broadcast(event: string, data: unknown): void {
  if (!wss) return;

  const message: WsMessage = {
    event,
    data,
    timestamp: new Date().toISOString(),
  };

  const payload = JSON.stringify(message);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

/* ── Log broadcasting ──────────────────────────────────────────────────── */

const SIM_TAG_RE = /^\[(SIMULATION|TICK|PHASE|AGGE|ELECTION|ECONOMY)/i;
const TAG_RE = /^\[([^\]]+)\]\s*/;

export function broadcastLog(tag: string, message: string): void {
  if (!wss || wss.clients.size === 0) return;
  const stream: 'simulation' | 'full' = SIM_TAG_RE.test(`[${tag}]`) ? 'simulation' : 'full';
  broadcast(WS_EVENTS.LOG_ENTRY, {
    tag: `[${tag}]`,
    message,
    stream,
    timestamp: new Date().toISOString(),
  });
}

/* Intercept console.warn (the project's logging convention) once at startup */
const _originalWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  _originalWarn(...args);
  const raw = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
  const match = TAG_RE.exec(raw);
  if (match) {
    const tag = match[1];
    const msg = raw.slice(match[0].length);
    broadcastLog(tag, msg);
  }
};
