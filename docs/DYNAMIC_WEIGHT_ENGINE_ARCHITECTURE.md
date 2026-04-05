# Dynamic Weight Engine Architecture
## Molt Government Simulation — Full System Design

**Status:** IMPLEMENTED AND SMOKE-TESTED (2026-04-05)
**Derived from:** Four-sector parallel audit (2026-04-05)
**Covers:** All 17 tick phases + AGGE + relationship graph + economy feedback

### Smoke Test Results (2026-04-05)

Run on fresh DB after full implementation. One tick with real LLM calls (Qwen3-32B on Spark):

| Engine | Verification | Result |
|--------|-------------|--------|
| Phase 2b delta+decay | 90 relationship deltas applied; no SQL array error | PASS |
| Phase 2b policy positions | 30 policy positions written | PASS |
| Phase 5 yea/nay counts | 30 vote counts written to bills | PASS |
| Phase 9 law enactment | 2 laws enacted (Fiscal Responsibility + Algorithmic Transparency) | PASS |
| Phase 10 judicial review | 1 judicial review initiated (weighted challenge score) | PASS |
| Phase 6 veto composite | No president present → direct enactment path executed correctly | PASS |
| Forum routing engine | Agents routed to Phase 16 posts; Phase 17 reply routing functional | PASS |
| Coalition snapshots | 0 snapshots (expected — alignment < 0.70 threshold after 1 tick) | PASS |
| AGGE weighted selection | Auto-tick disabled (Bob orchestrates) — not tested in this run | N/A |

**Phase 2b bug fixed**: Raw SQL `= ANY(${jsArray})` replaced with two Drizzle `inArray()` update calls.

---

## The Core Problem

The simulation tracks everything and uses almost none of it to drive behavior.

Every tick, the system computes `voteAlignment` between every agent pair, updates `agentPolicyPositions` by category, records approval rating changes, stores bill outcomes, and logs activity events. All of this computation feeds only into **narrative text** injected into LLM prompts — never into numeric probability gates. The agents read about their relationships and policy history; those facts have no mechanical effect on what they do next.

The one exception — Phase 6's presidential veto probability — is the correct pattern:
```
vetoProb = min(vetoBaseRate + distance × vetoRatePerTier, vetoMaxRate)
```
A signal (alignment distance) feeds directly into a probability gate. **This pattern needs to be generalized to every phase.**

Additionally: the entire approval system is cosmetic. Updated in 15+ places, never once injected into any decision context. An agent at 12% approval and one at 89% approval make identical decisions.

---

## What Exists But Is Completely Unused

| Signal | Table.Column | Updated | Never used in |
|---|---|---|---|
| Approval rating | `agents.approvalRating` | 15+ places | Any decision prompt or probability gate |
| Reputation | `agents.reputation` | Phase 14 win | Any decision phase |
| Agent balance | `agents.balance` | Phases 12, 13 | Any decision phase |
| Treasury balance | `government_settings.treasury_balance` | Phase 13 | Any agent prompt |
| Tax rate | `government_settings.tax_rate_percent` | Admin panel | Any agent prompt |
| Vote alignment | `agentRelationships.voteAlignment` | Phase 2b | Phase 2 whip rate, Phase 6 veto prob, any gate |
| Sentiment | `agentRelationships.sentiment` | Phase 2b (= voteAlignment always) | Anywhere — also never independently computed |
| Forum interactions | `agentRelationships.forumInteractions` | Never written | Anywhere — column is always 0 |
| Policy positions | `agentPolicyPositions.*` | Phase 2b | Any probability gate — informational text only |
| Campaign endorsements | `campaigns.endorsements` | Never written | Anywhere |
| Electoral votes | `votes` table | Never written | Election resolution uses contributions instead |
| Original vote record | `billVotes.choice` | Phase 2 | Phase 7 override disposition |
| Veto reasoning | `activityEvents.metadata` | Phase 6 | Phase 7 override context |
| Coalition blocs | computed on demand | Never persisted | Any agent prompt |
| Bill floor margin | `billVotes` aggregate | Phase 2 | Phase 6 veto probability |
| AGGE intervention history | `agge_interventions` | Each AGGE run | Next AGGE target selection or context |

---

## Dead Configuration (Defined, Never Read)

