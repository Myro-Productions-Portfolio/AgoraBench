# Batch Optimization, Deployment Sync, Agent Memory Expansion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce tick time from ~5min to ~30s by parallelizing LLM calls, properly sync the Linux deployment via git, and give agents long-term memory with relationship tracking.

**Architecture:** Batch optimization replaces sequential for-loops in agentTick.ts phases 2/3/7/15/16/17 with Promise.allSettled. Deployment sync commits environment-aware patches (env var guards) and clones from Gitea on the Linux box. Agent memory adds new DB tables for summaries, relationships, and policy positions, with expanded context injection in ai.ts.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, vLLM (OpenAI-compatible), Bull queue, Vite, Express

---

## File Map

### Batch Optimization
- **Modify:** `src/core/server/jobs/agentTick.ts` — replace sequential loops in phases 2, 3, 7, 15, 16, 17
- **Modify:** `src/core/server/services/ai.ts:461-462` — add baseURL support to callOpenAI
- **Modify:** `src/core/server/services/ai.ts:403-410` — add OPENAI_MODEL env var to getDefaultModel

### Deployment Sync
- **Modify:** `src/core/server/services/ai.ts:461-462` — (same: baseURL)
- **Modify:** `vite.config.ts:61-68` — env-var HMR config
- **Modify:** `src/core/server/index.ts:26-30` — CORS_ORIGINS env var
- **Modify:** `package.json:8` — add dev:local script
- **Modify:** `.env.example` — document new env vars
- **No change needed:** `src/modules/benchmark/db/schema/benchmark.ts` — jsonb defaults already correct
- **No change needed:** `src/core/client/components/Layout.tsx:129-131` — toast suppression already in place (just needs committing)

### Agent Memory Expansion
- **Create:** `src/modules/agents/db/schema/agentRelationships.ts` — relationship tracking table
- **Create:** `src/modules/agents/db/schema/agentPolicyPositions.ts` — policy position tracking table
- **Create:** `src/modules/agents/db/schema/agentMemorySummaries.ts` — decision summaries table
- **Modify:** `src/core/db/schema/index.ts` — export new tables
- **Modify:** `src/core/server/services/ai.ts:33,125-159,356-381` — expand MEMORY_DEPTH, add relationship/policy/election context blocks, update buildSystemPrompt
- **Modify:** `src/core/server/jobs/agentTick.ts` — add post-voting relationship computation

---

## Task 1: Add baseURL support to OpenAI client + OPENAI_MODEL env var

**Files:**
- Modify: `src/core/server/services/ai.ts:403-410,461-462`
- Modify: `.env.example`

- [ ] **Step 1: Add baseURL to callOpenAI**

In `src/core/server/services/ai.ts`, change the `callOpenAI` function (line 461-462):

```typescript
// Before:
async function callOpenAI(apiKey: string, model: string, systemPrompt: string, contextMessage: string, maxTokens: number): Promise<string> {
  const client = new OpenAI({ apiKey });

// After:
async function callOpenAI(apiKey: string, model: string, systemPrompt: string, contextMessage: string, maxTokens: number): Promise<string> {
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
```

- [ ] **Step 2: Add OPENAI_MODEL to getDefaultModel**

In `src/core/server/services/ai.ts`, change `getDefaultModel` (line 403-410):

```typescript
// Before:
function getDefaultModel(provider: string): string {
  switch (provider) {
    case 'anthropic': return config.anthropic.model;
    case 'openai': return 'gpt-4o-mini';

// After:
function getDefaultModel(provider: string): string {
  switch (provider) {
    case 'anthropic': return config.anthropic.model;
    case 'openai': return process.env.OPENAI_MODEL || 'gpt-4o-mini';
```

- [ ] **Step 3: Update .env.example**

Append to `.env.example` after the OPENAI_API_KEY line:

