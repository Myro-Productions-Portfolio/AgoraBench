import { describe, it, expect, vi, beforeEach } from 'vitest';

/* finalizeElection.ts is DB-coupled (not pure like electionMath.ts), so this
   mocks @db/connection with the repo's established FIFO-select-results
   chainable-thenable pattern (see macroEngine.test.ts / worldFeedSweep.test.ts
   / worldEventsContext.test.ts). Also mocks @core/server/jobs/agentTick.js —
   that module instantiates a real Bull queue and calls agentTickQueue.process
   at import time (new Bull('agent-tick', config.redis.url) then
   .process(...) — agentTick.ts:141/143), which would attempt a real Redis
   connection if imported for real in a test process. Only updateApproval is
   used by finalizeElection, so only that export needs a stub.

   Covers Finding 2 (review round 1): the outgoing-president block must run
   BEFORE the winner's new positions row is inserted, and must close the old
   row unconditionally — including when the incumbent wins their own
   re-election (same agentId) — so a re-elected incumbent always ends up with
   exactly one active president row carrying a FRESH startDate (tenure clock
   resets). Two scenarios: incumbent wins, incumbent loses to a challenger. */

let rc: Record<string, unknown>;
let selectResults: unknown[][];
let queryError: Error | null;
let insertedRows: { table: string; values: Record<string, unknown> }[];
let updatedCalls: { values: Record<string, unknown> }[];
let updateApprovalCalls: { agentId: string; delta: number; eventType: string }[];
let broadcastCalls: { event: string; payload: unknown }[];

vi.mock('@core/server/runtimeConfig.js', () => ({
  getRuntimeConfig: () => rc,
}));

vi.mock('@core/server/websocket.js', () => ({
  broadcast: (event: string, payload: unknown) => {
    broadcastCalls.push({ event, payload });
  },
}));

vi.mock('@core/server/jobs/agentTick.js', () => ({
  updateApproval: async (agentId: string, delta: number, eventType: string) => {
    updateApprovalCalls.push({ agentId, delta, eventType });
  },
}));

vi.mock('@db/connection', () => {
  const chain: Record<string, unknown> = {};
  let pendingInsertTable = '';
  /* Every awaited db.<verb>()...chain resolves through the SAME thenable
     (drizzle's real query builders work the same way) — select, update, AND
     insert calls all eventually get awaited somewhere in finalizeElection
     (2 bare updates + 1 select between winnerAgent and winnerPriorPositions
     alone). A single shared FIFO keyed only on "any await" over-consumes:
     the update()/insert() calls silently eat slots meant for later
     select()s, desyncing the queue (this bit a first draft of this mock —
     the outgoing-president select ended up reading an empty placeholder
     because 2 unaccounted update() awaits shifted the queue early). Fix:
     tag which verb started the current chain and only the 'select' path
     consumes selectResults; update/insert resolve to [] without touching
     the select queue (their return value is never used except via the
     explicit .returning() override below). */
  let currentOp: 'select' | 'update' | 'insert' | null = null;

  for (const m of ['from', 'where', 'groupBy', 'limit', 'onConflictDoUpdate']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.select = vi.fn(() => {
    currentOp = 'select';
    return chain;
  });
  chain.insert = vi.fn((table: unknown) => {
    currentOp = 'insert';
    /* Distinguish target table by identity against the schema objects the
       real module imports — cheapest reliable signal without re-importing
       drizzle internals. Tests only assert insert HAPPENED + its values, so
       a generic 'unknown' bucket is fine when identity doesn't resolve. */
    pendingInsertTable = (table as { [Symbol.toStringTag]?: string })?.[Symbol.toStringTag] ?? 'unknown';
    return chain;
  });
  chain.update = vi.fn(() => {
    currentOp = 'update';
    return chain;
  });
  chain.values = vi.fn((v: Record<string, unknown>) => {
    insertedRows.push({ table: pendingInsertTable, values: v });
    return chain;
  });
  /* set() carries the write payload for update() calls (values() is
     insert-only in drizzle) — capture there. */
  chain.set = vi.fn((v: Record<string, unknown>) => {
    updatedCalls.push({ values: v });
    return chain;
  });
  chain.returning = vi.fn(() => Promise.resolve([{ id: 'new-position-id' }]));
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
    if (queryError) return Promise.reject(queryError).then(resolve, reject);
    const op = currentOp;
    currentOp = null;
    if (op !== 'select') return Promise.resolve([]).then(resolve, reject);
    const next = selectResults.shift() ?? [];
    return Promise.resolve(next).then(resolve, reject);
  };
  return { db: chain };
});

