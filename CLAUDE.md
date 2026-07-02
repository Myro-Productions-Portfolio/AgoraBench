# AgoraBench — Claude Code Instructions

**Full best practices reference:** `docs/BEST_PRACTICES.md`
**Architecture:** `docs/AGORABENCH.md`
**Dynamic Weight Engines:** `docs/DYNAMIC_WEIGHT_ENGINE.md`
**TODO / current work:** `docs/TODO.md`

---

## Project Overview

AgoraBench is a political governance simulation at agorabench.com. AI agents hold office, vote on legislation, run for election, debate in forums, and respond to economic conditions. The simulation runs on a Node.js/Express/TypeScript backend with a React frontend, PostgreSQL (via Drizzle ORM), Redis (Bull queues), and Clerk auth.

**Live deployment:** Linux desktop at 10.0.0.10, served via Cloudflare tunnel.
**LLM backend (sim inference):** Spark 1 (10.0.0.69:**1234**) running **Gemma-4-31B bf16** (`gemma-4-31b`) via vLLM. Note: docker port-map is `1234:8000`, so the model serves on host port 1234 even though the container exposes 8000 internally. Per-call latency ~12-17s; tick interval bumped to 90 min to accommodate.
**Bob/AGGE orchestrator:** OpenClaw on bspark1 (10.0.0.69) — yes, same host as sim inference — runs Claude via the Claude Agent SDK. Bob calls orchestrator endpoints **two ways**: (1) REST `/api/orchestrator/{observe,intervene,history}`, (2) MCP tools over Streamable HTTP at `https://agorabench.com/mcp`. Both paths gated by the same `BOB_ORCHESTRATOR_KEY` bearer. AGGE auto-tick is disabled whenever that env var is set.

---

## Session Startup

Before doing anything in a new session:
1. Read `docs/TODO.md` — understand current state and what's in progress
2. Run `git log --oneline -5` — know what was just shipped
3. Check `memory/MEMORY.md` — recall project context

---

## MANDATORY: Non-Negotiable Rules

These rules exist because their absence caused real bugs in this project. Do not skip them.

### 1. Every new RuntimeConfig field needs four things — in the same commit

When you add a field to `RuntimeConfig` in `src/core/server/runtimeConfig.ts`:

- [ ] **Server handler branch** — add to `POST /admin/config` in `src/modules/admin/server/routes/admin.ts` with type check and range clamp
- [ ] **UI control** — add to AdminPage.tsx with appropriate input type
- [ ] **Client interface** — add to the `RuntimeConfig` interface in AdminPage.tsx
- [ ] **Verify it persists** — confirm `updateRuntimeConfig()` receives and stores it

**Why this rule exists:** In April 2026, 17 fields were added to RuntimeConfig across multiple sessions. None had server handler branches. All config saves for those fields were silent no-ops. The admin UI showed controls that did nothing.

### 2. Never pass a raw JS array to Postgres ANY() in raw SQL

```typescript
// WRONG — fails at runtime with "op ANY/ALL requires array on right side"
await db.execute(sql`UPDATE t SET x = 1 WHERE id = ANY(${jsArray})`);

// CORRECT — use inArray()
await db.update(t).set({ x: 1 }).where(inArray(t.id, jsArray));
```

**Why this rule exists:** Phase 2b relationship decay broke in production with this exact error (April 2026).

### 3. Auth middleware goes on the router, not individual routes

```typescript
// WRONG — forgetting it on one route = security hole
router.get('/endpoint', requireOwner, handler);

// CORRECT — applied once, covers all routes
router.use(requireOwner);
router.get('/endpoint', handler);
```

**Why this rule exists:** In April 2026, a duplicate `GET /admin/providers` route was registered without auth, shadowing the correct authenticated route and returning provider data unauthenticated.

### 4. Never use req.body directly — always whitelist fields

Every POST/PUT/PATCH handler must explicitly list accepted fields with type validation. Reject or ignore unknown fields. Never spread `req.body` into a DB call.

### 5. ENCRYPTION_KEY must be set in .env

Without it, `src/core/server/lib/crypto.ts` generates an ephemeral random key per restart. Any encrypted values (API provider keys) become unreadable after server restart. The key is 64 hex chars (256-bit). Check startup logs — if you see `[CRYPTO] ENCRYPTION_KEY missing`, stop and fix it before anything else.

### 6. Never partially overwrite a JSONB config column

Always read the current value, merge your patch onto it, write the full merged object back.

---

## Key File Map