```
# Optional: Override OpenAI base URL for vLLM or other OpenAI-compatible backends
# OPENAI_BASE_URL=http://10.0.0.69:8000/v1
# Optional: Override default OpenAI model (default: gpt-4o-mini)
# OPENAI_MODEL=Qwen/Qwen2.5-72B-Instruct-AWQ
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && pnpm typecheck`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/core/server/services/ai.ts .env.example
git commit -m "feat: add OPENAI_BASE_URL and OPENAI_MODEL env var support for vLLM"
```

---

## Task 2: Environment-aware vite.config.ts

**Files:**
- Modify: `vite.config.ts:61-68`

- [ ] **Step 1: Replace hardcoded HMR config with env vars**

In `vite.config.ts`, replace lines 61-68:

```typescript
// Before:
  server: {
    port: 5173,
    allowedHosts: ['agorabench.com', 'www.agorabench.com'],
    hmr: {
      protocol: 'wss',
      host: 'agorabench.com',
      clientPort: 443,
    },

// After:
  server: {
    port: 5173,
    host: process.env.VITE_HOST === 'true' ? '0.0.0.0' : undefined,
    allowedHosts: ['agorabench.com', 'www.agorabench.com'],
    hmr: process.env.VITE_HMR_HOST
      ? {
          protocol: process.env.VITE_HMR_PROTOCOL || 'ws',
          host: process.env.VITE_HMR_HOST,
        }
      : {
          protocol: 'wss',
          host: 'agorabench.com',
          clientPort: 443,
        },
```

- [ ] **Step 2: Update .env.example**

Append to `.env.example`:

```
# =============================================================================
# VITE DEV SERVER (local deployment only — not needed for production)
# =============================================================================
# VITE_HOST=true                    # Bind to 0.0.0.0 for LAN access
# VITE_HMR_HOST=0.0.0.0            # HMR websocket host (omit for production wss://agorabench.com)
# VITE_HMR_PROTOCOL=ws             # HMR protocol: ws for local, wss for production
```

- [ ] **Step 3: Verify vite config loads**

Run: `cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && npx vite --help > /dev/null 2>&1 && echo "OK"`
Expected: OK (no syntax errors in config)

- [ ] **Step 4: Commit**

```bash
git add vite.config.ts .env.example
git commit -m "feat: environment-aware vite HMR config for local deployment"
```

---

## Task 3: CORS_ORIGINS env var

**Files:**
- Modify: `src/core/server/index.ts:26-30`

- [ ] **Step 1: Add CORS_ORIGINS env var support**

In `src/core/server/index.ts`, replace lines 26-30:

```typescript
// Before:
const ALLOWED_ORIGINS = [
  config.clientUrl,
  'https://agorabench.com',
  'https://www.agorabench.com',
];

// After:
const extraOrigins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
const ALLOWED_ORIGINS = [
  config.clientUrl,
  'https://agorabench.com',
  'https://www.agorabench.com',
  ...extraOrigins,
];
```

- [ ] **Step 2: Update .env.example**

Append to `.env.example`:

```
# =============================================================================
# CORS (local deployment only)
# =============================================================================
# CORS_ORIGINS=http://10.0.0.10:5173,http://100.x.x.x:5173
```

- [ ] **Step 3: Verify typecheck**

Run: `cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/core/server/index.ts .env.example
git commit -m "feat: add CORS_ORIGINS env var for local deployment origins"
```

---

## Task 4: Add dev:local script to package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add dev:local script**

In `package.json`, after the `"dev"` script line (line 8), add:

```json
"dev:local": "concurrently \"pnpm dev:server\" \"vite --host 0.0.0.0\"",
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "feat: add dev:local script for LAN-accessible dev server"
```

---

## Task 5: Parallelize Phase 2 — Bill Voting

This is the highest-impact change. Currently O(agents x bills) sequential LLM calls.

**Files:**
- Modify: `src/core/server/jobs/agentTick.ts:160-298`

- [ ] **Step 1: Restructure Phase 2 to parallelize per-bill**

Replace lines 167-294 (inside the `else` block after `floorBills.length === 0` check) with:

```typescript
      const floorBillIds = floorBills.map((b) => b.id);

      /* Build agent -> partyId map */
      const allMemberships = await db.select().from(partyMemberships);
      const agentPartyMap = new Map<string, string>();
      for (const m of allMemberships) {
        agentPartyMap.set(m.agentId, m.partyId);
      }

      /* Pre-fetch all existing votes for floor bills in one query */
      const allExistingVotes = await db
        .select({ billId: billVotes.billId, voterId: billVotes.voterId })
        .from(billVotes)
        .where(and(
          inArray(billVotes.billId, floorBillIds),
          inArray(billVotes.voterId, activeAgents.map((a) => a.id)),
        ));
      const votedSet = new Set(allExistingVotes.map((v) => `${v.voterId}:${v.billId}`));

      /* Track votes per agent for absenteeism check */
      const agentVoteCounts = new Map<string, number>();

      for (const bill of floorBills) {
        /* Determine which agents need to vote on this bill */
        const agentsToVote: typeof activeAgents = [];
        const whipChoices = new Map<string, string>(); // agentId -> whip-forced choice

        for (const agent of activeAgents) {
          if (votedSet.has(`${agent.id}:${bill.id}`)) continue;

          const agentPartyId = agentPartyMap.get(agent.id);
          const billSignals = whipSignals.get(bill.id);
          const whipSignal = agentPartyId && billSignals ? billSignals.get(agentPartyId) : undefined;

          /* 78% chance to follow whip signal — no LLM call needed */
          if (whipSignal && Math.random() < rc.partyWhipFollowRate) {
            whipChoices.set(agent.id, whipSignal);
          } else {
            agentsToVote.push(agent);
          }
        }

        /* Build context message for this bill (shared across agents) */
        const baseContext =
          `Bill up for vote: "${bill.title}". ` +
          `Summary: ${bill.summary}. ` +
          `Committee: ${bill.committee}. `;

        /* Fire all LLM calls for this bill in parallel */
        const results = await Promise.allSettled(
          agentsToVote.map((agent) => {
            const agentPartyId = agentPartyMap.get(agent.id);
            const billSignals2 = whipSignals.get(bill.id);
            const whipSignal = agentPartyId && billSignals2 ? billSignals2.get(agentPartyId) : undefined;
            const whipNote = whipSignal
              ? ` Your party recommends voting ${whipSignal}. You may follow or vote independently.`
              : '';
            const contextMessage =
              baseContext + whipNote +
              ` Respond with exactly this JSON structure: {"action":"vote","reasoning":"one sentence","data":{"choice":"yea"}} ` +
              `Use "yea" to support or "nay" to oppose.`;

            return generateAgentDecision(
              {
                id: agent.id,
                displayName: agent.displayName,
                alignment: agent.alignment,
                modelProvider: rc.providerOverride === 'default' ? agent.modelProvider : rc.providerOverride,
                personality: agent.personality,
                model: agent.model,
                ownerUserId: agent.ownerUserId,
              },
              contextMessage,
              'bill_voting',
            ).then((decision) => ({ agent, decision, whipSignal }));
          }),
        );

        /* Process whip-forced votes (no LLM call, immediate insert) */
        for (const [agentId, choice] of whipChoices) {
          const agent = activeAgents.find((a) => a.id === agentId)!;
          const whipSignal = choice;

          await db.insert(billVotes).values({ billId: bill.id, voterId: agent.id, choice });
          await db.insert(activityEvents).values({
            type: 'vote',
            agentId: agent.id,
            title: 'Vote cast',
            description: `${agent.displayName} voted ${choice.toUpperCase()} on "${bill.title}"`,
            metadata: JSON.stringify({ billId: bill.id, choice, followedWhip: true, provider: agent.modelProvider }),
          });
          broadcast('agent:vote', { agentId: agent.id, agentName: agent.displayName, billId: bill.id, billTitle: bill.title, choice });
          console.warn(`[SIMULATION] ${agent.displayName} voted ${choice.toUpperCase()} on "${bill.title}" (whip)`);
          agentVoteCounts.set(agent.id, (agentVoteCounts.get(agent.id) ?? 0) + 1);
        }

        /* Process LLM decision results */
        for (const result of results) {
          if (result.status === 'rejected') {
            console.warn('[SIMULATION] Phase 2: Agent LLM call rejected:', result.reason);
            continue;
          }
          const { agent, decision, whipSignal } = result.value;

          if (decision.action === 'idle') continue; // API error fallback

          const isVote = decision.action === 'vote' || decision.action === 'yea' || decision.action === 'nay';
          if (!isVote) continue;

          const rawChoice = decision.action === 'yea' || decision.action === 'nay'
            ? decision.action
            : String(decision.data?.['choice'] ?? 'nay');
          const cn = rawChoice.toLowerCase();
          const choice = (cn === 'yea' || cn === 'aye' || cn === 'yes' || cn === 'y' || cn.includes('yea')) ? 'yea' : 'nay';

          await db.insert(billVotes).values({ billId: bill.id, voterId: agent.id, choice });
          await db.insert(activityEvents).values({
            type: 'vote',
            agentId: agent.id,
            title: 'Vote cast',
            description: `${agent.displayName} voted ${choice.toUpperCase()} on "${bill.title}"`,
            metadata: JSON.stringify({
              billId: bill.id,
              choice,
              followedWhip: !!(whipSignal && choice === whipSignal),
              provider: agent.modelProvider,
            }),
          });
          broadcast('agent:vote', { agentId: agent.id, agentName: agent.displayName, billId: bill.id, billTitle: bill.title, choice });
          console.warn(`[SIMULATION] ${agent.displayName} voted ${choice.toUpperCase()} on "${bill.title}"`);
          agentVoteCounts.set(agent.id, (agentVoteCounts.get(agent.id) ?? 0) + 1);

          /* Approval: whip signal defection */
          if (whipSignal && choice !== 'abstain') {
            const followedWhip = choice === whipSignal;
            if (!followedWhip) {
              await updateApproval(
                agent.id,
                -5,
                'whip_defected',
                `Voted against party whip signal on "${bill.title}" (whip said ${whipSignal.toUpperCase()}, voted ${choice.toUpperCase()})`,
              );
            }
          }
        }
      }

      /* Approval: absenteeism */
      for (const agent of activeAgents) {
        if (floorBills.length > 0 && (agentVoteCounts.get(agent.id) ?? 0) === 0) {
          await updateApproval(
            agent.id,
            -3,
            'absenteeism',
            `Missed floor vote${floorBills.length > 1 ? 's' : ''} on ${floorBills.length} bill${floorBills.length > 1 ? 's' : ''}`,
          );
        }
      }
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/core/server/jobs/agentTick.ts
git commit -m "feat: parallelize Phase 2 bill voting — Promise.allSettled for all agents per bill"
```

---

## Task 6: Parallelize Phase 3 — Committee Review

**Files:**
- Modify: `src/core/server/jobs/agentTick.ts:304-476`

- [ ] **Step 1: Replace sequential loop with Promise.allSettled**

Replace lines 330-472 (the `for (const bill of committeeBillsForReview)` loop) with:

```typescript
      const reviewResults = await Promise.allSettled(
        committeeBillsForReview.map((bill) => {
          const committeeChairPos = chairPositions.find((p) =>
            p.title.toLowerCase().includes(bill.committee.toLowerCase()),
          );
          if (!committeeChairPos) {
            console.warn(`[SIMULATION] Phase 3: No chair for committee "${bill.committee}" — auto-advancing.`);
            return Promise.resolve(null);
          }
          const chair = activeAgents.find((a) => a.id === committeeChairPos.agentId);
          if (!chair) return Promise.resolve(null);

          const sponsor = activeAgents.find((a) => a.id === bill.sponsorId);
          const sponsorName = sponsor?.displayName ?? 'Unknown';
          const sponsorAlignment = sponsor?.alignment ?? 'unknown';

          const contextMessage =
            `You chair the ${bill.committee} Committee. Review this bill: "${bill.title}". ` +
            `Summary: ${bill.summary}. Full text excerpt: ${bill.fullText.slice(0, 600)}. ` +
            `Sponsored by ${sponsorName} (${sponsorAlignment}). ` +
            `Options: approve as-is, amend the text, or table (kill) it. ` +
            `Respond with exactly this JSON: {"action":"committee_review","reasoning":"one sentence","data":{"decision":"approved","amendedText":""}} ` +
            `Use "approved", "amended", or "tabled" for decision. If amending, provide full revised text in amendedText. If not amending, leave amendedText empty.`;

          return generateAgentDecision(
            {
              id: chair.id,
              displayName: chair.displayName,
              alignment: chair.alignment,
              modelProvider: rc.providerOverride === 'default' ? chair.modelProvider : rc.providerOverride,
              personality: chair.personality,
              model: chair.model,
              ownerUserId: chair.ownerUserId,
            },
            contextMessage,
            'committee_review',
          ).then((decision) => ({ bill, chair, decision }));
        }),
      );

      /* Process results sequentially (DB writes are fast) */
      for (const result of reviewResults) {
        if (result.status === 'rejected') {
          console.warn('[SIMULATION] Phase 3: Committee review rejected:', result.reason);
          continue;
        }
        const entry = result.value;
        if (!entry) continue;
        const { bill, chair, decision } = entry;

        if (decision.action !== 'committee_review' || !decision.data) continue;

        const reviewDecision = String(decision.data['decision'] ?? 'approved').toLowerCase();
        const amendedText = String(decision.data['amendedText'] ?? '').trim();

        if (reviewDecision === 'tabled') {
          await db.update(bills).set({ status: 'tabled', committeeDecision: 'tabled', committeeChairId: chair.id, lastActionAt: new Date() }).where(eq(bills.id, bill.id));
          await db.insert(activityEvents).values({
            type: 'committee_review', agentId: chair.id, title: 'Bill tabled in committee',
            description: `${chair.displayName} tabled "${bill.title}" in the ${bill.committee} Committee`,
            metadata: JSON.stringify({ billId: bill.id, decision: 'tabled', reasoning: decision.reasoning }),
          });
          broadcast('bill:tabled', { billId: bill.id, title: bill.title, chairId: chair.id, chairName: chair.displayName, committee: bill.committee });
          console.warn(`[SIMULATION] ${chair.displayName} tabled "${bill.title}" in committee`);
          await updateApproval(bill.sponsorId, -8, 'bill_failed_committee', `Sponsored "${bill.title}" which was tabled in committee`);
        } else if (reviewDecision === 'amended' && amendedText.length > 50) {
          await db.update(bills).set({ fullText: amendedText, committeeDecision: 'amended', committeeChairId: chair.id, lastActionAt: new Date() }).where(eq(bills.id, bill.id));
          await db.insert(activityEvents).values({
            type: 'committee_review', agentId: chair.id, title: 'Bill amended in committee',
            description: `${chair.displayName} amended "${bill.title}" in the ${bill.committee} Committee`,
            metadata: JSON.stringify({ billId: bill.id, decision: 'amended', reasoning: decision.reasoning }),
          });
          broadcast('bill:committee_amended', { billId: bill.id, title: bill.title, chairId: chair.id, chairName: chair.displayName, committee: bill.committee });
          console.warn(`[SIMULATION] ${chair.displayName} amended "${bill.title}" in committee`);
        } else {
          await db.update(bills).set({ committeeDecision: 'approved', committeeChairId: chair.id }).where(eq(bills.id, bill.id));
          await db.insert(activityEvents).values({
            type: 'committee_review', agentId: chair.id, title: 'Bill approved by committee',
            description: `${chair.displayName} approved "${bill.title}" out of the ${bill.committee} Committee`,
            metadata: JSON.stringify({ billId: bill.id, decision: 'approved', reasoning: decision.reasoning }),
          });
          console.warn(`[SIMULATION] ${chair.displayName} approved "${bill.title}" from committee`);
        }
      }
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/core/server/jobs/agentTick.ts
git commit -m "feat: parallelize Phase 3 committee review — all bills reviewed concurrently"
```

---

## Task 7: Parallelize Phase 7 — Veto Override Voting

**Files:**
- Modify: `src/core/server/jobs/agentTick.ts:803-881`

- [ ] **Step 1: Replace nested sequential loops with per-bill parallel voting**

Replace lines 811-877 (the nested `for (const bill of vetoBills)` block) with:

```typescript
      for (const bill of vetoBills) {
        /* Pre-fetch existing override votes for this bill */
        const existingOverrides = await db
          .select({ voterId: billVotes.voterId })
          .from(billVotes)
          .where(
            and(
              eq(billVotes.billId, bill.id),
              inArray(billVotes.choice, ['override_yea', 'override_nay']),
            ),
          );
        const alreadyVoted = new Set(existingOverrides.map((v) => v.voterId));

        const agentsToVote = activeAgents.filter((a) => !alreadyVoted.has(a.id));
        if (agentsToVote.length === 0) continue;

        const contextMessage =
          `The President has vetoed "${bill.title}". ` +
          `Summary: ${bill.summary}. ` +
          `The Legislature can override the veto with a 2/3 supermajority. ` +
          `Vote to override the veto or sustain it. ` +
          `Respond with exactly this JSON: {"action":"override_vote","reasoning":"one sentence","data":{"choice":"override_yea"}} ` +
          `Use "override_yea" to override the veto or "override_nay" to sustain it.`;

        const results = await Promise.allSettled(
          agentsToVote.map((agent) =>
            generateAgentDecision(
              {
                id: agent.id,
                displayName: agent.displayName,
                alignment: agent.alignment,
                modelProvider: rc.providerOverride === 'default' ? agent.modelProvider : rc.providerOverride,
                personality: agent.personality,
                model: agent.model,
                ownerUserId: agent.ownerUserId,
              },
              contextMessage,
              'veto_override',
            ).then((decision) => ({ agent, decision })),
          ),
        );

        for (const result of results) {
          if (result.status === 'rejected') {
            console.warn('[SIMULATION] Phase 7: Agent override vote rejected:', result.reason);
            continue;
          }
          const { agent, decision } = result.value;

          if (decision.action === 'idle') continue;
          if (decision.action !== 'override_vote' || !decision.data) continue;

          const rawChoice = String(decision.data['choice'] ?? 'override_nay');
          const overrideChoice = rawChoice.includes('override_yea') ? 'override_yea' : 'override_nay';

          await db.insert(billVotes).values({ billId: bill.id, voterId: agent.id, choice: overrideChoice });
          await db.insert(activityEvents).values({
            type: 'veto_override_attempt', agentId: agent.id, title: 'Veto override vote',
            description: `${agent.displayName} voted ${overrideChoice === 'override_yea' ? 'OVERRIDE' : 'SUSTAIN'} on "${bill.title}"`,
            metadata: JSON.stringify({ billId: bill.id, choice: overrideChoice, reasoning: decision.reasoning }),
          });
          console.warn(`[SIMULATION] ${agent.displayName} voted ${overrideChoice} on veto of "${bill.title}"`);
        }
      }
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/core/server/jobs/agentTick.ts
git commit -m "feat: parallelize Phase 7 veto override voting — all agents vote concurrently per bill"
```

---

## Task 8: Parallelize Phase 15 — Campaigning

**Files:**
- Modify: `src/core/server/jobs/agentTick.ts:1751-1844`

- [ ] **Step 1: Replace sequential campaign loop with Promise.allSettled**

Replace lines 1769-1840 (from `const speechCountThisTick` through the end of the for loop) with:

```typescript
      /* Filter eligible campaigns upfront */
      const eligibleCampaigns = activeCampaigns.filter((campaign) => {
        if (Math.random() >= rc.campaignSpeechChance) return false;
        const election = activeCampaigningElections.find((e) => e.id === campaign.electionId);
        if (!election) return false;
        const campaignAgent = activeAgents.find((a) => a.id === campaign.agentId);
        if (!campaignAgent) return false;
        return true;
      });

      const results = await Promise.allSettled(
        eligibleCampaigns.map((campaign) => {
          const election = activeCampaigningElections.find((e) => e.id === campaign.electionId)!;
          const campaignAgent = activeAgents.find((a) => a.id === campaign.agentId)!;

          const contextMessage =
            `You are campaigning for ${election.positionType}. Make a brief campaign statement that reflects your values and platform. ` +
            `Respond with: {"action":"campaign_speech","reasoning":"your one-line speech","data":{"boost":50}}`;

          return generateAgentDecision(
            {
              id: campaignAgent.id,
              displayName: campaignAgent.displayName,
              alignment: campaignAgent.alignment,
              modelProvider: rc.providerOverride === 'default' ? campaignAgent.modelProvider : rc.providerOverride,
              personality: campaignAgent.personality,
              model: campaignAgent.model,
              ownerUserId: campaignAgent.ownerUserId,
            },
            contextMessage,
            'campaigning',
          ).then((decision) => ({ campaign, election, campaignAgent, decision }));
        }),
      );

      const speechCountThisTick = new Map<string, number>();

      for (const result of results) {
        if (result.status === 'rejected') {
          console.warn('[SIMULATION] Phase 15: Campaign speech rejected:', result.reason);
          continue;
        }
        const { campaign, election, campaignAgent, decision } = result.value;

        if (decision.action === 'idle') continue;
        if (decision.action !== 'campaign_speech') continue;

        /* Enforce max speeches per tick */
        if ((speechCountThisTick.get(campaign.agentId) ?? 0) >= rc.maxCampaignSpeechesPerTick) continue;

        const rawBoost = Number(decision.data?.['boost'] ?? 50);
        const boost = Math.max(10, Math.min(100, rawBoost));

        await db.update(campaigns).set({ contributions: sql`${campaigns.contributions} + ${boost}` }).where(eq(campaigns.id, campaign.id));
        await db.insert(activityEvents).values({
          type: 'campaign_speech', agentId: campaignAgent.id, title: 'Campaign speech',
          description: decision.reasoning,
          metadata: JSON.stringify({ campaignId: campaign.id, electionId: election.id, positionType: election.positionType, boost }),
        });
        broadcast('campaign:speech', {
          campaignId: campaign.id, electionId: election.id, agentId: campaignAgent.id,
          agentName: campaignAgent.displayName, positionType: election.positionType, speech: decision.reasoning, boost,
        });
        speechCountThisTick.set(campaign.agentId, (speechCountThisTick.get(campaign.agentId) ?? 0) + 1);
        await updateApproval(campaignAgent.id, 1, 'campaign_speech', `${campaignAgent.displayName} gave a campaign speech`);
        console.warn(`[SIMULATION] ${campaignAgent.displayName} made campaign speech for ${election.positionType} (+${boost} contributions)`);
      }
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/core/server/jobs/agentTick.ts
git commit -m "feat: parallelize Phase 15 campaigning — all speeches generated concurrently"
```

---

## Task 9: Parallelize Phase 16 — Forum Posts

**Files:**
- Modify: `src/core/server/jobs/agentTick.ts:1850-1965`

- [ ] **Step 1: Replace sequential forum post loop with Promise.allSettled**

Replace lines 1872-1962 (the `for (const agent of forumCandidates)` loop) with:

```typescript
    const results = await Promise.allSettled(
      forumCandidates.map((agent) => {
        const alignment = agent.alignment?.toLowerCase() ?? '';
        const weightedCategories: typeof FORUM_CATEGORIES[number][] =
          alignment === 'progressive'   ? ['policy', 'elections', 'economy', 'legislation', 'party'] :
          alignment === 'conservative'  ? ['economy', 'policy', 'legislation', 'party', 'elections'] :
          alignment === 'technocrat'    ? ['legislation', 'policy', 'economy', 'elections', 'party'] :
          alignment === 'libertarian'   ? ['economy', 'policy', 'party', 'legislation', 'elections'] :
          ['legislation', 'elections', 'policy', 'party', 'economy'];
        const category = Math.random() < 0.67
          ? weightedCategories[Math.floor(Math.random() * 2)]
          : weightedCategories[Math.floor(Math.random() * weightedCategories.length)];

        return generateAgentDecision(
          agent,
          `You are posting to the Agora Bench public forum. Write a short opening post (2-4 sentences) about a specific ${category} issue that your constituents care about.` +
          `${simStateNote}` +
          `${recentTopicsNote}\n\n` +
          `Pick a concrete, specific topic — reference actual legislation, a real policy problem, or a recent event from the simulation above if relevant. ` +
          `Do not write abstractly about governance theory or AI philosophy. Write about what needs to get done and why. ` +
          `JSON: { "action": "forum_post", "reasoning": "<your post body here>", "data": { "title": "<thread title>" } }`,
          'forum_post',
        ).then((decision) => ({ agent, decision, category }));
      }),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('[SIMULATION] Phase 16: Forum post rejected:', result.reason);
        continue;
      }
      const { agent, decision, category } = result.value;

      try {
        if (decision.action === 'idle') continue;
        if (decision.action !== 'forum_post') continue;

        const title = (decision.data?.['title'] as string | undefined) ?? `${agent.displayName}'s thoughts on ${category}`;
        const body = decision.reasoning;
        if (!body || body.length < 10) continue;

        /* Deduplication */
        const sevenDaysAgo16 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const existingTitles = await db.select({ title: forumThreads.title }).from(forumThreads).where(gt(forumThreads.createdAt, sevenDaysAgo16));
        const sigWords = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 4));
        const newWords = sigWords(title);
        const isDupe = existingTitles.some(({ title: t }) => {
          const overlap = [...sigWords(t)].filter((w) => newWords.has(w)).length;
          return overlap >= 3;
        });
        if (isDupe) {
          console.warn(`[SIMULATION] ${agent.displayName} skipped duplicate forum topic: "${title.slice(0, 60)}"`);
          continue;
        }

        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const [thread] = await db.insert(forumThreads).values({
          title: title.slice(0, 299), category, authorId: agent.id, replyCount: 0, lastActivityAt: new Date(), expiresAt,
        }).returning();

        await db.insert(agentMessages).values({ type: 'forum_post', fromAgentId: agent.id, body, threadId: thread.id, isPublic: true });
        broadcast('forum:post', { threadId: thread.id, agentId: agent.id, agentName: agent.displayName, category, title: thread.title });
        console.warn(`[SIMULATION] ${agent.displayName} posted to ${category} forum: "${title.slice(0, 60)}"`);
      } catch (agentErr) {
        console.warn(`[SIMULATION] Phase 16: Error for agent ${agent.displayName}:`, agentErr);
      }
    }
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/core/server/jobs/agentTick.ts
git commit -m "feat: parallelize Phase 16 forum posts — all candidates generate concurrently"
```

---

## Task 10: Parallelize Phase 17 — Forum Replies

**Files:**
- Modify: `src/core/server/jobs/agentTick.ts:1970-2169`

- [ ] **Step 1: Replace sequential reply loop with Promise.allSettled**

Replace lines 2047-2165 (the `for (const { agent, thread, isMentioned } of replyCandidates)` loop) with:

```typescript
      /* Pre-fetch thread context for all candidates in parallel */
      const candidateContexts = await Promise.all(
        replyCandidates.map(async ({ agent, thread, isMentioned }) => {
          const recentPosts = await db.select({ body: agentMessages.body, authorName: agents.displayName })
            .from(agentMessages)
            .innerJoin(agents, eq(agentMessages.fromAgentId, agents.id))
            .where(eq(agentMessages.threadId, thread.id))
            .orderBy(desc(agentMessages.createdAt))
            .limit(3);

          const threadContext = recentPosts.reverse().map((p) => `${p.authorName}: ${p.body}`).join('\n');
          const mentionContext = isMentioned ? 'You were mentioned in this thread. ' : '';

          const [countRow] = await db.select({ n: sql<number>`COUNT(*)` }).from(agentMessages).where(eq(agentMessages.threadId, thread.id));
          const postCount = Number(countRow?.n ?? 0);

          const resolutionInstruction = postCount >= 3
            ? `This thread has had ${postCount} posts already. Rather than restating positions, try to reach a conclusion: ` +
              `propose a specific policy action, identify what the group agrees on, or call for a concrete next step. `
            : `Add your perspective — agree, disagree, or build on what's been said, but be specific and reference actual policy details. `;

          return { agent, thread, isMentioned, threadContext, mentionContext, resolutionInstruction };
        }),
      );

      /* Fire all LLM calls in parallel */
      const replyResults = await Promise.allSettled(
        candidateContexts.map(({ agent, thread, mentionContext, threadContext, resolutionInstruction }) =>
          generateAgentDecision(
            agent,
            `${mentionContext}Reply to this forum thread in the Agora Bench public forum.\n\n` +
            `Thread: "${thread.title}" [${thread.category}]\n\n` +
            `Recent posts:\n${threadContext}\n\n` +
            `Agents you can @mention by name: ${allAgentNames}\n\n` +
            `${resolutionInstruction}` +
            `Do not repeat what was already said. Do not write in generalities about AI governance or political philosophy. ` +
            `Use @DisplayName to mention agents if relevant. ` +
            `JSON: { "action": "forum_reply", "reasoning": "<your reply body, may contain @Name>", "data": { "threadId": "${thread.id}", "mentions": ["Name1"] } }`,
            'forum_reply',
          ).then((decision) => ({ agent, thread, decision })),
        ),
      );

      /* Process results */
      for (const result of replyResults) {
        if (result.status === 'rejected') {
          console.warn('[SIMULATION] Phase 17: Forum reply rejected:', result.reason);
          continue;
        }
        const { agent, thread, decision } = result.value;

        try {
          if (decision.action === 'idle') continue;
          if (decision.action !== 'forum_reply') continue;

          const body = decision.reasoning;
          if (!body || body.length < 10) continue;

          const mentionedNames = (decision.data?.['mentions'] as string[] | undefined) ?? [];

          const [openingPost] = await db.select({ id: agentMessages.id }).from(agentMessages)
            .where(eq(agentMessages.threadId, thread.id)).orderBy(agentMessages.createdAt).limit(1);

          await db.insert(agentMessages).values({ type: 'forum_reply', fromAgentId: agent.id, body, threadId: thread.id, parentId: openingPost?.id ?? null, isPublic: true });
          await db.update(forumThreads).set({ replyCount: sql`${forumThreads.replyCount} + 1`, lastActivityAt: new Date() }).where(eq(forumThreads.id, thread.id));

          for (const name of mentionedNames) {
            const mentioned = activeAgents.find((a) => a.displayName.toLowerCase() === name.toLowerCase());
            if (!mentioned || mentioned.id === agent.id) continue;
            await db.insert(pendingMentions).values({ mentionedAgentId: mentioned.id, threadId: thread.id, mentionerName: agent.displayName });
          }

          await db.delete(pendingMentions).where(and(eq(pendingMentions.mentionedAgentId, agent.id), eq(pendingMentions.threadId, thread.id)));
          broadcast('forum:reply', { threadId: thread.id, agentId: agent.id, agentName: agent.displayName, mentionedNames });
          console.warn(
            `[SIMULATION] ${agent.displayName} replied in "${thread.title.slice(0, 60)}"` +
            (mentionedNames.length ? ` mentioning ${mentionedNames.join(', ')}` : ''),
          );
        } catch (agentErr) {
          console.warn(`[SIMULATION] Phase 17: Error for agent ${agent.displayName}:`, agentErr);
        }
      }
