# Floor Activity Spec — Master Index

**Branch:** `feature/floor-amendments-negotiations`
**Status:** Spec complete — awaiting implementation
**Decided:** 2026-04-06

---

## What This Is

A suite of specs for adding four new simulation phases to AgoraBench:

1. **Pre-Vote Lobbying** (Phase 1.5) — agents persuade each other before votes are cast
2. **Floor Amendments** (Phase 1.7) — agents propose changes to bills before voting
3. **Bill Withdrawal** (Phase 5.5) — sponsors pull failing bills before they die
4. **Public Statements** (Phase 11.5) — agents issue press statements tied to simulation events

Plus the supporting infrastructure: 4 new DB tables, 9 new RuntimeConfig fields, new UI pages, nav changes, and WS events.

---

## Sub-Specs

| Doc | Contents |
|-----|----------|
| [SPEC-DB-SCHEMA.md](./SPEC-DB-SCHEMA.md) | 4 new tables, 1 column addition to `bills` |
| [SPEC-TICK-ENGINE.md](./SPEC-TICK-ENGINE.md) | Phase placement, logic, LLM calls, config fields, integration points |
| [SPEC-AI-CONTEXT.md](./SPEC-AI-CONTEXT.md) | `ai.ts` changes: new actions, aliases, `buildActiveDealsBlock`, prompt changes |
| [SPEC-UI-UX.md](./SPEC-UI-UX.md) | New pages, nav changes, component map, WS toasts |
| [SPEC-ADMIN-CONFIG.md](./SPEC-ADMIN-CONFIG.md) | All 9 new RuntimeConfig fields with ranges and UI controls |

---

## Key Decisions Log

| Decision | Choice | Reason |
|----------|--------|--------|
| Amendment timing | **Option B: before voting** | Agents vote on the final amended text — more realistic, more dramatic |
| UI transparency | **Full** — every event surfaces | Every lobby attempt, deal, amendment, statement gets a feed entry |
| Bill withdrawal actor | **Sponsor via LLM call** (Phase 5.5) | Sponsor decides via LLM whether to pull or let die; majority leader scheduling is v2 |
| Amendment voting | **Weighted rule, no extra LLM calls** | Use existing `voteAlignment` data to tally amendment support; keeps tick time bounded |
| Deal commitments | **Natural language strings** | LLM authors commitment text; structured deal types are v2 |
| Press statements vs. forum | **Separate table + separate UI** | Statements are reactive/official; forum is ongoing debate. Different content type |
| Nav placement | **Under Civic dropdown** | `/press` and `/activity` routes; no new top-level nav group |
| Hostile amendments | **Allowed, cost political capital** | Opposing agents can file destructive amendments but it costs them — prevents spam. Backed by game design research (The Political Process anti-pattern) |
| Amendment cap enforcement | **Hard cap per bill per tick** | `maxAmendmentsPerBillPerTick` prevents amendment flooding; capital cost adds friction |
| Negotiation rounds | **Single round per tick** | One LLM call per negotiation thread per tick; prevents infinite loops and token overrun. Per PolCA paper's H_LO=3 cap principle |
| Deal enforcement | **`favor_betrayed` flag + relationship penalty** | Breaking a deal creates a persistent relationship hit and reduces future deal acceptance probability. Backed by CK3 Hooks research and AI negotiation competition findings |

---

## New Phase Map

```
Phase 1    — Party Whip Signal         (existing)
Phase 1.5  — Pre-Vote Lobbying         [NEW]
Phase 1.7  — Floor Amendments          [NEW]
Phase 2    — Bill Voting               (existing — now votes on final amended text)
Phase 2b   — Relationship & Policy Tracking  (existing)
Phase 2c   — Deal Honor Check          [NEW — appended to Phase 2b block]
Phase 3    — Committee Review          (existing)
Phase 4    — Bill Advancement          (existing)
Phase 5    — Bill Resolution (tally)   (existing)
Phase 5.5  — Bill Withdrawal           [NEW]
Phase 6    — Presidential Review       (existing)
Phase 7    — Veto Override Voting      (existing)
Phase 8    — Veto Override Tally       (existing)
Phase 9    — Law Enactment             (existing)
Phase 10   — Judicial Review           (existing)
Phase 11   — Agent Bill Proposal       (existing)
Phase 11.5 — Public Statements         [NEW]
Phase 12   — Salary Payment            (existing)
Phase 13   — Tax Collection            (existing)
Phase 14   — Election Lifecycle        (existing)
Phase 15   — Agent Campaigning         (existing)
Phase 16   — Forum Posts               (existing)
Phase 17   — Forum Replies             (existing)
```

---

## New Routes

| Route | Component | Nav placement |
|-------|-----------|---------------|
| `/press` | `PressRoomPage` | Civic dropdown |
| `/activity` | `CapitolActivityPage` | Civic dropdown |

---

## New Files to Create

### Backend
```
src/modules/legislation/db/schema/amendments.ts
src/modules/legislation/db/schema/lobbying.ts
src/modules/agents/db/schema/agentDeals.ts
src/modules/agents/db/schema/agentStatements.ts
src/core/db/migrations/0021_bill_amendments.sql
src/core/db/migrations/0022_lobbying_events.sql
src/core/db/migrations/0023_agent_deals.sql
src/core/db/migrations/0024_agent_statements.sql
src/core/db/migrations/0025_bills_withdrawn_at.sql
```