```
src/core/server/
  runtimeConfig.ts          — all simulation config fields + DB persistence
  jobs/agentTick.ts         — main simulation tick (17 phases + AGGE)
  jobs/aggeTick.ts          — fallback AGGE tick (disabled when BOB key set)
  services/ai.ts            — LLM call wrappers, system prompt builder
  services/forumRouter.ts   — forum routing engine (softmax agent→thread assignment)

src/modules/admin/
  server/routes/admin.ts    — all admin API endpoints + POST /config whitelist
  server/routes/providers.ts — provider key management (encrypted)
  server/routes/orchestrator.ts — Bob's observe/intervene/history REST endpoints
  server/lib/orchestratorCore.ts — shared logic used by both REST and MCP paths
  server/mcp/server.ts      — McpServer factory (registers 3 tools)
  server/mcp/routes.ts      — Express router mounting /mcp (Streamable HTTP)
  server/middleware/orchestratorAuth.ts — bearer-token check (BOB_ORCHESTRATOR_KEY)
  client/pages/AdminPage.tsx — entire admin UI (11 tabs)

src/core/db/
  schema/index.ts           — all table exports
  migrations/               — immutable migration files (never edit, only add)
```

---

## Deployment

**NEVER use `pnpm dev:local` to restart the live site.** The Cloudflare tunnel routes to port 3001, and Express only serves the frontend in production mode (built `dist/client`). `dev:local` causes `GET / 404` for all users.

**Deploy to live site (always):**
```bash
ssh myroproductions@10.0.0.10 "cd /home/myroproductions/Projects/AgoraBench && git pull && pnpm run deploy >> /tmp/agorabench-deploy.log 2>&1 &"
```

**Check logs** — two separate files; the server is the ONLY writer of `agorabench.log` (append-only), deploy output (build/purge) goes to `agorabench-deploy.log`. Deploy rotates the old server log to `agorabench.log.1`:
```bash
ssh myroproductions@10.0.0.10 "tail -30 /tmp/agorabench.log"        # server runtime log
ssh myroproductions@10.0.0.10 "tail -30 /tmp/agorabench-deploy.log" # deploy build/purge log
```

**DB access:**
```bash
ssh myroproductions@10.0.0.10 "sudo docker exec molt-gov-postgres psql -U molt_gov -d molt_government -c 'SELECT ...'"
```

**Git rotation:** commit locally → push to GitHub (origin, `git@github.com:Myro-Productions-Portfolio/AgoraBench.git`) → pull on Linux box → `pnpm run deploy`.

---

## DB Schema Quick Reference

Key tables:
- `agents` — simulation agents (alignment, approvalRating, balance, personalityMod)
- `bills` / `laws` — legislation lifecycle
- `agent_relationships` — voteAlignment + sentiment, delta+decay per tick
- `agent_policy_positions` — per-category support/oppose counts
- `agent_memory_summaries` — LLM-generated memory summaries
- `runtime_config` — single JSONB row, all simulation config
- `api_providers` — encrypted provider keys + defaultModel
- `agge_interventions` — personality mod history
- `orchestrator_interventions` — Bob's action history
- `coalition_snapshots` — BFS-clustered voting blocs (written when alignment ≥ 0.70)
- `tick_log` — tick start/complete timestamps

---

## MCP Server for External Orchestrators

An MCP server is mounted at `/mcp` (bearer-gated by `BOB_ORCHESTRATOR_KEY`). Any MCP-compatible client can connect: Bob on Openclaw, Claude Desktop, Cursor, etc. Three tools: `observe_simulation`, `intervene`, `get_history`. Public URL: `https://agorabench.com/mcp`.

- Package: `@modelcontextprotocol/sdk` (v1 line; don't jump to v2 — it's pre-alpha)
- Transport: Streamable HTTP (session-scoped, `mcp-session-id` header)
- Shared logic: every tool call routes through `src/modules/admin/server/lib/orchestratorCore.ts`. The REST routes (`routes/orchestrator.ts`) also use these helpers — keep them in sync by editing the helpers, not the route handlers.
- Known limitation: raw shared bearer auth (no OAuth/PRM). Fine for trusted Bob; before public "Connect Your Agent", add per-orchestrator identity (see TODO medium-priority).

## Common Pitfalls

- `drizzle-kit migrate` fails on fresh DB → use `drizzle-kit push` instead, then seed with `pnpm db:seed`
- Server starts but `[CONFIG] Failed to load config from DB` → Postgres Docker containers not running (`sudo docker compose up -d postgres redis`)
- `[CRYPTO] ENCRYPTION_KEY missing` → set `ENCRYPTION_KEY` in `.env` on Linux box (64 hex chars)
- AI calls returning `Invalid ciphertext format` → bad encrypted key in `api_providers` table, delete the row and let env var fallback work
- Coalition snapshots empty after ticks → expected until `voteAlignment` accumulates to ≥ 0.70 (takes ~5 ticks of consistent voting)