```

- [ ] **Step 2: Verify typecheck**

Run: `cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/core/server/jobs/agentTick.ts
git commit -m "feat: parallelize Phase 17 forum replies — LLM calls and context fetches run concurrently"
```

---

## Task 11: Deploy to Linux — Git clone from Gitea

**Files:**
- Remote operations on 10.0.0.10 via ubuntu-desktop-ssh MCP

- [ ] **Step 1: Push all changes to Gitea**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && git push origin main
```

- [ ] **Step 2: Back up .env from Linux copy**

Via ubuntu-desktop-ssh:
```bash
cp /home/myroproductions/Projects/Molt-Government/.env /home/myroproductions/.env.molt-backup
```

- [ ] **Step 3: Remove old rsync copy and clone from Gitea**

Via ubuntu-desktop-ssh:
```bash
mv /home/myroproductions/Projects/Molt-Government /home/myroproductions/Projects/Molt-Government-old
git clone http://10.0.0.223:3000/MyroProductions/Molt-Goverment.git /home/myroproductions/Projects/Molt-Government
```

- [ ] **Step 4: Restore .env and install deps**

Via ubuntu-desktop-ssh:
```bash
cp /home/myroproductions/.env.molt-backup /home/myroproductions/Projects/Molt-Government/.env
cd /home/myroproductions/Projects/Molt-Government && pnpm install
```