| Config key | Default | Defined in | Read in |
|---|---|---|---|
| `committeeTableRateOpposing` | 0.40 | runtimeConfig | Nowhere — Phase 3 ignores it |
| `committeeTableRateNeutral` | 0.10 | runtimeConfig | Nowhere |
| `committeeAmendRate` | 0.30 | runtimeConfig | Nowhere |
| `amendmentProposalChance` | 0.15 | runtimeConfig | Nowhere — Phase 11 uses hardcoded 0.25 |

---

## The Eight Dynamic Weight Engines

### Engine 1: Legislative Decision Router
**Replaces:** Flat `rc.partyWhipFollowRate = 0.78` (Phase 2), orphaned committee rates (Phase 3), Phase 7's memoryless override bias

**Feeds into:** Phases 1, 2, 3, 7

#### Phase 2 — Per-Agent Whip Follow Rate
```
whipFollowRate(agent, bill) =
  rc.partyWhipFollowRate                          // base 0.78
  + voteAlignmentBonus(agent, partyLeader)        // +0.10 if alignment > 0.85, -0.15 if < 0.40
  - approvalPressure(agent.approvalRating)        // -0.20 if approval < 30 (constituent pressure)
  + policyCongruence(agent, bill.committee)       // +0.05 if agent historically supports category
  - ideologicalDistance(agent, bill.sponsor)      // -0.10 per tier in ALIGNMENT_ORDER
  clamped to [0.10, 0.97]
```

Data sources: `agentRelationships.voteAlignment` (agent→leader pair), `agents.approvalRating`, `agentPolicyPositions.supportCount/opposeCount` for `bills.committee`, `ALIGNMENT_ORDER` distance.

Defection penalty becomes dynamic:
```
whipDefectionDelta = -5 × (1 + billSalienceMultiplier)
// billSalienceMultiplier = coSponsorCount / 5, capped at 1.0
```

#### Phase 3 — Activate Dead Committee Config
The orphaned `committeeTableRateOpposing/Neutral/committeeAmendRate` finally connect to code.

Pre-LLM alignment check between chair and sponsor using `ALIGNMENT_ORDER`. If distance ≥ 2 tiers: apply `committeeTableRateOpposing` as a pre-filter (same pattern as Phase 2 whip roll). If chair and sponsor are aligned: skip the table roll entirely.

Context enrichment (always): inject chair's `agentPolicyPositions` for `bill.committee` as a numeric prior, plus chair's `voteAlignment` with sponsor.

#### Phase 7 — Veto Override with Memory
Override context must include:
1. Agent's own Phase 2 vote (queried from `billVotes` where `voterId = agent.id AND billId = bill.id`)
2. President's veto reasoning (from `activityEvents` where `type = 'presidential_veto'` and `metadata->>'billId' = bill.id`)
3. Agent's `voteAlignment` with president

Pre-LLM override disposition bias:
```
overrideBias(agent, bill) =
  if originalVote == 'yea' → +0.30 toward override_yea
  if voteAlignmentWithPresident > 0.75 → +0.25 toward override_nay
  if policyPosition for bill.committee == strong_support → +0.15 toward override_yea
```

Fix default bias inconsistency: Phases 1/2 default ambiguous output to `yea`. Phase 7 defaults to `override_nay`. Phase 7 should default to the agent's original vote direction.

---

### Engine 2: Presidential Veto Composite
**Replaces:** Sponsor-alignment-only veto probability (Phase 6)
**Improves:** The one existing pattern — makes it richer

```
vetoProb(president, bill) =
  rc.vetoBaseRate
  + policyDisagreement(president, bill.committee)      // from agentPolicyPositions
  + ideologicalDistance(president, sponsor)            // existing ALIGNMENT_ORDER — keep
  - legislativeMandateDiscount(yeaCount, nayCount)     // -0.15 if passed by >75% margin
  - crossPartyCoalitionDiscount(bill.coSponsorIds)     // -0.10 if 2+ cross-party co-sponsors
  ± approvalFactor(president.approvalRating)           // +0.05 if >70, -0.10 if <35
  clamped to [rc.vetoBaseRate, rc.vetoMaxRate]
```

**Schema addition needed:** Denormalize `yeaCount` and `nayCount` onto `bills` table during Phase 5 resolution. Currently requires joining `billVotes` in Phase 6 — denormalizing makes the data instantly available.

The president should also generate reasoning when *signing* bills (not just vetoes). Currently the LLM is only called when `Math.random() >= vetoProb`. Add a low-probability (10%) sign-with-statement call for politically significant bills (high co-sponsor count or close vote).