async function loadFinalize() {
  vi.resetModules();
  return import('@modules/elections/server/finalizeElection');
}

beforeEach(() => {
  rc = {
    electoralCollegeEnabled: false,
    electionPostOutcomeCascade: false,
    presidentTermDays: 90,
    congressTermDays: 60,
  };
  selectResults = [];
  queryError = null;
  insertedRows = [];
  updatedCalls = [];
  updateApprovalCalls = [];
  broadcastCalls = [];
});

/* Queues the fixed sequence of db.select() results finalizeElection makes,
   in call order, for a presidential election with no winnerId set yet
   (so the idempotency select is skipped):
   1. election row
   2. campaignTotals (grouped, active campaigns)
   3. castBallots
   4. winnerAgent
   5. winnerPriorPositions
   6. outgoingPresident (positionType === 'president' only) */
function queueSelects(opts: {
  election: Record<string, unknown>;
  campaignTotals: Record<string, unknown>[];
  castBallots: Record<string, unknown>[];
  winnerAgent: Record<string, unknown>[];
  winnerPriorPositions: Record<string, unknown>[];
  outgoingPresident: Record<string, unknown>[];
}) {
  selectResults.push(
    [opts.election],
    opts.campaignTotals,
    opts.castBallots,
    opts.winnerAgent,
    opts.winnerPriorPositions,
    opts.outgoingPresident,
  );
}