- [ ] **Step 5: Verify server starts**

Via ubuntu-desktop-ssh:
```bash
cd /home/myroproductions/Projects/Molt-Government && pnpm run dev &
sleep 5 && curl -s http://localhost:3001/api/health | head -1
kill %1
```
Expected: Health check returns 200

- [ ] **Step 6: Clean up old copy**

Via ubuntu-desktop-ssh:
```bash
rm -rf /home/myroproductions/Projects/Molt-Government-old
```

---

## Task 12: Agent Memory — Create schema tables

**Files:**
- Create: `src/modules/agents/db/schema/agentMemorySummaries.ts`
- Create: `src/modules/agents/db/schema/agentRelationships.ts`
- Create: `src/modules/agents/db/schema/agentPolicyPositions.ts`
- Modify: `src/core/db/schema/index.ts`

- [ ] **Step 1: Create agentMemorySummaries table**

Create `src/modules/agents/db/schema/agentMemorySummaries.ts`:

```typescript
import { pgTable, uuid, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const agentMemorySummaries = pgTable('agent_memory_summaries', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  summary: text('summary').notNull(),
  decisionsFrom: timestamp('decisions_from').notNull(),
  decisionsTo: timestamp('decisions_to').notNull(),
  decisionCount: integer('decision_count').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

- [ ] **Step 2: Create agentRelationships table**

Create `src/modules/agents/db/schema/agentRelationships.ts`:

```typescript
import { pgTable, uuid, real, integer, timestamp, unique } from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const agentRelationships = pgTable('agent_relationships', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  targetAgentId: uuid('target_agent_id').notNull().references(() => agents.id),
  voteAlignment: real('vote_alignment').notNull().default(0.5),
  forumInteractions: integer('forum_interactions').notNull().default(0),
  sentiment: real('sentiment').notNull().default(0.5),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  unique('uniq_agent_relationship').on(table.agentId, table.targetAgentId),
]);
```

- [ ] **Step 3: Create agentPolicyPositions table**

Create `src/modules/agents/db/schema/agentPolicyPositions.ts`:

```typescript
import { pgTable, uuid, text, integer, timestamp, unique } from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const agentPolicyPositions = pgTable('agent_policy_positions', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  category: text('category').notNull(),
  supportCount: integer('support_count').notNull().default(0),
  opposeCount: integer('oppose_count').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  unique('uniq_agent_policy_position').on(table.agentId, table.category),
]);
```

- [ ] **Step 4: Export new tables from schema index**

In `src/core/db/schema/index.ts`, add after line 1:

```typescript
export { agentMemorySummaries } from '@modules/agents/db/schema/agentMemorySummaries';
export { agentRelationships } from '@modules/agents/db/schema/agentRelationships';
export { agentPolicyPositions } from '@modules/agents/db/schema/agentPolicyPositions';
```

- [ ] **Step 5: Push schema to database**

Run: `cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && pnpm db:push`
Expected: Three new tables created

- [ ] **Step 6: Verify typecheck**

Run: `cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && pnpm typecheck`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/modules/agents/db/schema/agentMemorySummaries.ts src/modules/agents/db/schema/agentRelationships.ts src/modules/agents/db/schema/agentPolicyPositions.ts src/core/db/schema/index.ts
git commit -m "feat: add agent memory schema — summaries, relationships, policy positions"
```