---

### Engine 3: Relationship Evolution Engine
**Replaces:** All-time-aggregate `voteAlignment` recompute every tick; `sentiment = voteAlignment` always
**Fixes:** `forumInteractions` never written (column permanently 0)

#### New update model — event-driven deltas with decay

Every tick: apply 5% decay toward neutral on all relationship scores:
```
voteAlignment = voteAlignment + (0.5 - voteAlignment) × 0.05
sentiment = sentiment + (0.5 - sentiment) × 0.05
```

Then apply event deltas for the current tick only (not all-time history):

| Event | Relationship | `voteAlignment` delta | `sentiment` delta |
|---|---|---|---|
| Both vote same direction | A↔B | +0.03 | +0.01 |
| Both vote opposite directions | A↔B | -0.04 | -0.02 |
| A co-sponsors B's bill | A→B | 0 | +0.08 |
| B receives A's co-sponsorship | B→A | 0 | +0.04 |
| A's bill tabled by B (chair) | A→B | 0 | -0.08 |
| A's bill vetoed by B (president) | A→B | 0 | -0.10 |
| A replies to B in forum | A↔B | 0 | +0.02, increment `forumInteractions` |
| A wins election B competed in | A→B: 0, B→A | 0 | -0.06 |

`sentiment` becomes a genuine measure of personal relationship quality, independent from vote pattern alignment.

**Phase 17 addition:** After every forum reply, run:
```sql
INSERT INTO agent_relationships (agentId, targetAgentId, forumInteractions, sentiment, ...)
ON CONFLICT DO UPDATE SET
  forumInteractions = forumInteractions + 1,
  sentiment = sentiment + 0.02
```
for the (replier, thread-author) pair.

#### Schema addition
Add `lastInteractionAt timestamp` to `agentRelationships` for recency tracking.

---

### Engine 4: Forum Routing Engine
**Replaces:** Flat 12%/70% ambient/mention reply rolls; random thread selection; stuck-on-one-thread feedback loop
**Described in detail in:** `docs/FORUM_ROUTER_SPEC.md` (from prior planning session)

**Core scoring function per agent/thread:**
```
threadScore(agent, thread) =
  W_AFFINITY × (alignmentRank + tanh(policyNet/5) × 0.5 + keywordBoost)
  + W_RELATIONSHIP_HEAT × (opponentRecentPosts × 1.0 + allyRecentPosts × 0.3)
  + W_SATURATION × agentPostsInThreadThisCycle        // negative — prevents monopolization
  + W_MENTION_DEBT if pendingMention                  // overrides everything
```

Decision array: `[silenceDrive, postDrive, threadScore(t1)...threadScore(tN)]`
Sampled via softmax at temperature 0.7 — not argmax. Variance is built into sampling, not weights.

**Additional fixes bundled:**
- `bio` injected into `buildSystemPrompt` (field exists, never used)
- `forum_reply` added to `PHASE_ACTION_MAP` (currently missing — validation bypassed for all replies)
- `parentId` targets most recent post, not always the OP
- Provider override passthrough in phases 16/17 (currently bypassed)
- Relationship context injected into reply prompts (tells LLM if the post author is an opponent)
- Cross-thread awareness hint (other active thread titles in reply context)

---

### Engine 5: Electoral Weight Engine
**Replaces:** Contribution-sum winner determination; flat win/loss approval deltas; unused `votes` table

#### Election resolution
The `votes` table exists and has the right schema. Agents should cast electoral votes during the `voting` status window. Each vote has weight:

```
voteWeight(voter, candidate) =
  1.0                                               // base
  × approvalModifier(voter.approvalRating / 50)     // popular agents represent more constituents
  + policyAlignment(voter, candidate.platform)      // keyword match on campaign platform
  + relationshipModifier(voter→candidate.voteAlignment × 0.3)  // ±0.3
```

Winner = candidate with highest weighted vote total. `elections.totalVotes` gets written.

#### Post-election feedback loop (currently absent entirely)
```
winnerApprovalDelta = +15 × victoryMarginFactor     // victoryMarginFactor = winnerVotes/totalVotes
loserApprovalDelta = -15 × (1 - ownVoteShare)       // squeaker loss ≠ landslide loss
```

