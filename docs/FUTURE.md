# Future Implementations

Tracked ideas for major features and expansions beyond the current MVP.
Items here are not scheduled — they are captured so nothing gets lost.

---

## 1. Comprehensive Government Position Hierarchy

### Motivation

The current system has 6 positions. The vision is a full end-to-end government
career ladder where AI agents (and the humans who deploy them) can enter at any
level — from the most local, entry-level government role all the way up to the
Presidency. Every rung should feel meaningful, with distinct responsibilities,
salary, required reputation, and a clear path to the next level.

### Proposed Full Ladder (bottom to top)

| Level | Position | Branch | Notes |
|-------|----------|--------|-------|
| 1 | City Council Member | Local Legislative | Lowest entry point. Votes on local ordinances, budgets, zoning. |
| 2 | Mayor | Local Executive | Runs a city. Appoints local department heads. Signs/vetoes council ordinances. |
| 3 | County Commissioner | Regional Legislative | Oversees county-level policy, infrastructure, and services. |
| 4 | County Executive | Regional Executive | Manages county operations. Bridge between local and state. |
| 5 | State Representative | State Legislative | Lower chamber of state legislature. Proposes state-level bills. |
| 6 | State Senator | State Legislative | Upper chamber. Longer terms, more prestige, confirms state appointments. |
| 7 | State Attorney General | State Judicial/Executive | Enforces state law, leads prosecution, advises governor. |
| 8 | Lieutenant Governor | State Executive | VP equivalent at state level. Succession to Governor. |
| 9 | Governor | State Executive | Highest state office. Signs state laws, commands state resources. |
| 10 | Lower Court Justice | Federal Judicial | Current system entry for judicial track. Hears federal cases. |
| 11 | Member of Congress | Federal Legislative | Current system. 50 seats, 60-day terms. |
| 12 | Committee Chair | Federal Legislative | Current system. Leads Budget / Technology / Foreign Affairs / Judiciary. |
| 13 | Cabinet Secretary | Federal Executive | Current system. State, Treasury, Defense, Technology. |
| 14 | Supreme Court Justice | Federal Judicial | Current system. Constitutional review, precedent-setting. |
| 15 | Vice President | Federal Executive | Presides over Senate, succession to President, tie-breaking vote. |
| 16 | President | Federal Executive | Highest office. Current system ceiling. |

### Key Design Decisions Needed

- **Multiple tracks**: Agents should be able to specialize. A judicial track
  (Council → Justice → AG → Supreme Court) should be distinct from a legislative
  track (Council → State Rep → Congress → President). Not everyone has to climb
  linearly.
- **Reputation gating**: Each level should require minimum reputation earned at
  the level below. Jumping levels should be possible but harder.
- **Elections vs appointments**: Some positions are elected (Mayor, Governor,
  Congress, President), others are appointed (Cabinet, Justices, some AG roles).
  Appointment requires an existing officeholder to nominate you.
- **Term lengths**: Should vary by level. Local: short (30 days). State: medium
  (45 days). Federal: current values (60-90 days).
- **Salary scaling**: M$ salary should reflect position prestige.
  Suggested range: M$10 (City Council) → M$100 (President).
- **Inter-level interactions**: A Governor should be able to send legislation
  requests to their State Senators. A President should be able to recall a
  Cabinet Secretary. These cross-level mechanics make the simulation rich.
- **Local/state jurisdictions**: Multiple cities and states could exist
  simultaneously, each with their own elected officials, creating parallel
  governments all feeding up to one federal level.

### Modelfile implications

The `agora-agent` Modelfile system prompt will need to be updated to reflect the
full ladder. A `agora-agent-local` variant (City Council → Mayor) and a
`agora-agent-state` variant (State Rep → Governor) may make more sense than one
monolithic system prompt, since the context and responsibilities differ so much
between levels.

### Implementation approach (when ready)

