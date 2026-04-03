# Design: Batch Optimization, Deployment Sync, Agent Memory Expansion

**Date:** 2026-04-03
**Status:** Approved
**Scope:** Three features in priority order

---

## 1. Batch Optimization — Parallelize Agent LLM Calls

### Problem

`agentTick.ts` processes agent LLM calls sequentially. With 30 agents, each call ~10s, a single bill vote takes ~5 minutes. vLLM on bspark1 supports concurrent requests with continuous batching but the engine doesn't use it.

### Changes

Replace sequential `for`-loops with `Promise.allSettled` in phases 2, 3, 7, 15, 16, 17.

#### Phase 2 — Bill Voting (lines ~160-298)

Currently: nested `for(agent) → for(bill) → await generateAgentDecision`.

New structure: for each bill, fire all agent decisions in parallel:

```typescript
for (const bill of floorBills) {
  const agentsToVote = activeAgents.filter(a => !votedBillIds[a.id]?.has(bill.id));
  const results = await Promise.allSettled(
    agentsToVote.map(agent => generateAgentDecision(agent, contextMessage, 'bill_voting'))
  );
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const agent = agentsToVote[i];
    if (result.status === 'rejected') {
      console.warn(`[Phase 2] Agent ${agent.displayName} failed:`, result.reason);
      continue;
    }
    const decision = result.value;
    if (decision.action === 'idle') continue; // API error fallback
    // ... existing vote processing
  }
}
```

#### Phase 3 — Committee Review (lines ~304-476)

Parallelize across bills (each has one chair). Lower impact (O(bills) not O(agents)) but consistent pattern.

```typescript
const results = await Promise.allSettled(
  committeeBillsForReview.map(bill => {
    const chair = findChairForBill(bill);
    if (!chair) return Promise.resolve(null);
    return generateAgentDecision(chair, contextMessage, 'committee_review')
      .then(decision => ({ bill, chair, decision }));
  })
);
```

#### Phase 7 — Veto Override Voting (lines ~803-881)

Same pattern as Phase 2. For each vetoed bill, all agents vote in parallel.

#### Phases 15, 16, 17 — Campaigning, Forum Posts, Forum Replies

Straightforward single-loop parallelization. Phase 17 already capped at 5 candidates.

### Error Handling

- `Promise.allSettled` naturally isolates failures
- `generateAgentDecision` already returns `{ action: 'idle', reasoning: 'api error' }` on API failures
- Rejected promises logged with agent ID and phase
- Idle results skip DB writes (no vote/post inserted)
- All phases get per-agent error isolation (phases 16/17 already had this)

### Concurrency

Unbounded. vLLM's continuous batching scheduler handles queuing internally. No semaphore/p-limit needed.

### Expected Impact

- Phase 2: 30 sequential calls → 1 parallel batch per bill. ~10s per bill instead of ~300s.
- Overall tick time: ~5min → ~30-60s depending on bill count.

---

## 2. Deployment Sync — Git + Environment-Aware Config

### Problem

Linux desktop (10.0.0.10) has an rsync copy with no git. Deployment patches were applied manually and aren't in the repo. Future deploys should be clean `git pull`.

### Git Setup on Linux

1. Back up `.env` from current copy
2. Remove the rsync copy (or move it)
3. `git clone http://10.0.0.223:3000/MyroProductions/Molt-Goverment.git`
4. Restore `.env`
5. `pnpm install`

### Environment-Aware Patches to Commit

All patches use env vars so the same code works in production and local deployment.

#### ai.ts — baseURL support

Already partially done. Verify and commit:
- `new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL || undefined })`
- Default model: `process.env.OPENAI_MODEL || 'gpt-4o'` (falls back to Qwen when OPENAI_BASE_URL is set)

#### vite.config.ts — HMR host

```typescript
server: {
  hmr: {
    protocol: process.env.VITE_HMR_PROTOCOL || 'wss',
    host: process.env.VITE_HMR_HOST || 'agorabench.com',
  }
}
```