Additional cascades:
- Agents who voted for winner: `+2` approval (backed the right horse)
- Losing candidates: `agentPolicyPositions.opposeCount++` in winner's platform categories (electoral loss = policy reappraisal)
- Direct competitors: `relationshipStrength` gets competitive penalty (rivals drift apart)
- Winner gets `personalityMod`: "riding a wave of electoral confidence..." for 2-3 ticks
- Loser gets `personalityMod`: "reeling from electoral defeat, recalibrating..." for 2-3 ticks

#### Phase 14 hardcoded fix
Position `endDate` currently hardcodes `90 * 24 * 60 * 60 * 1000` inline. Should use `rc.presidentTermDays` / `rc.congressTermDays` by `positionType`.

---

### Engine 6: Campaign Desperation Engine
**Replaces:** Flat 20% speech chance; uniform boost clamp 10-100; endorsements never written

```
speechChance(agent, election) =
  rc.campaignSpeechChance
  × urgencyMultiplier(daysRemaining / campaignDurationDays, inverted)   // 1.0→3.0 as deadline nears
  × deficitMultiplier((leaderContributions - ownContributions) / leaderContributions + 1)
  × approvalModifier(agent.approvalRating / 50)
```

Speech contribution boost:
```
speechBoost = rawLLMBoost
  × (agent.approvalRating / 50)
  × (1 + endorsementCount × 0.10)
```

Endorsement mechanics (finally activating `campaigns.endorsements`):
- Per tick, for each active campaign: check if any agent with `voteAlignment > 0.75` to the candidate is active
- 5-10% chance that ally agent grants endorsement (appended to JSON array)
- Endorsement drives `speechBoost` multiplier above

Campaign context message must include: current contribution standings, days remaining, opponent names and platforms. Currently it has only `positionType`.

---

### Engine 7: Economic Pressure Engine
**Replaces:** Treasury and agent balance having zero effect on any behavior
**New addition:** `buildEconomyContextBlock()` in `ai.ts`

#### Bill proposal rate modifier (Phase 11)
```
treasuryRatio = treasuryBalance / 50000   // baseline seed value
effectiveProposalChance =
  rc.billProposalChance
  × treasuryPressureMultiplier(alignment, treasuryRatio)   // 1.4× for conservative/libertarian in crisis
  × agentWealthModifier(agent.balance / rc.initialAgentBalance)  // 0.7× if balance < 25% of starting
```

#### Agent prompt injection
New `buildEconomyContextBlock(agentId)` function — 8th context block in `buildSystemPrompt`:
```
## Economic Context
Treasury: $[balance] ([healthy/strained/critical])
Current tax rate: [N]%
Your personal balance: $[N]
```

When agents see "treasury is critical at $2,400," fiscal conservatives will organically propose austerity bills. Progressives will propose tax hikes. No hardcoded logic needed — the LLM does it.

#### Treasury stress event pipeline
When Phase 12 skips a salary payment due to low treasury: insert `activityEvent` of type `treasury_crisis`. `buildSimulationStateBlock()` includes the most recent such event if within 5 ticks. This makes the economic crisis visible to every agent in every phase.

#### Judicial review weighting (Phase 10)
Replace flat 3% roll with weighted challenge score:
```
challengeScore(law) =
  rc.judicialChallengeRatePerLaw
  × recencyMultiplier(ticksOld)              // ×1.5 if enacted within 2 ticks
  × contestedLawMultiplier(yeaCount, nayCount) // ×1.8 if floor margin < 60%
  × alignmentDistanceMultiplier(court, sponsor) // ×1.25 per tier of court-median vs sponsor distance
  × repeatChallengeDiscount                  // ×0.3 if already upheld once
  capped at 0.40
```

---

### Engine 8: AGGE Evolution Pressure Engine
**Replaces:** Pure random agent selection for personality evolution
**Fixes:** AGGE never reads its own intervention history; thin context (5 event title strings only)

#### Weighted target selection
```
evolutionPressure(agent) =
  activityEventsLastTick × 1.0              // baseline activity
  + billVetoedOrStruckDown × 2.0           // trauma
  + electionWonOrLost × 2.0               // major life event
  + abs(approvalRatingDelta) > 15 ? 1.5 : 0  // public opinion shift
  + whipDefectionThisTick × 1.5           // ideological friction
  - evolvedLastAggeTick × 1.0             // cool-down
```

Normalize to probability distribution, sample without replacement for batch.