describe('finalizeElection — presidential outgoing-incumbent handoff', () => {
  it('incumbent WINS re-election: old row closed before new row inserted, exactly one active-row write, fresh startDate', async () => {
    const electionId = 'election-1';
    const incumbentId = 'agent-incumbent';
    const oldPositionId = 'pos-old-term';

    queueSelects({
      election: { id: electionId, positionType: 'president', winnerId: null, status: 'voting' },
      campaignTotals: [{ agentId: incumbentId, totalContributions: 500, startDate: '2026-01-01T00:00:00Z', campaignId: 'camp-1' }],
      castBallots: [{ candidateId: incumbentId, voterId: 'voter-1' }],
      winnerAgent: [{ id: incumbentId, displayName: 'Incumbent Agent' }],
      winnerPriorPositions: [{ id: oldPositionId, type: 'president' }],
      outgoingPresident: [{ id: oldPositionId, agentId: incumbentId }],
    });

    const { finalizeElection } = await loadFinalize();
    const result = await finalizeElection(electionId);

    expect(result.status).toBe('ok');
    expect(result.winnerId).toBe(incumbentId);

    /* The old term row must be closed out (isActive:false) exactly once. */
    const closeOldRow = updatedCalls.find(
      (c) => c.values['isActive'] === false && 'endDate' in c.values,
    );
    expect(closeOldRow).toBeDefined();

    /* getSeatsToVacate must NOT also try to vacate the same seat a second
       time — winnerPriorPositions contains only the equal-rank 'president'
       row, which officeRank excludes (strict <), so no seatIdsToVacate
       update should fire beyond the single outgoing-handoff close-out. Two
       different isActive:false updates would indicate the equal-rank seat
       got double-processed. */
    const isActiveFalseUpdates = updatedCalls.filter((c) => c.values['isActive'] === false);
    expect(isActiveFalseUpdates).toHaveLength(1);

    /* A fresh positions row was inserted with startDate freshly set (not
       reusing the old row) — the new-row insert always stamps startDate to
       `now`, which is what resets the tenure clock. Assert an insert
       happened carrying isActive:true and a startDate field (i.e. the
       actual winner-row insert, not some other insert). */
    const newRowInsert = insertedRows.find(
      (r) => r.values['isActive'] === true && r.values['agentId'] === incumbentId && r.values['type'] === 'president',
    );
    expect(newRowInsert).toBeDefined();
    expect(newRowInsert!.values['startDate']).toBeInstanceOf(Date);
  });

  it('incumbent LOSES: outgoing agent row closed, winner (different agent) gets the new row', async () => {
    const electionId = 'election-2';
    const incumbentId = 'agent-incumbent';
    const challengerId = 'agent-challenger';
    const oldPositionId = 'pos-outgoing-term';

    queueSelects({
      election: { id: electionId, positionType: 'president', winnerId: null, status: 'voting' },
      campaignTotals: [
        { agentId: incumbentId, totalContributions: 100, startDate: '2026-01-01T00:00:00Z', campaignId: 'camp-1' },
        { agentId: challengerId, totalContributions: 900, startDate: '2026-01-02T00:00:00Z', campaignId: 'camp-2' },
      ],
      castBallots: [
        { candidateId: challengerId, voterId: 'voter-1' },
        { candidateId: challengerId, voterId: 'voter-2' },
        { candidateId: incumbentId, voterId: 'voter-3' },
      ],
      winnerAgent: [{ id: challengerId, displayName: 'Challenger Agent' }],
      winnerPriorPositions: [], // challenger held no prior offices
      outgoingPresident: [{ id: oldPositionId, agentId: incumbentId }],
    });

    const { finalizeElection } = await loadFinalize();
    const result = await finalizeElection(electionId);

    expect(result.status).toBe('ok');
    expect(result.winnerId).toBe(challengerId);

    const closeOldRow = updatedCalls.find(
      (c) => c.values['isActive'] === false && 'endDate' in c.values,
    );
    expect(closeOldRow).toBeDefined();

    const isActiveFalseUpdates = updatedCalls.filter((c) => c.values['isActive'] === false);
    expect(isActiveFalseUpdates).toHaveLength(1);

    const newRowInsert = insertedRows.find(
      (r) => r.values['isActive'] === true && r.values['agentId'] === challengerId && r.values['type'] === 'president',
    );
    expect(newRowInsert).toBeDefined();

    /* Loser (incumbent) approval delta should have fired, not a winner delta. */
    const incumbentApproval = updateApprovalCalls.find((c) => c.agentId === incumbentId);
    expect(incumbentApproval?.eventType).toBe('election_lost');
    const challengerApproval = updateApprovalCalls.find((c) => c.agentId === challengerId);
    expect(challengerApproval?.eventType).toBe('election_won');
  });

  it('B4: passing tickNumber stamps startTick on the winner row and certifiedTick on the election', async () => {
    const electionId = 'election-tick';
    const winnerId = 'agent-winner';

    queueSelects({
      election: { id: electionId, positionType: 'president', winnerId: null, status: 'voting' },
      campaignTotals: [{ agentId: winnerId, totalContributions: 500, startDate: '2026-01-01T00:00:00Z', campaignId: 'camp-1' }],
      castBallots: [{ candidateId: winnerId, voterId: 'voter-1' }],
      winnerAgent: [{ id: winnerId, displayName: 'Winner Agent' }],
      winnerPriorPositions: [],
      outgoingPresident: [],
    });

    const { finalizeElection } = await loadFinalize();
    const result = await finalizeElection(electionId, 742);
    expect(result.status).toBe('ok');

    const positionInsert = insertedRows.find(
      (r) => r.values['isActive'] === true && r.values['type'] === 'president',
    );
    expect(positionInsert!.values['startTick']).toBe(742);

    const certifyUpdate = updatedCalls.find((c) => c.values['status'] === 'certified');
    expect(certifyUpdate!.values['certifiedTick']).toBe(742);
  });

  it('B4: omitting tickNumber (legacy/out-of-tick callers without a clock) stamps null anchors — wall-clock behavior preserved', async () => {
    const electionId = 'election-no-tick';
    const winnerId = 'agent-winner';

    queueSelects({
      election: { id: electionId, positionType: 'president', winnerId: null, status: 'voting' },
      campaignTotals: [{ agentId: winnerId, totalContributions: 500, startDate: '2026-01-01T00:00:00Z', campaignId: 'camp-1' }],
      castBallots: [{ candidateId: winnerId, voterId: 'voter-1' }],
      winnerAgent: [{ id: winnerId, displayName: 'Winner Agent' }],
      winnerPriorPositions: [],
      outgoingPresident: [],
    });

    const { finalizeElection } = await loadFinalize();
    const result = await finalizeElection(electionId);
    expect(result.status).toBe('ok');

    const positionInsert = insertedRows.find(
      (r) => r.values['isActive'] === true && r.values['type'] === 'president',
    );
    expect(positionInsert!.values['startTick']).toBeNull();

    const certifyUpdate = updatedCalls.find((c) => c.values['status'] === 'certified');
    expect(certifyUpdate!.values['certifiedTick']).toBeNull();
  });

  it('non-presidential election (congress_member): no outgoing-handoff query, only the double-position vacate path applies', async () => {
    const electionId = 'election-3';
    const winnerId = 'agent-winner';

    selectResults.push(
      [{ id: electionId, positionType: 'congress_member', winnerId: null, status: 'voting' }],
      [{ agentId: winnerId, totalContributions: 100, startDate: '2026-01-01T00:00:00Z', campaignId: 'camp-1' }],
      [{ candidateId: winnerId, voterId: 'voter-1' }],
      [{ id: winnerId, displayName: 'Winner Agent' }],
      [], // winnerPriorPositions — no outgoing-handoff select for non-president
    );

    const { finalizeElection } = await loadFinalize();
    const result = await finalizeElection(electionId);

    expect(result.status).toBe('ok');
    /* No isActive:false update should have fired — winnerPriorPositions is
       empty and this isn't a presidential election, so neither vacate path
       has anything to close. */
    const isActiveFalseUpdates = updatedCalls.filter((c) => c.values['isActive'] === false);
    expect(isActiveFalseUpdates).toHaveLength(0);
  });
});