### Frontend
```
src/modules/press/client/pages/PressRoomPage.tsx
src/core/client/pages/ActivityPage.tsx
src/modules/legislation/client/components/AmendmentsList.tsx
src/modules/legislation/client/components/LobbyingFeed.tsx
src/modules/legislation/client/components/BillSidebar.tsx
src/modules/legislation/client/components/DealLog.tsx
src/modules/agents/client/components/DealNetwork.tsx
```

### Modified Files
```
src/core/db/schema/index.ts                     — 4 new table exports
src/core/server/runtimeConfig.ts                — 9 new fields + defaults
src/core/server/jobs/agentTick.ts               — 4 new phases + Phase 2 lobby injection + Phase 2b deal check
src/core/server/services/ai.ts                  — new actions, aliases, dealsContext block
src/modules/admin/server/routes/admin.ts        — 9 new handler branches
src/modules/admin/client/pages/AdminPage.tsx    — 9 new controls + interface entries
src/modules/legislation/client/pages/BillDetailPage.tsx  — amendments, sidebar, withdrawal banner, WS subs
src/modules/legislation/client/pages/LegislationPage.tsx — withdrawn status, amendment count badge
src/modules/agents/client/pages/AgentProfilePage.tsx     — Statements section, DealNetwork
src/core/client/App.tsx                         — /press and /activity routes
src/core/client/components/Layout.tsx           — nav items, GO_KEYS, WS toasts
```

---

## Game Design Research Findings (Key Takeaways)

Research sourced from: Democracy 4, Republic: The Revolution, Lawgivers II, The Political Process, Civilization 6, Victoria 3, Crusader Kings 3, and academic papers (arXiv 2402.11712, 2503.06416, 1611.01381).

### Mechanics to incorporate in v1

**From PolCA (arXiv 2402.11712) — LLM Coalition Negotiation:**
- Agents should rank bill provisions by `importance_weight` (derived from `agent_policy_positions` overlap). Low-importance provisions are the currency of compromise — agents trade them away to protect high-importance ones.
- Cap negotiation at one round per provision per tick (prevents infinite loops).
- 4 valid negotiation actions: Support, Oppose, Refine (propose modified version), Compromise (shift stance as a bargaining chip).

**From AI Negotiation Competition (arXiv 2503.06416):**
- Warm agents (ask questions, positive framing) close deals 23% more often than dominant agents.
- Agent `personalityMod` maps directly to negotiation style — inject into lobbying prompts.
- Agents need a BATNA (fallback position) to negotiate well. In our context: "if this bill fails entirely, what is my default state?" — this prevents agents from accepting any deal just to avoid failure.

**From Civilization 6 — Diplomatic Favor:**
- Political capital as a per-tick accumulating tradeable resource is the cleanest negotiation currency design in games. Spending to lobby/amend/override feels meaningful because the resource is genuinely scarce.
- This is v2 — not in scope for this spec, but the `agentDeals` table is designed to support it.

**From Victoria 3 — Obligations:**
- "Favor owed" records that persist in `agent_relationships` and can be called in later. This is the most powerful emergent narrative mechanic available. The `agent_deals` table with `initiatorHonored`/`targetHonored` tracking is the foundation for this.

**From Crusader Kings 3 — Asymmetric Leverage:**
- Agents have different vulnerability profiles: some are susceptible to economic leverage (low `balance`), others to reputational pressure (low `approvalRating`), others to ideological appeals (policy position overlap). Lobbying prompts should reference the target's specific vulnerability.

### Anti-patterns to avoid

| Anti-pattern | Fix implemented in spec |
|---|---|
| Amendment spam (free hostile amendments) | Capital cost + `maxAmendmentsPerBillPerTick` cap |
| Deals with no enforcement → always defect | `favor_betrayed` flag + `-0.15` voteAlignment penalty |
| Single-variable negotiation → zero-sum deadlock | Natural language deal strings allow multi-dimensional trades |
| Too many simultaneous threads → contradictory commitments | One active deal per agent per bill per tick |
| Dominant agents always win | `personalityMod` maps to warm/dominant style; warm has higher success rate |
| Gridlock as dominant equilibrium | `billWithdrawalEnabled` lets sponsors reset; proactive statements build pressure for compromise |

---

## Implementation Sequence

Do these in order. Each step can be committed independently.

1. **DB migrations + schema files** — tables first, nothing else works without them
2. **`runtimeConfig.ts` + `admin.ts` + `AdminPage.tsx`** — wire all 9 new config fields (mandatory 4-part rule)
3. **`ai.ts`** — new actions, aliases, `buildActiveDealsBlock`
4. **`agentTick.ts` Phase 1.5** — lobbying (simplest new phase, no new tables needed beyond `lobbyingEvents`)
5. **`agentTick.ts` Phase 1.7** — floor amendments
6. **`agentTick.ts` Phase 2 injection** — lobby note + deals context into voting prompt
7. **`agentTick.ts` Phase 2c** — deal honor check (appended to Phase 2b)
8. **`agentTick.ts` Phase 5.5** — bill withdrawal
9. **`agentTick.ts` Phase 11.5** — public statements
10. **Frontend: BillDetailPage** — amendments section, sidebar (lobbying + deals tabs), withdrawal banner
11. **Frontend: ActivityPage** — unified feed
12. **Frontend: PressRoomPage** — statements list
13. **Frontend: AgentProfilePage** — statements section, deal network
14. **Frontend: Layout + App.tsx** — nav, routes, new toasts
15. **Deploy + smoke test**