#### Richer AGGE context
AGGE context message currently has 5 activity event title strings. Add:
- Agent's current `approvalRating` and direction (rising/falling)
- Agent's `balance` and recent trend
- Most recent `agge_interventions` row for this agent (previous modifier + outcome) — so AGGE knows the evolution history and doesn't repeat cycles
- Recent bill outcome (sponsored a bill that was struck down? just won election?)

---

## Implementation Sequence

The engines have dependencies. Build in this order to avoid breaking the live sim at any point. Each step is independently deployable.

### Phase 1 — Foundation (no behavioral change, purely additive)
1. Add `bio` to `AgentRecord` interface and inject into `buildSystemPrompt`
2. Add `forum_reply` to `PHASE_ACTION_MAP` + aliases
3. Add economy context fields to `RuntimeConfig` interface with defaults
4. Add forum routing config fields to `RuntimeConfig`
5. Denormalize `yeaCount`/`nayCount` onto `bills` table (written in Phase 5, read in Phase 6)
6. Fix Phase 14 hardcoded `90 * 24 * 60 * 60 * 1000` → use `rc.presidentTermDays/congressTermDays`

### Phase 2 — Relationship Evolution Engine (Engine 3)
Replaces all-time-aggregate recompute with delta+decay model. Self-contained change to Phase 2b. Also starts writing `forumInteractions` from Phase 17.

### Phase 3 — Approval + Economy Context Injection
Add `buildEconomyContextBlock()` to `ai.ts`. Add `approvalRating` injection to `buildSystemPrompt`. These two changes alone give agents awareness of their financial state and political standing — behavioral improvements start immediately in every phase with no other changes.

### Phase 4 — Legislative Decision Router (Engine 1)
Per-agent whip follow rate (Phase 2), activate dead committee config (Phase 3), Phase 7 override memory. These three sub-changes can ship independently.

### Phase 5 — Presidential Veto Composite (Engine 2)
Expand the existing veto probability function. Lowest risk change — extends an existing pattern rather than replacing static logic.

### Phase 6 — Forum Routing Engine (Engine 4)
The largest single module. New `forumRouter.ts` service. Phases 16/17 become execution-only. Also bundles bio injection, PHASE_ACTION_MAP fix, parentId fix, provider override fix.

### Phase 7 — Economic Pressure Engine (Engine 7)
Treasury crisis events, bill proposal rate modifier, judicial review weighting.

### Phase 8 — Electoral Weight Engine (Engine 5)
Activates the `votes` table for the first time. Campaign Desperation Engine (Engine 6) bundles naturally here.

### Phase 9 — AGGE Evolution Pressure Engine (Engine 8)
Weighted target selection, richer context, history-aware nudging.

### Phase 10 — Coalition Formation
Persist `detectBlocs` output per tick. Inject coalition context into Phase 11 bill proposal prompts. Wire `campaigns.endorsements` into electoral weight.

---

## New RuntimeConfig Fields Required

```typescript
// Relationship evolution
relationshipDecayRate: number;          // default 0.05 — per-tick decay toward neutral
forumInteractionSentimentBonus: number; // default 0.02 — per forum reply between agents

// Forum routing (see FORUM_ROUTER_SPEC.md for full list)
forumBaseSilenceWeight: number;         // default 2.0
forumDecayHalfLifeTicks: number;        // default 3
forumSilencePressureThreshold: number;  // default 5
maxForumPostsPerTick: number;           // default 3
maxForumRepliesPerTick: number;         // default 5

// Economy
initialAgentBalance: number;            // default 1000 — baseline for wealth ratio
treasuryCrisisThreshold: number;        // default 0.20 — fraction of seed that triggers crisis
economyProposalMultiplierCrisis: number; // default 1.4 — bill proposal boost in fiscal crisis

// Elections
electionVoteWeightApproval: boolean;    // default true — use approval-weighted voting
electionPostOutcomeCascade: boolean;    // default true — enable relationship/approval cascades

// Judiciary
judicialContestationBonus: number;      // default 1.8 — multiplier for contested floor votes
judicialRecencyBonus: number;           // default 1.5 — multiplier for newly enacted laws

// AGGE
aggeEvolutionPressureWeighted: boolean; // default true — weighted vs random agent selection

// Approval feedback
approvalDecayTarget: number;            // default 40 — currently hardcoded, now configurable
approvalInSystemPrompt: boolean;        // default true — inject approval into agent context
```

---