---

## Task 13: Agent Memory — Expand memory block + relationship context

**Files:**
- Modify: `src/core/server/services/ai.ts:33,125-159,356-381`

- [ ] **Step 1: Update MEMORY_DEPTH and add new imports**

In `src/core/server/services/ai.ts`, change line 33:

```typescript
// Before:
const MEMORY_DEPTH = 5; // last N successful decisions

// After:
const MEMORY_DEPTH = 25; // last N successful decisions
```

Add to the imports at line 3 (inside the import from `@db/schema/index`):

```typescript
agentMemorySummaries, agentRelationships, agentPolicyPositions,
```

Also add `billVotes` and `bills` to the existing import if not already present.

- [ ] **Step 2: Add buildRelationshipBlock function**

After the `buildForumContextBlock` function (after line 222), add:

```typescript
async function buildRelationshipBlock(agentId: string): Promise<string> {
  const relationships = await db
    .select({
      targetAgentId: agentRelationships.targetAgentId,
      voteAlignment: agentRelationships.voteAlignment,
      targetName: agents.displayName,
    })
    .from(agentRelationships)
    .innerJoin(agents, eq(agentRelationships.targetAgentId, agents.id))
    .where(eq(agentRelationships.agentId, agentId))
    .orderBy(desc(agentRelationships.voteAlignment));

  if (relationships.length === 0) return '';

  const allies = relationships.slice(0, 3);
  const opponents = relationships.slice(-3).reverse();

  const allyLines = allies
    .filter((r) => r.voteAlignment > 0.5)
    .map((r) => `  ${r.targetName}: ${Math.round(r.voteAlignment * 100)}% vote alignment`);

  const opponentLines = opponents
    .filter((r) => r.voteAlignment < 0.5)
    .map((r) => `  ${r.targetName}: ${Math.round(r.voteAlignment * 100)}% vote alignment`);

  const parts: string[] = [];
  if (allyLines.length > 0) parts.push(`Allies:\n${allyLines.join('\n')}`);
  if (opponentLines.length > 0) parts.push(`Opponents:\n${opponentLines.join('\n')}`);
  return parts.join('\n');
}
```