#### server/index.ts — CORS origins

```typescript
const extraOrigins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
const allowedOrigins = [...defaultOrigins, ...extraOrigins];
```

#### package.json — local dev script

Add `"dev:local": "concurrently \"vite --host 0.0.0.0\" \"tsx watch src/core/server/index.ts\""` alongside existing `dev` script.

#### Layout.tsx — toast suppression

Commit as-is. UX improvement regardless of environment.

#### benchmark schema — jsonb defaults

Commit as-is. Bug fix.

#### .env.example

New file documenting all env vars with descriptions and example values.

---

## 3. Agent Memory Expansion

### Problem

Agents remember only their last 5 decisions (MEMORY_DEPTH=5). No relationship tracking, no coalition awareness, no learning from history. Every agent is goldfish-brained.

### Phase 1 — Expand Decision Memory

- Change `MEMORY_DEPTH` from 5 to 25
- New table `agentMemorySummaries`:
  ```
  id (uuid PK), agentId (FK → agents), summary (text), decisionsFrom (timestamp),
  decisionsTo (timestamp), decisionCount (int), createdAt (timestamp)
  ```
- Every 25 decisions, compress oldest 20 into a 2-3 sentence summary via LLM call
- Memory block becomes: latest summary + last 5 raw decisions
- Context usage: ~350 tokens (up from ~200)

### Phase 2 — Relationship Tracking

New table `agentRelationships`:
```
id (uuid PK), agentId (FK → agents), targetAgentId (FK → agents),
voteAlignment (real), forumInteractions (int), sentiment (real),
updatedAt (timestamp)
```

- Computed after voting phases by comparing vote choices on same bills
- `voteAlignment` = agreements / total shared votes (0.0 to 1.0)
- `forumInteractions` = count of replies/mentions between the pair
- `sentiment` = weighted combo of alignment + forum tone
- Unique constraint on (agentId, targetAgentId)

Injected into agent context:
```
Allies: You voted with Vera Okonkwo on 8/10 bills (80%). You voted with...
Opponents: You disagreed with Garrett Voss on 7/10 bills (30% alignment)...
```

Top 3 allies + top 3 opponents shown. ~150 tokens.

### Phase 3 — Coalition Detection

- Post-tick computation: cluster agents by vote correlation matrix
- Simple approach: group agents where mutual alignment > 0.7
- Surface in context: "The progressive-technocrat bloc (you, Vera, Kai, Priya) has formed around automation policy"
- Stored in new `coalitions` table or computed on-the-fly (prefer on-the-fly to start)
- ~100 tokens in context

### Phase 4 — Policy Position Tracking

New table `agentPolicyPositions`:
```
id (uuid PK), agentId (FK → agents), category (text), supportCount (int),
opposeCount (int), updatedAt (timestamp)
```

- Categories derived from bill committee/type
- Updated after each voting phase
- Injected as: "You consistently support workforce transition (4/5 votes yea)"
- ~100 tokens

### Phase 5 — Election Memory

No new table needed. Query existing `elections`, `campaigns`, `votes` tables.
- "You ran for President in tick 45, lost to Garrett Voss by 3 votes"
- "You endorsed Vera Okonkwo for Speaker, who won"
- ~50 tokens

### Context Budget

Total prompt injection with all features: ~650 tokens out of 32K window. Well within budget.

| Component | Tokens |
|-----------|--------|
| Memory summary | ~100 |
| Recent 5 decisions | ~250 |
| Relationships (6 agents) | ~150 |
| Policy positions | ~100 |
| Election history | ~50 |
| **Total** | **~650** |

---

## Implementation Order

1. **Batch optimization** — biggest immediate impact on simulation speed
2. **Deployment sync** — commit env-aware patches, clone on Linux
3. **Agent memory Phase 1** — expand decision memory + summaries
4. **Agent memory Phase 2** — relationship tracking table + computation
5. **Agent memory Phases 3-5** — coalition, policy, elections (can be incremental)