## New Schema Fields Required

| Table | Field | Type | Purpose |
|---|---|---|---|
| `bills` | `yeaCount` | integer | Denormalized floor vote count — Phase 5 writes, Phase 6 reads |
| `bills` | `nayCount` | integer | Denormalized floor vote count |
| `agentRelationships` | `lastInteractionAt` | timestamp | Recency tracking for decay |
| `agentRelationships` | `relationshipStrength` | real | Composite score independent of voteAlignment |
| `forum_threads` | (none needed) | — | existing schema sufficient |
| `elections` | (none needed) | — | existing `totalVotes` just needs to be written |

---

## Summary Table — All Static Values and Their Replacements

| Phase | Location | Current value | Replacement |
|---|---|---|---|
| 1 | Whip context | No policy/relationship context | Inject chair policy history + sponsor alignment |
| 2 | agentTick:205 | Flat 0.78 whip follow | Per-agent loyalty function (Engine 1) |
| 2 | agentTick:307 | -5 defection penalty | -5 × billSalienceMultiplier |
| 2 | agentTick:319 | -3 absenteeism | Scale by chronic rate |
| 2b | agentTick:360 | All-time aggregate recompute | Delta + decay model (Engine 3) |
| 2b | agentTick:393 | sentiment = voteAlignment always | Independent event-driven signal |
| 3 | runtimeConfig | committeeTableRateOpposing = 0.40 (orphaned) | Activate as pre-filter gate |
| 3 | runtimeConfig | committeeTableRateNeutral = 0.10 (orphaned) | Activate as pre-filter gate |
| 3 | runtimeConfig | committeeAmendRate = 0.30 (orphaned) | Activate as context prior |
| 3 | agentTick:525 | -8 tabling penalty | Scale by alignment distance |
| 6 | agentTick:792 | Sponsor-alignment-only vetoProb | Composite with margin + coalition + approval (Engine 2) |
| 6 | agentTick:798 | Binary gate (only ask about vetoes) | Also generate signing statements at low probability |
| 6 | agentTick:856 | -10 veto penalty flat | Scale by floor margin |
| 7 | agentTick:899 | No memory of original vote | Inject original vote + veto reasoning |
| 7 | agentTick:936 | Default override_nay | Default to original vote direction |
| 10 | agentTick:1299 | Flat 3% per law | Weighted challenge score (Engine 7) |
| 10 | agentTick:1378 | Tie = struck down | Document as intentional or make configurable |
| 11 | agentTick:1472 | Flat 30% proposal chance | Economy-pressure-modified rate (Engine 7) |
| 11 | agentTick:1483 | Hardcoded 25% amendment | Use rc.amendmentProposalChance (already defined, never read) |
| 12 | agentTick:1613 | console.warn on low treasury | Emit treasury_crisis activityEvent |
| 14 | agentTick:1776 | Max contributions = winner | Weighted vote tally from votes table (Engine 5) |
| 14 | agentTick:1801 | 90 days hardcoded | Use rc.presidentTermDays / rc.congressTermDays |
| 14 | agentTick:1815 | +200 rep, +500 balance flat | Scale to margin and position weight |
| 14 | agentTick:1847 | +15 win approval flat | +15 × victoryMarginFactor |
| 14 | agentTick:1857 | -15 loss approval flat | -15 × (1 - ownVoteShare) |
| 15 | agentTick:1892 | Flat 20% speech chance | Desperation × approval gradient (Engine 6) |
| 15 | agentTick:1941 | Boost clamped 10-100 | Boost × approvalModifier × endorsementMultiplier |
| 16 | agentTick:1970 | billProposalChance × 0.5 derived | forumBaseSilenceWeight via router (Engine 4) |
| 17 | agentTick:2110 | 0.70/0.12 hardcoded rolls | Full routing score distribution (Engine 4) |
| 17 | agentTick:2201 | parentId = always OP | parentId = most recent post |
| 18 | agentTick:2234 | Decay target 40 hardcoded | rc.approvalDecayTarget |
| AGGE | aggeTick:85 | Pure random shuffle | Evolution pressure weighted selection (Engine 8) |
| All | ai.ts | approvalRating never in prompt | Inject via buildSystemPrompt (Engine 3) |
| All | ai.ts | balance never in prompt | Inject via buildEconomyContextBlock (Engine 7) |
| All | ai.ts | bio never in prompt | Inject after personality line |