- [ ] **Step 3: Add buildPolicyPositionBlock function**

After `buildRelationshipBlock`, add:

```typescript
async function buildPolicyPositionBlock(agentId: string): Promise<string> {
  const positions = await db
    .select()
    .from(agentPolicyPositions)
    .where(eq(agentPolicyPositions.agentId, agentId))
    .orderBy(desc(sql`${agentPolicyPositions.supportCount} + ${agentPolicyPositions.opposeCount}`))
    .limit(5);

  if (positions.length === 0) return '';

  const lines = positions.map((p) => {
    const total = p.supportCount + p.opposeCount;
    if (total === 0) return null;
    const stance = p.supportCount > p.opposeCount ? 'supported' : 'opposed';
    const majority = Math.max(p.supportCount, p.opposeCount);
    return `  ${p.category}: ${stance} ${majority}/${total} bills`;
  }).filter(Boolean);

  return lines.length > 0 ? `Your voting record by policy area:\n${lines.join('\n')}` : '';
}
```

- [ ] **Step 4: Add buildElectionMemoryBlock function**

After `buildPolicyPositionBlock`, add:

```typescript
async function buildElectionMemoryBlock(agentId: string): Promise<string> {
  const pastElections = await db
    .select({
      positionType: elections.positionType,
      winnerId: elections.winnerId,
      winnerName: agents.displayName,
      certifiedDate: elections.certifiedDate,
    })
    .from(elections)
    .leftJoin(agents, eq(elections.winnerId, agents.id))
    .innerJoin(campaigns, and(eq(campaigns.electionId, elections.id), eq(campaigns.agentId, agentId)))
    .where(eq(elections.status, 'certified'))
    .orderBy(desc(elections.certifiedDate))
    .limit(3);

  if (pastElections.length === 0) return '';

  const lines = pastElections.map((e) => {
    const won = e.winnerId === agentId;
    return won
      ? `  Won ${e.positionType} election`
      : `  Lost ${e.positionType} election to ${e.winnerName ?? 'unknown'}`;
  });

  return `Election history:\n${lines.join('\n')}`;
}
```

- [ ] **Step 5: Update buildMemoryBlock to include summaries**

Replace the `buildMemoryBlock` function (lines 125-159) with:

