import { useEffect, useState, useCallback } from 'react';
import type { WsMessage } from '@shared/types';

const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${WS_PROTOCOL}//${window.location.host}/ws`;
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;

/* ── Module-level singleton ─────────────────────────────────────────────── */
/* One socket shared across all hook callers in the same browser tab.       */

let ws: WebSocket | null = null;
const handlers = new Map<string, Set<(data: unknown) => void>>();
const connectedListeners = new Set<(v: boolean) => void>();
let connected = false;
let reconnectAttempts = 0;

function connect() {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    connected = true;
    reconnectAttempts = 0;
    connectedListeners.forEach((fn) => fn(true));
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data as string) as WsMessage;
      handlers.get(message.event)?.forEach((fn) => fn(message.data));
    } catch {
      console.error('[WS] Failed to parse message');
    }
  };

  ws.onclose = () => {
    connected = false;
    ws = null;
    connectedListeners.forEach((fn) => fn(false));
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts += 1;
      setTimeout(connect, RECONNECT_DELAY_MS);
    }
  };

  ws.onerror = () => {
    ws?.close();
  };
}

connect();

/* ── Hook ───────────────────────────────────────────────────────────────── */

interface UseWebSocketReturn {
  isConnected: boolean;
  subscribe: (event: string, handler: (data: unknown) => void) => () => void;
}

export function useWebSocket(): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(connected);

  useEffect(() => {
    setIsConnected(connected);
    connectedListeners.add(setIsConnected);
    connect();
    return () => {
      connectedListeners.delete(setIsConnected);
    };
  }, []);

  const subscribe = useCallback((event: string, handler: (data: unknown) => void) => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(handler);
    return () => {
      handlers.get(event)?.delete(handler);
    };
  }, []);

  return { isConnected, subscribe };
}
