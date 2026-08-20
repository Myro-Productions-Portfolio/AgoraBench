import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction, Router } from 'express';

/**
 * Kind-filter regression (Workstream A1, doctrine-bearing): the 10-K narrates
 * the sim-vs-REALITY comparison, so every agent-facing / gazette reader must
 * filter kind='gazette'. The store below seeds one gazette row and one NEWER
 * ten_k row through a pg-proxy drizzle that honors the kind predicate — any
 * reader that loses its filter gets the ten_k row first and fails here.
 */

const h = vi.hoisted(() => ({
  gazetteRows: [
    /* newest FIRST — the ten_k row wins every unfiltered newest-first read */
    {
      id: '00000000-0000-4000-8000-000000000002',
      tick_id: null,
      kind: 'ten_k',
      headline: 'TEN-K LEAK: reality frame must never reach agents',
      body: 'ten-k body — sim vs reality narrative',
      digest: 'd2',
      created_at: '2026-08-20T02:00:00.000Z',
    },
    {
      id: '00000000-0000-4000-8000-000000000001',
      tick_id: null,
      kind: 'gazette',
      headline: 'Gazette: Housing Act passes the floor',
      body: 'gazette body — sim-internal news',
      digest: 'd1',
      created_at: '2026-08-20T01:00:00.000Z',
    },
  ],
}));

vi.mock('@db/connection', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy');
  const db = drizzle(async (sqlText: string, params: unknown[]) => {
    const lower = sqlText.toLowerCase();
    if (!lower.includes('"gazette_issues"')) return { rows: [] };

    let rows = [...h.gazetteRows];
    const kindMatch = lower.match(/"kind" = \$(\d+)/);
    if (kindMatch) {
      const want = params[Number(kindMatch[1]) - 1];
      rows = rows.filter((r) => r.kind === want);
    }

    if (lower.includes('count(*)')) return { rows: [[rows.length]] };

    const offsetMatch = lower.match(/offset \$(\d+)/);
    if (offsetMatch) rows = rows.slice(Number(params[Number(offsetMatch[1]) - 1]));
    const limitMatch = lower.match(/limit \$(\d+)/);
    if (limitMatch) rows = rows.slice(0, Number(params[Number(limitMatch[1]) - 1]));

    /* Positional projection of the selected column list. */
    const selectList = /select (.*?) from "gazette_issues"/is.exec(sqlText)?.[1] ?? '';
    const cols = [...selectList.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    return { rows: rows.map((r) => cols.map((c) => r[c as keyof typeof r])) };
  });
  return { db };
});

/* Minimal express-router harness: enough req/res for these JSON-only routes. */
function invoke(router: Router, url: string): Promise<{ body: { success: boolean; data: unknown } }> {
  return new Promise((resolve, reject) => {
    const req = {
      url,
      method: 'GET',
      headers: {},
      query: Object.fromEntries(new URL(`http://local${url}`).searchParams),
      params: {},
    } as unknown as Request;
    const res: { statusCode: number; status: (code: number) => typeof res; json: (payload: { success: boolean; data: unknown }) => void } = {
      statusCode: 200,
      status(code: number) { res.statusCode = code; return res; },
      json(payload: { success: boolean; data: unknown }) { resolve({ body: payload }); },
    };
    const next: NextFunction = (err?: unknown) =>
      reject(err instanceof Error ? err : new Error(`unhandled: ${String(err ?? 'no route matched')}`));
    (router as unknown as (rq: Request, rs: Response, nx: NextFunction) => void)(req, res as unknown as Response, next);
  });
}

interface IssueRow { id: string; headline: string }

describe('gazette kind filters (10-K exclusion regression)', () => {
  it('buildRecentNewsBlock never surfaces a ten_k row, even when it is newest', async () => {
    const { buildRecentNewsBlock } = await import('@core/server/services/ai');
    const block = await buildRecentNewsBlock();
    expect(block).toContain('Gazette: Housing Act passes the floor');
    expect(block).not.toContain('TEN-K LEAK');
  });

  it('GET /press/gazette returns only kind=gazette rows and counts only them', async () => {
    const router = (await import('@modules/press/server/routes/press')).default;
    const { body } = await invoke(router, '/press/gazette?limit=10&offset=0');
    const data = body.data as { issues: IssueRow[]; total: number };
    expect(data.total).toBe(1);
    expect(data.issues.map((i) => i.headline)).toEqual(['Gazette: Housing Act passes the floor']);
  });

  it('GET /press/gazette/latest skips the newer ten_k row', async () => {
    const router = (await import('@modules/press/server/routes/press')).default;
    const { body } = await invoke(router, '/press/gazette/latest');
    expect((body.data as IssueRow).headline).toBe('Gazette: Housing Act passes the floor');
  });

  it('GET /press/reports returns only kind=ten_k rows with the gazette pagination shape', async () => {
    const router = (await import('@modules/press/server/routes/press')).default;
    const { body } = await invoke(router, '/press/reports?limit=10&offset=0');
    const data = body.data as { issues: IssueRow[]; total: number };
    expect(data.total).toBe(1);
    expect(data.issues.map((i) => i.headline)).toEqual(['TEN-K LEAK: reality frame must never reach agents']);
    expect(Object.keys(data)).toEqual(['issues', 'total']);
  });
});