```typescript
async function buildMemoryBlock(agentId: string): Promise<string> {
  const cached = memoryCache.get(agentId);
  if (cached && Date.now() - cached.ts < MEMORY_TTL_MS) return cached.block;

  /* Fetch latest summary */
  const [latestSummary] = await db
    .select({ summary: agentMemorySummaries.summary })
    .from(agentMemorySummaries)
    .where(eq(agentMemorySummaries.agentId, agentId))
    .orderBy(desc(agentMemorySummaries.createdAt))
    .limit(1);

  /* Fetch last 5 raw decisions (most recent, for detail) */
  const rows = await db
    .select({
      phase: agentDecisions.phase,
      parsedAction: agentDecisions.parsedAction,
      parsedReasoning: agentDecisions.parsedReasoning,
      createdAt: agentDecisions.createdAt,
    })
    .from(agentDecisions)
    .where(and(eq(agentDecisions.agentId, agentId), eq(agentDecisions.success, true)))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(5);

  const parts: string[] = [];

  if (latestSummary?.summary) {
    parts.push(`Summary of earlier decisions: ${latestSummary.summary}`);
  }

  if (rows.length > 0) {
    const lines = rows.reverse().map((r) => {
      const when = r.createdAt
        ? new Date(r.createdAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
        : 'unknown time';
      const phase = r.phase ?? 'general';
      const action = r.parsedAction ?? 'idle';
      const reasoning = (r.parsedReasoning ?? '').slice(0, 120);
      return `- [${when}] phase=${phase} action=${action}: "${reasoning}"`;
    });
    parts.push(lines.join('\n'));
  }

  const block = parts.join('\n\n');
  memoryCache.set(agentId, { block, ts: Date.now() });
  return block;
}
```

- [ ] **Step 6: Update generateAgentDecision to include new context**

In `generateAgentDecision` (line 520-524), expand the Promise.all:

```typescript
// Before:
  const [memory, forumContext, congressContext] = await Promise.all([
    buildMemoryBlock(agent.id).catch((err) => { console.warn('[AI] Memory block failed:', err instanceof Error ? err.message : err); return ''; }),
    buildForumContextBlock().catch((err) => { console.warn('[AI] Forum context failed:', err instanceof Error ? err.message : err); return ''; }),
    buildCongressContextBlock().catch((err) => { console.warn('[AI] Congress context failed:', err instanceof Error ? err.message : err); return ''; }),
  ]);

// After:
  const [memory, forumContext, congressContext, relationshipContext, policyContext, electionContext] = await Promise.all([
    buildMemoryBlock(agent.id).catch((err) => { console.warn('[AI] Memory block failed:', err instanceof Error ? err.message : err); return ''; }),
    buildForumContextBlock().catch((err) => { console.warn('[AI] Forum context failed:', err instanceof Error ? err.message : err); return ''; }),
    buildCongressContextBlock().catch((err) => { console.warn('[AI] Congress context failed:', err instanceof Error ? err.message : err); return ''; }),
    buildRelationshipBlock(agent.id).catch((err) => { console.warn('[AI] Relationship block failed:', err instanceof Error ? err.message : err); return ''; }),
    buildPolicyPositionBlock(agent.id).catch((err) => { console.warn('[AI] Policy position block failed:', err instanceof Error ? err.message : err); return ''; }),
    buildElectionMemoryBlock(agent.id).catch((err) => { console.warn('[AI] Election memory block failed:', err instanceof Error ? err.message : err); return ''; }),
  ]);
```

- [ ] **Step 7: Update buildSystemPrompt signature and body**

Change the `buildSystemPrompt` function (line 356) to accept and inject new context:

```typescript
// Before:
function buildSystemPrompt(agent: AgentRecord, memory?: string, forumContext?: string, congressContext?: string): string {

// After:
function buildSystemPrompt(
  agent: AgentRecord,
  memory?: string,
  forumContext?: string,
  congressContext?: string,
  relationshipContext?: string,
  policyContext?: string,
  electionContext?: string,
): string {
```

And at the end of the return string (before the closing parenthesis, after the congressContext block at line 380), add:

```typescript
    (relationshipContext
      ? `\n\n## Your Relationships\nBased on your voting record and interactions with other officials:\n${relationshipContext}`
      : '') +
    (policyContext
      ? `\n\n## Your Policy Record\n${policyContext}`
      : '') +
    (electionContext
      ? `\n\n## ${electionContext}`
      : '')
```

- [ ] **Step 8: Update the buildSystemPrompt call in generateAgentDecision**

```typescript
// Before:
  const systemPrompt = buildSystemPrompt(
    agent,
    memory || undefined,
    forumContext || undefined,
    congressContext || undefined,
  );

// After:
  const systemPrompt = buildSystemPrompt(
    agent,
    memory || undefined,
    forumContext || undefined,
    congressContext || undefined,
    relationshipContext || undefined,
    policyContext || undefined,
    electionContext || undefined,
  );
```

- [ ] **Step 9: Verify typecheck**

Run: `cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && pnpm typecheck`
Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add src/core/server/services/ai.ts
git commit -m "feat: expand agent memory — summaries, relationships, policy positions, election history in context"
```

---

## Task 14: Agent Memory — Post-voting relationship computation

**Files:**
- Modify: `src/core/server/jobs/agentTick.ts` — add relationship + policy position updates after Phase 2

- [ ] **Step 1: Add imports for new tables**

At the top of `agentTick.ts`, add to the schema imports (line 6-26):

```typescript
import {
  // ... existing imports ...
  agentRelationships,
  agentPolicyPositions,
} from '@db/schema/index';
```

- [ ] **Step 2: Add relationship computation after Phase 2**

After the Phase 2 try-catch block (after line 298), add a new block:

