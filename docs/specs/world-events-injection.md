# Spec: World Events Injection (E2 Slice 2)

2026-07-08 — the channel that turns the read-only `world_events` feed into context agents actually see when they make decisions. Slice 1 (adapters + table + `/world` page) is live and dark (commit 05f9623, PR #27). This slice adds prompt-context injection only — the weakest, most reversible of the four channels the feed spec enumerates. Channels b/c/d (DWE modulation, agenda pressure, fiscal shock) are explicitly out of scope here and follow later, one at a time.

Parent specs: `docs/specs/exogenous-reality-feed.md` (pipeline + doctrine), `docs/specs/agge-v2.md` (curator role). This spec supersedes the LLM-curation assumption in those two for the injection step — see "Curation" below for why.

## Doctrine check (the constraint everything hangs on)

The engine makes the world REACH agents as information. It never tells them what to do about it, never scripts a reaction, never picks winners among events to bias an outcome. Concretely for this slice:

- We inject a plain, factual briefing block ("here is what happened in the real world recently"). No recommended response, no "you should pass relief," no framing that presumes a policy.
- Only exogenous, world-caused events reach agents. The `world_events` table already contains only exogenous candidates — every adapter stamps an `exogeneityNote`, and the banned-source list (GDP, unemployment, treasury yields, FEMA response actions) never entered the table in the first place. This slice adds no new source; it reads what slice 1 already vetted.
- No government-caused state leaks in. The block is built purely from `world_events`; endogenous state (budgets, approval, program funding) is handled by other context builders and stays separate.

## What already lives (slice 1, correct — do not touch)

- `world_events` table: normalized, deduped `(source, externalId)`, columns include `occurredAt`, `category`, `severity` (0-1), `title`, `summary`, `location` (state FIPS or null), `status` (only ever `pending` today), `exogeneityNote`.
- Three Tier-1 adapters: USGS earthquakes, NWS alerts, OpenFEMA disaster incidents. Each pure `(payload) -> candidate | null`, failure-isolated.
- `worldFeedPoller.pollWorldEvents()` wired into `agentTick.ts` (~line 6025), gated by `rc.worldFeedEnabled` (false) and `rc.worldFeedPollTicks`. Writes only; nothing reads.
- `/world` spectator page + `/api/world/events` read route.
- Config four-things already done for the six `worldFeed*` fields (config interface + defaults, admin whitelist with clamp, AdminPage TS interface + controls in a World tab).

Confirmed: zero diff to `ai.ts` or `congressContext.ts` from slice 1. Nothing from world events currently reaches an agent.

## Design decision: which agents, which decisions, what geography

The feed spec left open whether events route by geography ("a Kansas tornado to the Kansas governor-agent"). That routing is impossible today and would invent structure that does not exist:

- The `agents` table has no district/state/region/FIPS column. Every agent is a national federal legislator. State/local agents (governors, mayors) are a late-roadmap tier (`docs/specs/government-vertical.md`) gated on Tick Engine v2 and the World Model cohort layer — not built.
- The real-world analogue settles it. A U.S. member of Congress does not learn about a disaster only if it is in their district. National-scale events (a major earthquake, a hurricane triggering federal declarations, widespread severe-weather alerts) reach every national legislator through a national news feed / briefing, and any of them may respond legislatively (federal disaster relief is a national appropriations question). So the faithful model is: every agent sees the same national world-events block, exactly like the existing `congressContext` block (also national, also identical for all agents).
- `location` (FIPS) is already carried on every row and shown in the block text ("in TX"), so when the state tier eventually exists, geographic routing is a filter added at that time with zero adapter or schema change. We carry the data now, we do not route on it now.

Decision: all active agents, on every decision `generateAgentDecision` handles, receive one identical national world-events block. No phase gating, no per-agent variation. This mirrors `congressContext` precisely and is the lowest-surprise path.

Rationale for no phase gating: `congressContext`, `forumContext`, and every other block in the `Promise.all` are phase-invariant (only `dealsContext` is phase-gated, because vote-commitment data is only meaningful in voting phases). World events are relevant to proposing, debating, and voting alike — a legislator aware of a disaster may propose relief, argue for it in forum, or weigh it in a vote. Gating would be inventing relevance rules the real world does not impose.

## Curation: deterministic, not LLM

The feed spec and agge-v2 both assumed an LLM "AGGE curation" pass (exogeneity test + materiality test + channel choice) before injection. For the prompt-context channel this slice ships, that is the wrong tool, and the existing codebase already votes deterministic:

- `congressContext.ts` — the closest existing pattern, real external data reaching agent prompts — is 100% deterministic: keyword filter, 90-day recency window, `MAX_BILLS=5`, `MAX_CHARS=800`, 1-hour cache. No LLM. It is the template the feed spec itself named for channel "a".
- The exogeneity test is already applied at ingestion (banned sources never enter the table). Re-running it per injection is redundant.
- The materiality test ("would a national government notice?") is exactly what a numeric severity threshold plus a recency window expresses — deterministic, explainable, tunable via config, auditable. An LLM materiality call adds cost, latency, and nondeterminism to a decision a `severity >= threshold` comparison makes cleanly. `worldSeverity.ts` already defines tiers (severe >= 0.75, warning >= 0.55, advisory >= 0.35) we reuse directly.
- Every LLM call in the tick already costs 12-17s on the sim model; adding a curation call per tick to filter a handful of rows is pure downside for this channel.

So: no LLM curation for prompt injection. The `buildWorldEventsBlock()` builder is deterministic, matching `congressContext`. (LLM-based curation may still earn its place later for the GDELT "huge news" channel, where dedup/summarization of raw media attention genuinely needs a model — that is Tier 2, out of scope here, and explicitly deferred.)

The `status` column stays `pending` for now. This slice does not flip rows to `injected` — the block is rebuilt from a live query each cache cycle, so there is no per-row injection state to track for a national broadcast. (When channel b/c/d work begins, per-event `status` transitions become meaningful; a note is added to the feed spec build order.) This keeps the slice minimal and avoids a write path in the read-side builder.

## The builder: `buildWorldEventsBlock()`

New file `src/modules/world/server/services/worldEventsContext.ts`, mirroring `congressContext.ts` structure exactly:

- Module-level constants: `MAX_EVENTS` (default 6), `MAX_CHARS` (default 900), `CACHE_TTL_MS` (10 min — shorter than congress's 1h because world events move faster; still cheap). Recency window and severity floor come from RuntimeConfig (below), read at build time.
- `export async function buildWorldEventsBlock(): Promise<string>`:
  1. Read `rc.worldEventsInjectionEnabled`. If false, return `''` (the block never appears, prompts are byte-identical to today — this is the dark-by-default gate for the injection channel, independent of `worldFeedEnabled` which gates polling).
  2. Cache check (same `{ block, ts }` pattern as congress).
  3. Query `world_events`: `occurredAt >= now - rc.worldEventsRecencyHours`, `severity >= rc.worldEventsMinSeverity`, `status != 'expired'`, order by `severity desc, occurredAt desc`, limit `MAX_EVENTS`. Deterministic ordering: most severe and recent first, so the char budget spends on what matters most.
  4. Format each row as one line: `[category, in <state>] <title> (severity tier) — <first sentence of summary, capped>`. Reuse `severityTier()` from `worldSeverity.ts` for the human label, `isStateFips()` to decide whether to render location. Reuse a `firstSentence()` cap identical to congress's.
  5. Join, slice to `MAX_CHARS`, cache, return.
  6. Wrap the DB query in try/catch → return `''` on failure (never throw into a prompt build; matches every other block's `.catch(() => '')` at the call site).

Dedup against already-seen events: not needed for a national broadcast — the same block is shown to all agents in a tick, and the recency window plus cache naturally rotates content as events age out. Per-agent "have I seen this" tracking is a channel-b/c/d concern (obligations, one-time shocks), not a briefing feed. Adding it here would be inventing state the briefing model does not need.

## Injection point: `ai.ts`

Two edits, both mechanical mirrors of `congressContext`:

1. `generateAgentDecision` (`ai.ts` ~line 919): add `buildWorldEventsBlock().catch((err) => { console.warn('[AI] World events block failed:', ...); return ''; })` to the existing `Promise.all`, and pass its result into `buildSystemPrompt`. It runs in parallel with the other eight builders — zero added latency (they already parallelize; this is a ninth concurrent fetch, DB-only, faster than the congress HTTP calls).
2. `buildSystemPrompt` (`ai.ts` ~line 682): add a `worldEventsContext?: string` parameter and, in the return concatenation next to the congress block, append:

```
(worldEventsContext
  ? `\n\n## Recent World Events\nThese are real events happening in the world right now — natural disasters, severe weather, and emergencies. They are context for your work as a legislator; how (or whether) to respond is entirely your judgment:\n${worldEventsContext}`
  : '')
```

The heading text is deliberately flat and non-prescriptive ("context… how or whether to respond is entirely your judgment") to honor the no-nudge rule — it states the facts and explicitly disclaims a required response, unlike a briefing memo that would recommend action.

## Char / token budget impact

- `MAX_CHARS = 900` ≈ ~225 tokens worst case, only when `worldEventsInjectionEnabled` is true AND events clear the severity floor in the window. Comparable to congress's 800-char block.
- Typical: fewer than 6 qualifying events, so the real block is smaller. When no events qualify (quiet week, or severity floor filters everything), the builder returns `''` and the block is omitted entirely — no wasted budget.
- The sim's prompt already carries memory (25 decisions), forum, congress, relationships, policy, elections, economy blocks. One more ~225-token block is well within headroom for the Gemma-31B context. No truncation risk introduced; if it ever mattered, `MAX_EVENTS`/`MAX_CHARS` are the tuning knobs.

## New RuntimeConfig fields (four-things rule — all in the one implementation commit)

Three fields. For each: (1) server handler branch in `POST /admin/config` with type check + range clamp in `admin.ts`, (2) AdminPage.tsx control in the existing World tab, (3) client TS interface entry in AdminPage.tsx, (4) verified persistence via `updateRuntimeConfig()`. Mirror the existing `worldFeed*` wiring exactly (it is the clean template).

| Field | Type | Default | Clamp | Meaning |
|---|---|---|---|---|
| `worldEventsInjectionEnabled` | bool | `false` | — | Master gate for THIS channel. Dark by default, independent of `worldFeedEnabled`. When false, `buildWorldEventsBlock()` returns `''` and prompts are byte-identical to today. |
| `worldEventsRecencyHours` | number | `72` | 1–168 | Only events within this many hours of now are eligible. 72h ≈ how long a disaster stays "current news." |
| `worldEventsMinSeverity` | number | `0.35` | 0–1 | Severity floor. 0.35 = the `advisory` tier boundary in `worldSeverity.ts` — below this, an event is noise a national legislature would not register. |

Why a separate injection flag rather than reusing `worldFeedEnabled`: polling (collecting events) and injecting (feeding them to agents) are independent decisions. An operator will want to turn polling on and watch a week of events accumulate on `/world` (already the slice-1 build order) BEFORE any event touches an agent. Two flags make "collect but don't inject" a first-class, safe state — matching how slice 1 was intended to bake before slice 2 flips on.

## Ships dark

`worldEventsInjectionEnabled` defaults false. With it false: `buildWorldEventsBlock()` short-circuits to `''`, the block is omitted, agent prompts are byte-for-byte what they are today. The entire slice is inert until an operator flips the flag in the admin World tab. This matches slice 1's dark-ship posture and the divergence-experiment discipline (flip is a deliberate, dated, watched event, not a deploy side effect).

## Out of scope (named so the boundary is explicit)

- Channels b/c/d from the feed spec: DWE modulation, emergency-session agenda items, fiscal-shock proposal opportunities. Each is a separate later slice.
- GDELT / "huge world news" (Tier 2) and any LLM curation. No adapter exists; deferred.
- Per-event `status` lifecycle transitions (`pending → injected`). Not needed for a national broadcast; becomes relevant with channel b/c/d.
- Geographic routing. Deferred to the government-vertical tier; `location` data is already carried for it.
- Any change to slice-1 files (adapters, poller, table, `/world`).

## Files touched (implementation preview — NOT this turn)

- NEW `src/modules/world/server/services/worldEventsContext.ts` (~90 lines, congress-context clone).
- `src/core/server/services/ai.ts`: one line in the `Promise.all`, one param + one block in `buildSystemPrompt`.
- `src/core/server/runtimeConfig.ts`: 3 interface fields + 3 defaults.
- `src/modules/admin/server/routes/admin.ts`: 3 whitelist branches with clamps.
- `src/modules/admin/client/pages/AdminPage.tsx`: 3 interface fields + 3 controls in the World tab.
- Unit test `tests/unit/server/worldEventsContext.test.ts`: builder returns `''` when disabled; filters by recency + severity; caps at MAX_EVENTS/MAX_CHARS; formats location and tier correctly; never throws on a DB error.

## Open design questions for the owner

1. Injection defaults — `worldEventsRecencyHours = 72`, `worldEventsMinSeverity = 0.35`, `MAX_EVENTS = 6`. These are researched-reasonable (advisory-tier floor, 3-day news currency), all tunable live from the admin tab, and irrelevant while the channel is dark. Flagging only in case the owner wants a tighter first-flip (e.g. severe-only, 0.75) so the very first live injection is unmistakably a major event. Recommendation: ship the moderate defaults; tighten at flip time if desired — no code change needed.

2. Confirm the deterministic-curation call. This spec deliberately does NOT build the LLM "AGGE curation" pass the two parent specs assumed, because `congressContext` (the named template) is deterministic and the exogeneity/materiality tests reduce cleanly to ingestion-time filtering plus a severity/recency threshold. If the owner specifically wants an LLM in the loop for this channel, that is a real scope change and I would re-spec it. Recommendation: stay deterministic for prompt injection; reserve LLM curation for the GDELT channel where it actually earns its cost.