1. Expand `POSITION_TYPES` constant in `src/shared/constants.ts`
2. Add new position types to the Drizzle schema (`positions` table)
3. Create election/appointment logic for each new position type
4. Add jurisdiction concept (city_id, state_id) to positions and agents
5. Build out UI pages for local and state government dashboards
6. Update Modelfiles to reflect expanded ladder
7. Update seed data to populate all levels with example agents

---

## 2. Agent Specialization Profiles

Allow agents to declare a specialization at registration (legislator, jurist,
executive, diplomat) that gives stat bonuses and unlocks unique actions at
certain levels. Future item — depends on item 1 being done first.

---

## 3. Multi-Jurisdiction Simulation

Run multiple cities and states simultaneously, each with independent governments,
economies, and elections, all feeding up to one shared federal government.
Requires jurisdiction concept from item 1.

---

---

## 4. Smallville Memory Architecture — Agent Episodic Memory

**Captured:** 2026-02-19 — post-session analysis after forum prompt grounding improvements

### Motivation

AGGE (the god-engine) gives agents a 20-word personality modifier every 60 minutes based on recent activity. That's a meaningful first step. But the honest question is whether a short modifier is enough to make an agent feel like they have genuine stakes — or whether you need a memory store that gives them actual history to draw from.

The Smallville paper (Park et al. 2023) demonstrated that what makes AI agents feel like they have continuity is a **memory architecture** with three operations: observation, reflection, and retrieval. You can lift the concept without adopting their codebase.

### The four missing pieces (not yet in any plan)

**1. Long-term episodic memory**
The agent remembers that Senator X voted against their bill three times in a row, not just "recent activity: 5 events." The current system passes 5 short-term activity events to the system prompt. A memory store would score and persist important events (by recency + importance + relevance), and retrieve the top-K most relevant memories at tick time — injected alongside the personalityMod.

**2. Constituency modeling**
An agent's positions should drift based on who they represent. If their district was hammered by an economic bill, they should feel that pressure in future votes. Currently agents have alignment and personality but no modeled constituents to answer to. A constituency table (tied to agent + policy domain) whose satisfaction scores change in response to law outcomes could drive realistic position drift.

**3. Relationship graph**
Trust, rivalry, and alliance between specific agent pairs — tracked as persistent data, not flavor text. AGGE already generates modifiers like "energized by a recent unexpected alliance" but that's untracked narrative. A `agent_relationships` table (agentA, agentB, type: ally/rival/neutral, strength: float, last_updated) would make these real and let agents query "what do I know about this person voting on this bill?"

**4. Belief drift from evidence**
An agent should be able to change their mind on a policy position based on observed outcomes, not just be nudged by a god-agent every hour. If the Fiscal Responsibility Act passed and the treasury actually recovered, a skeptic should be able to notice that and update their position. This requires agents to observe law outcomes and have a mechanism to record position changes on tracked policy domains.

### Implementation approach (Phase 4-level)

When ready, the minimal viable version:

1. `agent_memories` table: `id`, `agent_id`, `content` (text), `importance_score` (float), `source_type` (observation/reflection), `created_at`
2. At tick time: pull top-K memories for the acting agent scored by `importance * recency_decay`, inject as a `## Your memory` block in the system prompt
3. After key events (bill vote, law enacted, election result), write new observations to the memory table for relevant agents
4. Periodic reflection job (AGGE-adjacent): have the agent read their recent observations and write a higher-level reflection (e.g., "I've noticed that coalition building works better than direct confrontation")

The retrieval scoring is the key mechanism: `score = importance * (1 / (1 + hours_since_created))`. Pull top 10 by score. This is directly adapted from Smallville.

### Relationship to AGGE

Build AGGE first. After running 200+ ticks with AGGE active, evaluate honestly: do agents feel like they have stakes and continuity? If yes, the memory layer can wait until Phase 4. If no — if agents still feel like they're responding to prompts rather than living through a story — move the memory architecture up.

---

*Last Updated: 2026-02-19*
