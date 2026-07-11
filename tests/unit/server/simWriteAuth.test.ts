// @vitest-environment node
import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Express } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

/* Regression guard: the six sim-write endpoints must reject unauthenticated
   callers (401) and non-researcher signed-in users (403). These routes shipped
   with NO auth once already; this test fails loudly if the middleware is ever
   removed from any of them.

   The auth middleware reads Clerk (getAuth/clerkClient) and the users table, so
   both are mocked (repo's vi.mock-factory pattern). `authState` and `dbUserRole`
   drive the two scenarios without a real Clerk session or DB. */

let authState: { userId: string | null } = { userId: null };
let dbUserRole: string | null = null;

vi.mock('@clerk/express', () => ({
  getAuth: () => authState,
  clerkClient: { users: { getUser: vi.fn() } },
}));

vi.mock('@db/connection', () => {
  const makeChain = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'from', 'where', 'limit', 'insert', 'values', 'returning', 'update', 'set']) {
      chain[m] = vi.fn(() => chain);
    }
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return chain;
  };
  return {
    db: {
      select: vi.fn(() => {
        // The users lookup in requireResearcher/requireOwner: return a user row
        // only when a role is configured, else empty (→ 403 "not researcher").
        const rows = dbUserRole ? [{ id: 'u1', clerkUserId: authState.userId, username: 'tester', role: dbUserRole, email: null }] : [];
        return makeChain(rows);
      }),
      insert: vi.fn(() => makeChain([{ id: 'u1', clerkUserId: authState.userId, username: 'tester', role: 'user', email: null }])),
      update: vi.fn(() => makeChain([])),
    },
  };
});

/* No config mock: the real config reads OWNER_CLERK_ID (unset in tests → owner
   checks never match the mocked users) and simulation.tickIntervalMs (consumed
   by runtimeConfig, imported transitively by these routers). DATABASE_URL is
   provided by vitest test.env. */

interface Mounted {
  server: Server;
  base: string;
}

async function mount(app: Express): Promise<Mounted> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
}

async function post(base: string, path: string): Promise<number> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return res.status;
}

const ENDPOINTS: { path: string; router: string }[] = [
  { path: '/agents/register', router: '@modules/agents/server/routes/agents' },
  { path: '/campaigns/announce', router: '@modules/elections/server/routes/campaigns' },
  { path: '/parties/create', router: '@modules/elections/server/routes/parties' },
  { path: '/votes/cast', router: '@modules/legislation/server/routes/votes' },
  { path: '/legislation/propose', router: '@modules/legislation/server/routes/legislation' },
  { path: '/legislation/vote', router: '@modules/legislation/server/routes/legislation' },
];

const servers: Server[] = [];

async function appFor(routerPath: string): Promise<Mounted> {
  const mod = await import(routerPath);
  const app = express();
  app.use(express.json());
  app.use(mod.default);
  const m = await mount(app);
  servers.push(m.server);
  return m;
}

afterAll(() => {
  for (const s of servers) s.close();
});

beforeEach(() => {
  authState = { userId: null };
  dbUserRole = null;
});

describe('sim-write endpoints reject unauthenticated callers (401)', () => {
  for (const { path, router } of ENDPOINTS) {
    it(`POST ${path} → 401 with no session`, async () => {
      authState = { userId: null };
      const { base } = await appFor(router);
      expect(await post(base, path)).toBe(401);
    });
  }
});

describe('sim-write endpoints reject signed-in non-researchers (403)', () => {
  for (const { path, router } of ENDPOINTS) {
    it(`POST ${path} → 403 for a plain user`, async () => {
      authState = { userId: 'user_plain' };
      dbUserRole = 'user';
      const { base } = await appFor(router);
      expect(await post(base, path)).toBe(403);
    });
  }
});