```typescript
  /* ------------------------------------------------------------------ */
  /* PHASE 2b: Update Relationship & Policy Tracking                     */
  /* Compute vote alignment between all agent pairs from recent votes.  */
  /* ------------------------------------------------------------------ */
  try {
    console.warn('[SIMULATION] Phase 2b: Updating relationship and policy tracking');

    /* Fetch all bill votes from the last 50 ticks for alignment calculation */
    const recentVotes = await db
      .select({
        voterId: billVotes.voterId,
        billId: billVotes.billId,
        choice: billVotes.choice,
      })
      .from(billVotes)
      .where(inArray(billVotes.choice, ['yea', 'nay']));

    /* Build agent-bill vote map */
    const voteMap = new Map<string, Map<string, string>>(); // agentId -> (billId -> choice)
    for (const v of recentVotes) {
      if (!voteMap.has(v.voterId)) voteMap.set(v.voterId, new Map());
      voteMap.get(v.voterId)!.set(v.billId, v.choice);
    }

    /* Compute pairwise alignment */
    const agentIds = activeAgents.map((a) => a.id);
    const relationshipUpserts: Array<{ agentId: string; targetAgentId: string; voteAlignment: number }> = [];

    for (let i = 0; i < agentIds.length; i++) {
      const aVotes = voteMap.get(agentIds[i]);
      if (!aVotes) continue;

      for (let j = i + 1; j < agentIds.length; j++) {
        const bVotes = voteMap.get(agentIds[j]);
        if (!bVotes) continue;

        let agree = 0;
        let total = 0;
        for (const [billId, choiceA] of aVotes) {
          const choiceB = bVotes.get(billId);
          if (choiceB) {
            total++;
            if (choiceA === choiceB) agree++;
          }
        }

        if (total >= 2) {
          const alignment = agree / total;
          relationshipUpserts.push({ agentId: agentIds[i], targetAgentId: agentIds[j], voteAlignment: alignment });
          relationshipUpserts.push({ agentId: agentIds[j], targetAgentId: agentIds[i], voteAlignment: alignment });
        }
      }
    }

    /* Batch upsert relationships */
    for (const rel of relationshipUpserts) {
      await db
        .insert(agentRelationships)
        .values({ ...rel, sentiment: rel.voteAlignment, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [agentRelationships.agentId, agentRelationships.targetAgentId],
          set: { voteAlignment: rel.voteAlignment, sentiment: rel.voteAlignment, updatedAt: new Date() },
        });
    }

    /* Update policy positions from votes on floor bills */
    const floorBillsForPolicy = await db.select({ id: bills.id, committee: bills.committee }).from(bills).where(eq(bills.status, 'floor'));
    const billCategoryMap = new Map(floorBillsForPolicy.map((b) => [b.id, b.committee]));

    for (const agent of activeAgents) {
      const agentVotes = voteMap.get(agent.id);
      if (!agentVotes) continue;

      const categoryCounts = new Map<string, { support: number; oppose: number }>();
      for (const [billId, choice] of agentVotes) {
        const category = billCategoryMap.get(billId);
        if (!category) continue;
        if (!categoryCounts.has(category)) categoryCounts.set(category, { support: 0, oppose: 0 });
        const counts = categoryCounts.get(category)!;
        if (choice === 'yea') counts.support++;
        else counts.oppose++;
      }

      for (const [category, counts] of categoryCounts) {
        await db
          .insert(agentPolicyPositions)
          .values({ agentId: agent.id, category, supportCount: counts.support, opposeCount: counts.oppose, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: [agentPolicyPositions.agentId, agentPolicyPositions.category],
            set: { supportCount: counts.support, opposeCount: counts.oppose, updatedAt: new Date() },
          });
      }
    }

    console.warn(`[SIMULATION] Phase 2b: Updated ${relationshipUpserts.length} relationships`);
  } catch (err) {
    console.warn('[SIMULATION] Phase 2b error:', err);
  }
```

- [ ] **Step 3: Verify typecheck**

Run: `cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/core/server/jobs/agentTick.ts
git commit -m "feat: add Phase 2b — post-voting relationship and policy position computation"
```

---

## Task 15: Agent Memory — Decision summarization

**Files:**
- Modify: `src/core/server/services/ai.ts` — add summarization trigger

- [ ] **Step 1: Add summarization function to ai.ts**

After the `buildElectionMemoryBlock` function, add:

```typescript
export async function summarizeAgentDecisions(agentId: string): Promise<void> {
  /* Check if agent has accumulated enough unsummarized decisions */
  const [latestSummary] = await db
    .select({ decisionsTo: agentMemorySummaries.decisionsTo })
    .from(agentMemorySummaries)
    .where(eq(agentMemorySummaries.agentId, agentId))
    .orderBy(desc(agentMemorySummaries.createdAt))
    .limit(1);

  const sinceDate = latestSummary?.decisionsTo ?? new Date(0);

  const unsummarized = await db
    .select({
      phase: agentDecisions.phase,
      parsedAction: agentDecisions.parsedAction,
      parsedReasoning: agentDecisions.parsedReasoning,
      createdAt: agentDecisions.createdAt,
    })
    .from(agentDecisions)
    .where(and(
      eq(agentDecisions.agentId, agentId),
      eq(agentDecisions.success, true),
      gt(agentDecisions.createdAt, sinceDate),
    ))
    .orderBy(agentDecisions.createdAt)
    .limit(MEMORY_DEPTH);

  if (unsummarized.length < MEMORY_DEPTH) return; // not enough to summarize yet

  /* Get the agent record for LLM call */
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return;

  const decisionsText = unsummarized.map((r) => {
    const phase = r.phase ?? 'general';
    const action = r.parsedAction ?? 'idle';
    const reasoning = (r.parsedReasoning ?? '').slice(0, 150);
    return `phase=${phase} action=${action}: "${reasoning}"`;
  }).join('\n');

  const rc = getRuntimeConfig();
  const provider = agent.modelProvider ?? 'ollama';

  try {
    const summaryText = await callProvider(
      provider,
      {
        id: agent.id,
        displayName: agent.displayName,
        alignment: agent.alignment,
        modelProvider: agent.modelProvider,
        personality: agent.personality,
        model: agent.model,
        ownerUserId: agent.ownerUserId,
      },
      rc,
      `You are summarizing your own decision history. Write 2-3 sentences capturing the key themes, positions taken, and any shifts in your voting or behavior. Be specific about bills and policies.`,
      `Summarize these ${unsummarized.length} decisions:\n${decisionsText}\n\nRespond with ONLY the summary text, no JSON.`,
    );

    const cleanSummary = summaryText.replace(/```/g, '').replace(/^["']|["']$/g, '').trim();
    if (cleanSummary.length < 20) return;

    await db.insert(agentMemorySummaries).values({
      agentId,
      summary: cleanSummary.slice(0, 500),
      decisionsFrom: unsummarized[0].createdAt!,
      decisionsTo: unsummarized[unsummarized.length - 1].createdAt!,
      decisionCount: unsummarized.length,
    });

    console.warn(`[AI] Summarized ${unsummarized.length} decisions for ${agent.displayName}`);
  } catch (err) {
    console.warn(`[AI] Decision summarization failed for ${agent.displayName}:`, err);
  }
}
```

Note: `callProvider` is a private function in ai.ts, so this function lives in the same file and has access.

- [ ] **Step 2: Add summarization trigger at end of tick**

In `agentTick.ts`, after the inactivity decay block (after line ~2190, before the tick completion), add:

```typescript
  /* ------------------------------------------------------------------ */
  /* Memory Summarization — compress old decisions periodically          */
  /* ------------------------------------------------------------------ */
  try {
    const { summarizeAgentDecisions } = await import('../services/ai.js');
    await Promise.allSettled(
      activeAgents.map((agent) => summarizeAgentDecisions(agent.id)),
    );
  } catch (err) {
    console.warn('[SIMULATION] Memory summarization error:', err);
  }
```

Also add `summarizeAgentDecisions` to the import at line 27:

```typescript
import { generateAgentDecision, buildSimulationStateBlock, summarizeAgentDecisions } from '../services/ai.js';
```

And remove the dynamic import in favor of the static one.

- [ ] **Step 3: Verify typecheck**

Run: `cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && pnpm typecheck`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/core/server/services/ai.ts src/core/server/jobs/agentTick.ts
git commit -m "feat: add periodic decision summarization — compresses old decisions into summaries"
```

---

## Task 16: Final verification and push

- [ ] **Step 1: Full typecheck**

Run: `cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && pnpm typecheck`
Expected: No errors

- [ ] **Step 2: Run tests**

Run: `cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment && pnpm test`
Expected: All existing tests pass

- [ ] **Step 3: Push to Gitea and GitHub**

```bash
cd /Volumes/DevDrive-M4Pro/Projects/Molt-Goverment
git push origin main
git push github main
```

- [ ] **Step 4: Pull on Linux and restart**

Via ubuntu-desktop-ssh:
```bash
cd /home/myroproductions/Projects/Molt-Government && git pull origin main && pnpm install && pnpm db:push
```

- [ ] **Step 5: Verify deployment**

Via ubuntu-desktop-ssh:
```bash
cd /home/myroproductions/Projects/Molt-Government && pnpm run dev &
sleep 10 && curl -s http://localhost:3001/api/health
```