/* Queues the select sequence the congress_general multi-seat branch makes
   (status not yet 'certified'):
   1. election row
   2. campaignTotals
   3. castBallots
   4. winnerAgents (batch)
   5. winnersPriorPositions (batch, after the chamber close) */
function queueCongressSelects(opts: {
  election: Record<string, unknown>;
  campaignTotals: Record<string, unknown>[];
  castBallots: Record<string, unknown>[];
  winnerAgents: Record<string, unknown>[];
  winnersPriorPositions: Record<string, unknown>[];
}) {
  selectResults.push(
    [opts.election],
    opts.campaignTotals,
    opts.castBallots,
    opts.winnerAgents,
    opts.winnersPriorPositions,
  );
}

describe('finalizeElection — congress_general multi-seat (B3)', () => {
  const electionId = 'election-cg';
  const threeCandidates = [
    { agentId: 'c1', totalContributions: 100, startDate: '2026-01-01T00:00:00Z', campaignId: 'camp-1' },
    { agentId: 'c2', totalContributions: 300, startDate: '2026-01-02T00:00:00Z', campaignId: 'camp-2' },
    { agentId: 'c3', totalContributions: 200, startDate: '2026-01-03T00:00:00Z', campaignId: 'camp-3' },
  ];

  it('seats exactly congressSeats winners as congress_member rows with startTick; chamber+speaker close fires once; certify update carries winnerId=top vote-getter and certifiedTick', async () => {
    rc['congressSeats'] = 2;
    queueCongressSelects({
      election: { id: electionId, positionType: 'congress_general', winnerId: null, status: 'voting' },
      campaignTotals: threeCandidates,
      castBallots: [
        { candidateId: 'c1', voterId: 'v1' },
        { candidateId: 'c1', voterId: 'v2' },
        { candidateId: 'c1', voterId: 'v3' },
        { candidateId: 'c3', voterId: 'v4' },
        { candidateId: 'c3', voterId: 'v5' },
        { candidateId: 'c2', voterId: 'v6' },
      ],
      winnerAgents: [
        { id: 'c1', displayName: 'Winner One' },
        { id: 'c3', displayName: 'Winner Three' },
      ],
      winnersPriorPositions: [],
    });

    const { finalizeElection } = await loadFinalize();
    const result = await finalizeElection(electionId, 900);

    expect(result.status).toBe('ok');
    expect(result.winnerId).toBe('c1'); // top vote-getter (display compat)
    expect(result.loserIds).toEqual(['c2']);
    expect(result.totalVotes).toBe(6);

    /* Exactly N seat inserts, all congress_member with tick-stamped startTick. */
    const seatInserts = insertedRows.filter((r) => r.values['type'] === 'congress_member');
    expect(seatInserts).toHaveLength(2);
    for (const seat of seatInserts) {
      expect(seat.values['isActive']).toBe(true);
      expect(seat.values['startTick']).toBe(900);
    }
    expect(seatInserts.map((s) => s.values['agentId']).sort()).toEqual(['c1', 'c3']);

    /* The chamber ends with the term: exactly ONE isActive:false update (the
       congress_member+speaker close — winnersPriorPositions holds nothing
       ranked below the seat, so the per-winner vacate adds no second one). */
    const closes = updatedCalls.filter((c) => c.values['isActive'] === false);
    expect(closes).toHaveLength(1);

    /* Terminal certify update: status/winnerId/certifiedTick — written LAST
       so the status==='certified' idempotency check only passes on a
       completed run. */
    const certify = updatedCalls[updatedCalls.length - 1]!;
    expect(certify.values['status']).toBe('certified');
    expect(certify.values['winnerId']).toBe('c1');
    expect(certify.values['certifiedTick']).toBe(900);

    /* Activity metadata carries the full winner/loser sets for Phase 11.5. */
    const activity = insertedRows.find((r) => typeof r.values['metadata'] === 'string' && String(r.values['metadata']).includes('winnerIds'));
    expect(activity).toBeDefined();
    const meta = JSON.parse(String(activity!.values['metadata'])) as Record<string, unknown>;
    expect(meta['winnerIds']).toEqual(['c1', 'c3']);
    expect(meta['loserIds']).toEqual(['c2']);

    /* Cascades per set. */
    expect(updateApprovalCalls.filter((c) => c.eventType === 'election_won').map((c) => c.agentId).sort()).toEqual(['c1', 'c3']);
    expect(updateApprovalCalls.filter((c) => c.eventType === 'election_lost').map((c) => c.agentId)).toEqual(['c2']);
  });

  it('EC is structurally impossible for congress_general: even with electoralCollegeEnabled the popular ranking decides and no electoralCollege note is written', async () => {
    rc['congressSeats'] = 1;
    rc['electoralCollegeEnabled'] = true;
    queueCongressSelects({
      election: { id: electionId, positionType: 'congress_general', winnerId: null, status: 'voting' },
      campaignTotals: threeCandidates,
      castBallots: [
        { candidateId: 'c2', voterId: 'v1' },
        { candidateId: 'c2', voterId: 'v2' },
        { candidateId: 'c1', voterId: 'v3' },
      ],
      winnerAgents: [{ id: 'c2', displayName: 'Winner Two' }],
      winnersPriorPositions: [],
    });

    const { finalizeElection } = await loadFinalize();
    const result = await finalizeElection(electionId, 901);

    expect(result.status).toBe('ok');
    expect(result.winnerId).toBe('c2');
    for (const row of insertedRows) {
      if (typeof row.values['metadata'] === 'string') {
        expect(String(row.values['metadata'])).not.toContain('electoralCollege');
      }
    }
  });

  it('zero ballots: winners come from the contributions -> registration-order chain; seats min(N, candidates)', async () => {
    rc['congressSeats'] = 5; // more seats than candidates
    queueCongressSelects({
      election: { id: electionId, positionType: 'congress_general', winnerId: null, status: 'voting' },
      campaignTotals: threeCandidates,
      castBallots: [],
      winnerAgents: [
        { id: 'c2', displayName: 'Winner Two' },
        { id: 'c3', displayName: 'Winner Three' },
        { id: 'c1', displayName: 'Winner One' },
      ],
      winnersPriorPositions: [],
    });

    const { finalizeElection } = await loadFinalize();
    const result = await finalizeElection(electionId, 902);

    expect(result.status).toBe('ok');
    expect(result.winnerId).toBe('c2'); // highest contributions
    const seatInserts = insertedRows.filter((r) => r.values['type'] === 'congress_member');
    expect(seatInserts).toHaveLength(3);
  });

  it('idempotency: an already-certified congress_general returns already_finalized with zero side effects', async () => {
    selectResults.push(
      [{ id: electionId, positionType: 'congress_general', winnerId: 'c1', status: 'certified' }],
    );

    const { finalizeElection } = await loadFinalize();
    const result = await finalizeElection(electionId, 903);

    expect(result.status).toBe('already_finalized');
    expect(insertedRows).toHaveLength(0);
    expect(updatedCalls).toHaveLength(0);
  });
});

describe('finalizeElection — presidential path regression pins (B3)', () => {
  it('presidential single-winner select order and behavior are unchanged by the multi-seat branch (same queue as before B3)', async () => {
    const electionId = 'election-pin';
    const winnerId = 'agent-winner';
    queueSelects({
      election: { id: electionId, positionType: 'president', winnerId: null, status: 'voting' },
      campaignTotals: [{ agentId: winnerId, totalContributions: 500, startDate: '2026-01-01T00:00:00Z', campaignId: 'camp-1' }],
      castBallots: [{ candidateId: winnerId, voterId: 'voter-1' }],
      winnerAgent: [{ id: winnerId, displayName: 'Winner Agent' }],
      winnerPriorPositions: [],
      outgoingPresident: [],
    });

    const { finalizeElection } = await loadFinalize();
    const result = await finalizeElection(electionId, 904);

    expect(result.status).toBe('ok');
    expect(result.winnerId).toBe(winnerId);
    const presInsert = insertedRows.find((r) => r.values['type'] === 'president');
    expect(presInsert).toBeDefined();
    /* Exactly one winner seat — never a multi-seat batch. */
    expect(insertedRows.filter((r) => r.values['type'] === 'president')).toHaveLength(1);
  });
});
