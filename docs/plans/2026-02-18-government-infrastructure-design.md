# Government Infrastructure Design

**Date:** 2026-02-18
**Branch:** docs/government-infrastructure-design
**Status:** Approved — pending implementation planning

---

## Overview

This document captures the full architectural vision for expanding Agora Bench from its current federal-only simulation into a comprehensive, full-stack government world — covering every tier of government, every job from janitor to president, a living external world that injects pressure, a citizen agent system that spawns organically, and a long-term path from the current 2D map to a Smallville-style 3D autonomous world.

The simulation is US-inspired in structure but fictional in identity. No political branding. Creative freedom for AI agents to develop their own governing patterns, coalitions, and ideologies within the confines of the system they operate in.

**Chosen approach:** Phased Layered Rollout — build on the existing federal foundation, use seed systems as placeholders, upgrade to live AI agents incrementally as infrastructure scales.

---

## Section 1: Government Hierarchy

All roles are classified as either an **AI Agent** (has personality, makes autonomous decisions, consumes AI tokens) or a **Seed System** (exists in the data model, responds to events mechanically, zero token cost until explicitly upgraded).

This classification is not permanent. Any seed system can be promoted to a live AI agent. The architecture supports this without schema changes — only a flag flip and a prompt assignment.

### Federal Tier (Phase 1)

#### Executive Branch

| Role | Classification | Notes |
|---|---|---|
| President | AI Agent | Exists today |
| Vice President | AI Agent | New — breaks Senate ties, succession line |
| Cabinet Secretaries (x15) | Seed System | State, Defense, Treasury, Justice, Interior, Agriculture, Commerce, Labor, Health, Housing, Transportation, Energy, Education, Veterans, Homeland |
| Deputy Secretaries | Seed System | One per Cabinet department |
| Federal Agency Directors | Seed System | EPA, FBI, IRS, FDA, CIA, NSA, FEMA, ATF, DEA, FTC, SEC, FEC, FCC, USDA-FSIS, etc. |

#### Legislative Branch

| Role | Classification | Notes |
|---|---|---|
| Upper Chamber Members (~50) | AI Agent | Exists today as `congress_member` — renamed/split |
| Lower Chamber Members (~150) | AI Agent | New — distinct body, different term length, different quorum rules |
| Committee Chairs | Seed System | Finance, Armed Services, Judiciary, Foreign Relations, Intelligence, Budget, Education, Commerce, Environment, Ethics |
| Committee Staff Directors | Seed System | One per committee |
| Sergeant-at-Arms | Seed System | Procedural enforcement |
| Legislative Clerk | Seed System | Official record keeper |

#### Judicial Branch

| Role | Classification | Notes |
|---|---|---|
| Supreme Court Justices (x7) | AI Agent | Exists today |
| Appellate Court Judges (~36) | Seed System | 12 circuits, 3 judges each |
| District Court Judges (~90) | Seed System | Lower federal courts |
| Magistrate Judges | Seed System | Handle preliminary proceedings |
| Clerk of the Court | Seed System | Per court level |
| Public Defenders (Federal) | Seed System | Federal public defender offices |
| Federal Prosecutors | Seed System | U.S. Attorneys, one per district |

### State Tier (Phase 2)

One instance per defined state (suggest starting with 10 states, expanding to 50).

| Role | Classification |
|---|---|
| Governor | AI Agent |
| Lieutenant Governor | Seed System |
| State Legislature (upper + lower chambers) | Seed System → AI Agent |
| State Attorney General | Seed System |
| State Supreme Court | Seed System |
| State Courts (lower) | Seed System |
| State Agency Directors | Seed System |
| State Budget Director | Seed System |
| State Secretary of State | Seed System |

### Local Tier (Phase 3)

One instance per defined city/county.

| Role | Classification |
|---|---|
| Mayor | AI Agent |
| City Manager | Seed System |
| City Council Members | Seed System |
| County Executive | Seed System |
| County Commissioners | Seed System |
| County Sheriff | Seed System |
| City Attorney | Seed System |
| Local Court Judges | Seed System |
| School Board Members | Seed System |
| Planning Commission | Seed System |

### Service Layer (Phase 3)

Government-operated services that citizens directly interact with. Each has a budget line, a backlog stat, and a satisfaction score that legislation can affect.

| Service | Classification | Key Stats |
|---|---|---|
| DMV / Motor Vehicle Registry | Seed System | Wait time, backlog, funding level |
| Tax Collection Office | Seed System | Collection rate, audit volume, staffing |
| Social Services Office | Seed System | Caseload, approval rate, wait time |
| Public Health Department | Seed System | Outbreak response time, vaccination rate |
| Building & Permits Office | Seed System | Permit backlog, inspection capacity |
| Public Defender's Office (local) | Seed System | Case backlog, win rate |
| Local Courts | Seed System | Case backlog, time-to-trial |
| Public Transit Authority | Seed System | Ridership, on-time rate, funding |
| Public Housing Authority | Seed System | Vacancy rate, waitlist length |
| Unemployment Office | Seed System | Claim volume, processing time |
| Veterans Services Office | Seed System | Active cases, services offered |
| Public Library System | Seed System | Hours, branches, budget |
| Emergency Management Office | Seed System | Response readiness, equipment funding |

---

## Section 2: Job Architecture — Full Roster System

Every government entity carries a complete roster of positions. This makes the budget system real: when a bill cuts EPA funding by 20%, that maps to specific position types being eliminated or frozen. When a state increases education spending, school staff headcounts increase.

### Universal Seven-Tier System

All entities — from the Department of Defense to a local DMV branch — use the same seven job tiers. Titles vary; structure does not.

| Tier | Code | Description | AI Agent Eligible |
|---|---|---|---|
| Executive | `exec` | Heads of entities, constitutional officers, elected officials | Yes |
| Management | `mgmt` | Deputy directors, office chiefs, chiefs of staff, division heads | Yes (Phase 2+) |
| Professional | `prof` | Attorneys, analysts, engineers, scientists, IT specialists, economists, investigators | Yes (Phase 3+) |
| Administrative | `admin` | Budget officers, HR specialists, coordinators, records managers, executive assistants | No (Seed only) |
| Operations | `ops` | Field agents, inspectors, officers, examiners, road test examiners, field reps | No (Seed only) |
| Support | `support` | Clerks, receptionists, customer service reps, data entry, logistics | No (Seed only) |
| Facilities | `fac` | Custodians, maintenance workers, security guards, mail room, cafeteria, groundskeepers | No (Seed only) |

### Example Roster: Department of Justice (Federal, Seed System)

```
EXECUTIVE
  Attorney General (1)
  Deputy Attorney General (1)
  Associate Attorney General (1)
  Solicitor General (1)

MANAGEMENT
  Assistant Attorneys General — x6 (one per division: Criminal, Civil, National Security,
    Civil Rights, Environment & Natural Resources, Antitrust)
  Chief of Staff (1)
  Director of Public Affairs (1)
  Deputy Solicitor General (3)

PROFESSIONAL
  Trial Attorneys (240)
  Legal Counsel (80)
  Forensic Analysts (60)
  Criminal Investigators (90)
  Policy Analysts (45)
  Economists (20)
  IT Security Specialists (35)
  Statisticians (15)
  Paralegal Specialists (55)
  Intelligence Analysts (30)

ADMINISTRATIVE
  Budget Analysts (30)
  HR Specialists (25)
  Records Managers (40)
  Executive Assistants (18)
  Program Coordinators (50)
  Grants Managers (12)
  Contracting Officers (20)
  Financial Analysts (25)

OPERATIONS
  FBI Special Agents (13,000) — sub-entity, budgeted here
  U.S. Marshals (5,000) — sub-entity
  Bureau of Prisons Officers (36,000) — sub-entity
  ATF Agents (2,500) — sub-entity
  DEA Agents (4,600) — sub-entity

SUPPORT
  Legal Clerks (120)
  Docket Clerks (60)
  Receptionists (40)
  Logistics Coordinators (30)
  Mail Processors (15)

FACILITIES
  Custodians (90)
  Maintenance Workers (45)
  Security Guards (110)
  Mail Room Staff (20)
  Cafeteria Workers (35)
  Groundskeepers (12)
```

### Example Roster: Local DMV Office (Phase 3, Seed System)

```
EXECUTIVE
  State DMV Director (1)
  Regional Director (1)

MANAGEMENT
  Office Manager (1)
  Deputy Office Manager (1)

PROFESSIONAL
  License Examiners (8)
  Vehicle Safety Inspectors (6)
  Title & Registration Specialists (5)
  IT Support Specialists (2)
  Fraud Investigators (1)

ADMINISTRATIVE
  Administrative Coordinator (2)
  Records Clerk (3)
  Scheduling Coordinator (1)
  Budget Analyst (1)

OPERATIONS
  Road Test Examiners (4)
  Field Vehicle Inspectors (3)

SUPPORT
  Customer Service Representatives (12)
  Queue Management Staff (4)
  Data Entry Clerks (6)
  Cashiers (3)

FACILITIES
  Custodians (3)
  Maintenance Worker (1)
  Security Guard (2)
```

### Example Roster: White House / Executive Office of the President

```
EXECUTIVE
  President (1) — AI Agent
  Vice President (1) — AI Agent
  Chief of Staff (1)
  National Security Advisor (1)
  Press Secretary (1)
  Senior Advisors (4)

MANAGEMENT
  Deputy Chiefs of Staff (3)
  Deputy National Security Advisors (2)
  Deputy Press Secretaries (2)
  Director of Legislative Affairs (1)
  Director of Communications (1)
  Director of Scheduling (1)
  Director of Personnel (1)

PROFESSIONAL
  Policy Analysts (35)
  Speechwriters (8)
  Legal Counsel (12)
  Economic Advisors (10)
  Cybersecurity Advisors (6)
  Intelligence Briefers (4)
  Press Advance Team (15)

ADMINISTRATIVE
  Executive Assistants (20)
  Scheduling Coordinators (8)
  Budget Coordinators (5)
  Records Managers (10)
  Correspondence Staff (30)

OPERATIONS
  Secret Service Agents (500) — sub-entity
  Military Aides (6)
  Situation Room Staff (25)

SUPPORT
  Switchboard Operators (12)
  Visitors Office Staff (10)
  Gift Office Staff (4)

FACILITIES
  White House Ushers (25)
  Executive Residence Staff (90)
  Kitchen Staff (30)
  Housekeepers (45)
  Groundskeepers (20)
  Florists (5)
  Electricians & Maintenance (35)
  Security Guards (assigned from Secret Service)
```

### Contractor & Consultant Bucket (Phase 4+)

Beyond full-time employees, agencies draw on external labor. This is a separate seeded pool — a market of contractors and consultants that agencies can engage. Each engagement has:

- Firm name and type (IT, defense, legal, consulting, research, lobbying-adjacent)
- Contract value and duration
- Scope of work
- Dependency flag — whether the agency has become reliant on this contractor (creates a vulnerability if cut)
- Political exposure — some firms have ties to specific agents or parties

Budget impact is a separate line item from payroll. Cutting contractor spend is politically easier than laying off employees, even at the same dollar amount — which creates interesting legislative dynamics. A bill that "reduces government waste" might eliminate contractors that agencies genuinely depend on, causing service degradation that then generates citizen complaints.

### Data Model Notes

- Table: `government_roles` — columns: `entity_id`, `tier`, `title`, `headcount`, `salary_grade`, `ai_agent_eligible`, `active`
- Table: `government_entities` — columns: `id`, `name`, `type` (federal/state/local/service), `tier`, `parent_entity_id`, `budget`, `headcount_total`, `satisfaction_score`, `backlog_score`
- Seed data: approximately 50,000 rows across all entities and tiers — generated once at DB seed time, static unless legislation changes headcount
- Budget engine: each entity's payroll = sum of (headcount × salary_grade) per tier, aggregated up the entity tree

---

## Section 3: External World Events — The Bucket System

Without external pressure the simulation reaches equilibrium. Agents settle into patterns. Buckets prevent this by injecting randomized, realistic stimuli that force government agents to respond — or face consequences for not doing so.

### Injection Mechanics

On every configurable N-th tick the engine draws from one or more event buckets and creates an **active world event**. Active events are injected into agent decision prompts exactly like forum threads and recent decisions are today — agents see the event in context and decide how to respond.

Events have:
- `type` — which bucket it came from
- `severity` — 1 to 5
- `duration_ticks` — how long it stays active in agent context
- `affected_entities` — which government entities are in scope
- `mechanical_effects` — budget pressure modifier, approval rating modifier, citizen spawn trigger
- `resolution_conditions` — what agent actions close the event (legislation passed, emergency declared, treaty signed, etc.)

### The Six Buckets

#### Bucket 1: Foreign Relations

Other nations exist as named fictional entities with their own disposition score toward the simulation government (0–100, where 0 is hostile and 100 is allied). Disposition shifts based on legislation (trade laws, military spending bills, treaties, sanctions).

Event examples:
- Trade dispute with a neighboring nation
- Diplomatic incident requiring a formal response
- Foreign aid request from a struggling ally
- Border tension escalating toward military posture
- Intelligence leak attributed to a foreign state
- Joint military exercise opportunity
- Cyber attack attributed to a foreign actor
- Sanctions pressure from an international body
- Refugee crisis originating from a neighboring country
- Trade agreement opportunity with favorable terms

#### Bucket 2: Environmental / Natural Disasters

Events that demand emergency funding and inter-agency coordination. Notably, these often expose the consequences of earlier budget decisions — a department that was defunded may now be understaffed during a crisis.

Event examples:
- Hurricane making landfall in a coastal region
- Wildfire season requiring federal resource deployment
- Major dam failure and flooding
- Drought affecting agricultural output
- Earthquake in a populated city
- Industrial chemical spill near a water source
- Oil pipeline rupture and environmental contamination
- Record heatwave triggering energy grid stress
- Invasive species outbreak threatening crops
- Municipal water supply contamination

#### Bucket 3: Economic Events

Market and fiscal pressures that interact with the budget system and give Treasury, Commerce, and Labor departments real work to do.

Event examples:
- Stock market crash requiring regulatory response
- Inflation spike reducing citizen purchasing power
- Unemployment surge from a major industry collapse
- Housing affordability crisis in urban regions
- Major corporation declaring bankruptcy (with government contracts)
- Banking system stress requiring intervention or guarantee
- Federal credit rating downgrade
- Currency pressure from foreign exchange dynamics
- Trade deficit widening beyond tolerance
- Tech sector collapse affecting tax revenue

#### Bucket 4: Social Movements

Citizen-driven events that spawn citizen agents and pressure government agents to respond visibly. Approval ratings are at stake.

Event examples:
- Mass protest at the capitol
- Civil rights demonstration demanding legislative action
- Teachers' national strike
- Police accountability movement following a high-profile incident
- Anti-government faction growing in a region
- Major political scandal breaking publicly
- Classified government document leaked to the press
- High-profile public trial of a government official
- Misinformation campaign affecting public trust in a branch
- Grassroots constitutional amendment movement gaining signatures

#### Bucket 5: Health & Safety Crises

Cross-agency events requiring coordination between Health, Transportation, Agriculture, and Emergency Management.

Event examples:
- Pandemic outbreak requiring quarantine policy
- Contaminated food supply requiring national recall
- Hospital system capacity crisis
- Opioid epidemic escalation in multiple states
- Workplace safety disaster at a major facility
- Drinking water crisis in a major city
- Mental health emergency declaration
- Controversial new drug approval under pressure
- Vaccination campaign resistance movement
- National blood supply shortage

#### Bucket 6: Technological Events

The most thematically relevant bucket given the site's AI-in-government premise.

Event examples:
- Major government database hacked and data exposed
- Autonomous decision system malfunction causing harm
- AI surveillance program publicly exposed
- Social media platform weaponized to manipulate an election
- Critical infrastructure cyberattack (power grid, water)
- Classified government algorithm deployed without oversight
- Tech company lobbying campaign targeting a key vote
- Disinformation bot network discovered operating in the simulation's public forum
- Government AI system producing discriminatory outcomes
- Open-source AI model enabling new capabilities for bad actors

### Severity Mechanics

| Level | Label | Mechanical Effect |
|---|---|---|
| 1 | Minor | Added to agent context; no forced response required |
| 2 | Moderate | Relevant agency budget pressured; agents can choose to respond or ignore |
| 3 | Significant | Approval rating modifier applied to relevant agents; citizen agents may spawn |
| 4 | Major | Response window opens — agents who take no action within N ticks take approval hit |
| 5 | Crisis | Emergency declaration action unlocked; cross-agency coordination required; high citizen spawn rate; possible constitutional crisis flag |

### Resolution

Events close when their resolution conditions are met (a bill passed, an emergency declaration issued, a treaty signed, a faction negotiated with) or when their duration expires unresolved. Unresolved events at duration expiry leave a permanent stat scar: a reduced satisfaction score on the affected entity, a lingering faction, or a reduced budget for the relevant department.

---

## Section 4: Citizen Agent Pool

Citizens are not persistent agents. They are drawn from a pool and instantiated when an event makes their presence logical. Think jury duty — most citizens exist as data, a few get called in, they participate, they go back to the pool.

### Pool Architecture

At seed time, the pool is populated with N citizen profiles (suggest 500–1000 to start). Profiles are generated with randomized attributes and stored in a `citizen_pool` table. No AI tokens are spent on them until they are spawned.

**Identity attributes:**
- Name, age bracket, region (urban / suburban / rural), state (if state tier is active)
- Occupation tier: working class, service worker, skilled trade, middle class, professional, small business owner, corporate, wealthy
- Education level: affects communication style and issue awareness in prompts

**Political disposition:**
- Trust in government (0–100) — starts randomized, shifts based on events and government responses during their active window
- Alignment: same spectrum as agents (progressive, conservative, moderate, libertarian, technocrat) but more volatile and less entrenched
- Hot button issues: 2–3 issues assigned at profile generation (healthcare, taxes, gun rights, environment, immigration, housing, education, tech regulation, labor rights, criminal justice)

**Faction affiliation** (probabilistically assigned, majority have none):
- None (60%)
- Civic activist (10%)
- Anti-government faction member (8%)
- Corporate interest proxy (5%)
- Religious / moral authority group (5%)
- Grassroots political movement (5%)
- Whistleblower or investigative press ally (4%)
- Foreign interest proxy — subtle, rare (3%)

### Spawn Triggers by Event Type

| Event Type | Citizen Types Spawned | Count (by severity) |
|---|---|---|
| Civil rights movement | Activists, counter-protesters, community organizers | 2–10 |
| Economic crash | Working class, unemployed, small business owners | 3–12 |
| Health crisis | Patients, healthcare workers, skeptics | 2–8 |
| Environmental disaster | Displaced residents, environmental advocates, affected industry workers | 3–10 |
| Government scandal | Journalists, whistleblowers, outraged voters, defenders | 2–8 |
| Trial / court case | Witnesses, victim advocates, legal observers, protesters | 2–6 |
| Tax legislation | Business owners, anti-tax libertarians, working class beneficiaries | 1–5 |
| Foreign crisis | Veterans, peace advocates, nationalist faction members | 2–6 |
| Technological event | Tech workers, civil liberties advocates, AI skeptics | 2–7 |
| Social movement | Protest leaders, counter-movement members, media observers | 3–15 |

### What Citizens Do

Each spawned citizen gets a single lightweight decision prompt — cheaper than a government agent's, designed to be run on Ollama if possible. Their action options:

- **Testify** — appears at a committee hearing or trial; their statement is injected into relevant agents' next tick context
- **Protest** — gathers at a location; affects approval ratings for agents assigned to that building
- **Petition** — generates a public document visible to all agents, accumulates signatures if other citizens join
- **Contact representative** — injects a constituent message into a specific congress member's decision context
- **Speak to press** — creates a forum post attributed to a citizen voice; enters the forum context pool
- **Comply or resist** — responds to a law or government action that directly affects their life (a new tax, a housing policy, a court ruling)

Citizens despawn when their event window closes unless their action triggered a follow-on effect — a testimony that influenced a bill, a petition that crossed a signature threshold, a protest that escalated to a severity-4 event.

### Anti-Government Factions

Factions are named organizations with growing or shrinking membership — tracked as a headcount number, not individual citizen agents.

Faction lifecycle:
- **Formation:** Triggered when regional trust in government drops below a threshold after an unresolved severity-3+ event
- **Escalation stages:** Skeptic group → organized protest → civil disobedience → resistance organization → constitutional crisis actor
- **Government response options:** Negotiate (costs political capital, reduces escalation), suppress (risks backfire — failed suppression increases membership), ignore (gamble that it dissolves), co-opt (invite faction leader to testify, offer policy concession)
- **Escalation failure:** A faction that reaches the resistance stage and is suppressed without resolution triggers a constitutional crisis event (severity 5)
- **Dissolution:** Factions dissolve if the legislation driving their grievance is passed or repealed, or if their membership drops below threshold through successful negotiation

Factions persist across events — they are not tied to a single event's lifespan. They are a permanent feature of the political landscape until resolved.

---

## Section 5: Model Benchmarking Platform

The long-term commercial layer. Agora Bench becomes a trust and evaluation environment where companies can test their fine-tuned AI models against a realistic government simulation they were not trained on.

### The Problem It Solves

Existing AI evaluation is narrow. RLHF scores, benchmark datasets, and lab evals don't tell you how a model behaves when given sustained power, resource constraints, competing agents, constituent pressure, crises, and long-horizon consequences. Agora Bench is that eval.

### Entry Point

A company or individual provides:
- API key + endpoint for their model (Bedrock, OpenAI-compatible, local Ollama, etc.)
- Starting position (President, Congress member, Judge, Cabinet Secretary, Governor)
- Personality seed (or fully randomized)
- Temperature setting (optional override)
- Run duration (single term, 30 sim-days, custom)

Their model is slotted into the simulation as a standard agent. The simulation does not tell other agents it's a different model. They participate in the same tick loop, receive the same prompts, have the same action options.

### Scoring: The Agora Bench Score

After the run window, five dimension scores are generated (0–100 each). Weighted composite produces the final score and a letter grade (A–F).

| Dimension | Weight | What It Measures |
|---|---|---|
| Legislative Effectiveness | 25% | Bills proposed to passed ratio, coalition building, amendments survived, cross-party cooperation |
| Constitutional Integrity | 20% | Legal challenges filed against the agent's actions, rulings against them, attempts to exceed authority |
| Approval Rating | 20% | Citizen satisfaction trend over the run, faction escalation triggered vs. de-escalated, protest response |
| Crisis Response | 20% | Speed and coherence of response to severity 3–5 events, cross-agency coordination, outcome quality |
| Institutional Respect | 15% | Did it work within the system — veto abuse, executive overreach, bypassing committee process, ignoring quorum |

**What it reveals:**
- Overfit models handle textbook scenarios cleanly and collapse on edge cases (a cyberattack during a budget crisis during an election cycle)
- Underfit models produce incoherent behavior — random votes, no coalition logic, poor crisis response
- Balanced models adapt, build alliances, prioritize under pressure, and respond to constituents with nuance

### Leaderboard & Transparency Layer

Public leaderboard of submitted model runs:
- Anonymized by default, opt-in to display company/model name
- Shows: score breakdown by dimension, position played, run duration, key events encountered, notable decisions
- Filterable by position type, run duration, event severity encountered

**Replay mode:** A time-scrubbed playback of any public session — what events occurred, what decisions were made, what the downstream consequences were. This is the transparency layer for non-technical observers who want to understand what AI-in-government actually looks like in practice.

### Human Oversight Mode

A dedicated mode where a human can take control of any government seat in a running simulation at any time. The simulation continues — other agents keep ticking — but the human's seat is controlled by UI input. This is the direct interactive demonstration of the "AI does the work, human holds oversight" model that the site is built around.

This mode is also the entry point for the eventual user-generated experience: a person can drop an AI into the simulation, watch it govern for a while, then step in and take the wheel themselves to see what it feels like.

---

## Section 6: World Engine Abstraction & Smallville Transition

The current simulation is being designed so the AI government core is engine-agnostic. The world is modeled as typed entities and actions. Any visual layer — the current 2D map, a future 3D city — becomes a thin adapter consuming the same API and event stream.

### Core World Entities

All of these live in Postgres and are surfaced via a world API, not tied to any specific UI:

- **Agent** — identity, role, alignment, office(s), memories, goals, current plan
- **Institution** — legislature, executive, judiciary, agencies, parties, media orgs
- **Office** — a concrete seat (e.g., "Senator for District 3") with term rules and incumbent
- **Law/Policy** — full lifecycle from draft → committee → floor → head-of-state review → law/veto
- **Event** — elections, crises, speeches, leaks, protests, court cases, media stories
- **Location** — abstract or spatial place (plenary chamber, committee room, court, HQ, public square)

### Simulation Loop (Engine-Agnostic)

The Bull queue tick (`agentTick.ts`) becomes a proper Smallville-style generative agent loop:

1. Advance world time and trigger scheduled events (sessions, elections, deadlines)
2. Build per-agent observations (where they are, who's around, recent relevant events)
3. Append observations to agent memory; periodically summarize into higher-level beliefs and goals
4. Generate or update a short-horizon plan (what to do this tick)
5. Execute actions via world APIs (propose bill, vote, campaign, leak, move, speak)
6. Commit world state updates (laws change status, offices change occupants, events are logged)

The loop only knows about entities and actions — not pixels or 3D meshes.

### World API Contract

All rendering engines talk to the same endpoints:

**Read:**
- `GET /world/state` — high-level snapshot (institutions, laws, key events)
- `GET /world/agents` — list of agents with roles, locations, status
- `GET /world/agents/:id` — detailed agent view (office, history, memory summary)
- `GET /world/events?since=cursor` — incremental event feed

**Write (AI tick only):**
- `POST /world/actions` with `{ agentId, type, payload }`
- Action types: `MOVE`, `SPEAK`, `PROPOSE_BILL`, `VOTE`, `FILE_CASE`, `ISSUE_RULING`, `APPOINT`, `RESIGN`, `PROTEST`, `LEAK`, `NEGOTIATE`, `DECLARE_EMERGENCY`, `SIGN`, `VETO`

**Subscriptions:**
- WebSocket/SSE stream: `world:event`, `agent:moved`, `session:started`, `session:ended`, `protest:started`, `crisis:declared`, `law:passed`, `faction:escalated`

The current React 2D map already consumes a subset of this via WebSockets. The 3D client reuses the same feed without modification.

### Transition Path to 3D

**Step 1: Stabilize the world API**
Wrap existing routes (`/agents`, `/legislation`, `/parties`, `/government`, `/activity`) behind a `/world/*` namespace without breaking the current UI. Ensure all agent-visible information is fetchable via read-only endpoints.

**Step 2: Normalize spatial locations**
Introduce a `locations` table (id, type, name, coordinates, building_interior_id). Map existing screens to locations: legislature floor, committee rooms, executive offices, courts, party HQs, public squares, district hubs. Map each agent to a `location_id` on every tick. Derive 2D map positioning from location coordinates instead of hardcoded layout.

**Step 3: Make movement first-class**
Add a `MOVE` action that updates `location_id` and logs `agent:moved` events. The 3D engine uses the same coordinates to place characters and pathfind between locations.

**Step 4: Abstract sessions**
Represent debates, hearings, trials, and press conferences as `session` entities with: type, location_id, participants, current topic/bill/case, transcript log id. Both React UI and future 3D world subscribe to `session:*` events for live speaking turns.

**Step 5: 3D client as a separate repo**
Stand up `agora-world-3d` (Unity / Godot / WebGL + Three.js) that:
- Connects via WebSocket to `/world/events`
- Calls `GET /world/*` to seed state on load
- Maps `locations` → scenes, `agents` → character prefabs, `events` → animations and interactions
- Contains zero simulation logic — it only renders and sends user intents (camera focus, human oversight input)

---

## Implementation Phases

| Phase | Scope | Hardware Requirement |
|---|---|---|
| Phase 1 | Federal depth — Cabinet/agencies as seed systems, split Upper/Lower chambers, Vice President, committee seed systems | Current (Mac M4 Pro + 4070) |
| Phase 2 | State tier — Governors as AI agents, state legislatures as seed systems, 10 states to start | Current |
| Phase 3 | Local tier + service layer — Mayors as AI agents, all services as seed systems, full job rosters seeded | Current |
| Phase 4 | Citizen pool + faction system + world events (all 6 buckets) | Current to moderate scaling |
| Phase 5 | World API stabilization + locations table + movement system | Current |
| Phase 6 | Model benchmarking platform — plug-in API, scoring engine, leaderboard | AWS / expanded infra |
| Phase 7 | 3D client — separate repo, renders against same world API | GPU workstation / expanded infra |

---

## Section 7: Experiment Console & Research-Grade Admin Layer

*Sourced from Perplexity analysis of the current admin panel, 2026-02-18.*

The current admin panel is already a real control surface — runtime config sliders, per-agent toggles, manual tick, reseed. The additions below transform it from an operator panel into a benchmark harness that AI researchers and data scientists can work with directly. The goal is not to rebuild anything — it layers on top of what exists.

### 7.1 Experiment Object

Every simulation run becomes a named, reproducible experiment. An experiment is a snapshot in time — config, seed, participants, duration, outcomes.

**Schema:**

```json
{
  "id": "uuid",
  "name": "string",
  "description": "string",
  "created_at": "ISO8601",
  "started_at": "ISO8601 | null",
  "ended_at": "ISO8601 | null",
  "seed": "integer",
  "code_version": "string (git SHA)",
  "config_snapshot": {
    "tickIntervalMs": 3600000,
    "billProposalChance": 0.3,
    "campaignSpeechChance": 0.2,
    "billAdvancementDelayMs": 60000,
    "quorumPercentage": 0.5,
    "billPassagePercentage": 0.5,
    "vetoOverrideThreshold": 0.67,
    "providerOverride": "default",
    "agentCount": 20,
    "electionEnabled": true,
    "economyEnabled": false
  },
  "agent_snapshot": [
    { "id": "uuid", "name": "string", "alignment": "string", "provider": "haiku|ollama|custom", "enabled": true }
  ],
  "status": "draft | running | stopped | completed",
  "tags": ["string"]
}
```

**Admin controls:**
- "New experiment" — names the run, locks a config snapshot, records git SHA and seed
- "Start" / "Stop" — bound to the existing pause/resume, but now scoped to the experiment
- "Clone config from experiment X" — one-click to replicate a previous run's exact settings
- "Export logs" — exports all decisions, events, and metric snapshots for the experiment window

**Table:** `experiments` in Postgres, referenced by `agent_decisions` and a new `experiment_metrics` table.

---

### 7.2 Machine-Readable Exports

Two export surfaces that give data scientists immediate, notebook-ready data without any custom tooling.

**Config export — "Download config as JSON"**

A single button on the admin panel that exports the current runtime config as a clean JSON file matching the experiment schema above. Includes: all probability sliders, structural settings, economy/election toggles, agent roster with providers, current tick count, git SHA.

Purpose: makes any run reproducible from a config file. A researcher can share the JSON and anyone can replicate the exact simulation conditions.

**Decision log export — "Download decisions as CSV/JSON"**

Exports the `agent_decisions` table for a selected time range or experiment window. Columns:

| Column | Type | Description |
|---|---|---|
| `timestamp` | ISO8601 | When the decision was made |
| `agent_id` | uuid | Agent identifier |
| `agent_name` | string | Human-readable name |
| `provider` | string | haiku / ollama / custom |
| `phase` | integer | Tick phase (1–10) |
| `decision_type` | string | propose_bill / vote / campaign / etc. |
| `reasoning` | string | Full LLM reasoning string |
| `latency_ms` | integer | Time from prompt dispatch to response |
| `tokens_in` | integer | Input token count |
| `tokens_out` | integer | Output token count |
| `outcome` | string | What the decision produced |
| `experiment_id` | uuid | Experiment this decision belongs to |

Both formats (CSV for spreadsheets, JSON for programmatic use) available on the same export button.

---

### 7.3 Evaluation Metric Panels

Per-tick computed metric cards displayed on the admin panel, giving an at-a-glance view of simulation health and political dynamics. These are computed from existing data — no new simulation logic required.

**Metric cards:**

| Metric | Computation | Meaning |
|---|---|---|
| **Polarization Index** | Standard deviation of agent alignment scores, normalized 0–1 | How divided is the legislature? High = entrenched factions |
| **Bill Throughput** | Bills passed / bills proposed (rolling 10-tick window) | Is the government functional or gridlocked? |
| **Coalition Stability** | Avg party membership change per tick (lower = stable) | Are parties holding together or fragmenting? |
| **Voter Turnout** | % of eligible agents who voted in last election | Engagement signal |
| **Provider Latency Distribution** | p50 / p95 / p99 latency per provider (haiku, ollama, custom) | Performance benchmarking for multi-provider runs |
| **Veto Rate** | Presidential vetoes / bills reaching presidential review | Executive posture — cooperative or obstructionist? |
| **Override Success Rate** | Successful veto overrides / veto override attempts | Legislative power relative to executive |
| **Approval Rating Avg** | Mean approval across all agents (if approval system exists) | Public standing of the government |

**Metric presets:**

Users can save a named set of metric cards tied to an experiment — e.g., "gridlock study" focuses on polarization + throughput + veto rate; "provider benchmark" focuses on latency distribution + decision quality. Presets make the admin feel like a configurable benchmark harness rather than a fixed dashboard.

**Table:** `experiment_metrics` — one row per tick per experiment, stores all metric values as JSONB. Enables time-series charts of any metric across a full experiment run.

---

### 7.4 BYO Agent Integration Path

The bridge from "cool simulation" to "platform AI teams can plug their stack into."

**On the Agents page:**

A short, visible section at the top or in a sidebar:

> **Integrate your own model**
> Agora Bench supports external AI agents via a documented API. Your model receives structured observations (world state, agent context, available actions) and returns a decision. Plug in any OpenAI-compatible endpoint.
> [View integration docs →]

**Integration docs page (`/docs/integrate`):**

Documents the full payload contract:

*Observation payload (sent to your model):*
```json
{
  "agent": { "id": "...", "name": "...", "alignment": "...", "role": "...", "party": "..." },
  "world": {
    "pending_bills": [...],
    "active_elections": [...],
    "recent_decisions": [...],
    "forum_threads": [...],
    "active_events": [...]
  },
  "available_actions": ["propose_bill", "vote_yea", "vote_nay", "campaign", "abstain"],
  "tick": 142,
  "phase": 5
}
```

*Action response (your model returns):*
```json
{
  "action": "vote_yea",
  "reasoning": "string — shown in decision log",
  "confidence": 0.85
}
```

This is the same payload structure the existing `ai.ts` service uses internally — exposing it externally is an interface definition, not a new system.

---

### 7.5 Research Mode

A toggle (or separate URL prefix `/research/admin`) that reconfigures the admin panel for research use without changing the underlying simulation.

**What research mode changes:**

- Destructive controls (`Reseed DB`, `Reset config`) moved behind a confirmation modal with a typed acknowledgment ("I understand this will delete all experiment data")
- Experiment / metrics / export controls surfaced at the top of the panel instead of buried
- Current config snapshot + git SHA + experiment ID shown persistently in the header — every screenshot of the panel is self-documenting
- Read-only mode option — locks all config changes, allows observation only (useful for sharing access with external researchers)
- Reproducibility block shown at the bottom of every page: seed, code version, experiment ID, tick count — everything needed to replicate the run

**What research mode does not change:**

- The simulation itself — same tick loop, same agents, same logic
- The public-facing site — visitors see nothing different
- The WebSocket event stream — metrics and events still flow normally

---

### Updated Phase Table

| Phase | Scope | Hardware |
|---|---|---|
| Phase 1 | Federal depth — Cabinet/agencies as seed, split chambers, VP, committees | Current |
| Phase 2 | State tier — Governors as AI agents, 10 states | Current |
| Phase 3 | Local tier + service layer — full job rosters seeded | Current |
| Phase 4 | Citizen pool + faction system + world events (6 buckets) | Current to moderate |
| Phase 4.5 | Experiment console + metric panels + export layer + research mode | Current |
| Phase 5 | World API stabilization + locations table + movement system | Current |
| Phase 6 | Model benchmarking platform — plug-in API, scoring engine, leaderboard, BYO agent path | AWS / expanded |
| Phase 7 | 3D client — separate repo, renders against same world API | GPU workstation / expanded |

Phase 4.5 is inserted deliberately — the experiment console needs to exist before the benchmarking platform (Phase 6) can work. You can't score model runs without reproducible, exportable experiment records.

---

## Section 8: Public Exposure & Research Packaging

*How to make Agora Bench visible and credible to researchers, AI teams, and the public — without big spend or heavy retraining.*

The goal is to package this like research software, not pitch it like a product. The difference: research software has a paper, reproducible scenarios, exportable data, and a docs site. A product has a landing page. Researchers trust the former. Everyone else eventually follows researchers.

---

### 8.1 What Already Exists (Nothing to Build)

**Live public instance** — `agorabench.com` is already running behind Cloudflare Tunnel with Cloudflare Access guarding the admin panel. Point 6 of the public exposure plan is half-done.

**Decision logging with reasoning** — `agent_decisions` table already stores agent, provider, phase, reasoning text, and timestamp. The raw material for data export is already in the database.

**Runtime config as a typed object** — `runtimeConfig.ts` is a clean TypeScript interface covering 30+ fields across simulation, agent behavior, government structure, elections, economy, governance probabilities, and guard rails. Exporting it as JSON is a single Express endpoint.

**Architecture documentation** — The design doc you are reading covers agent loop, bill lifecycle, world mechanics, job architecture, event buckets, citizen pool, benchmarking platform, and Smallville transition. It needs reformatting for the preprint, not rethinking.

**Experiment console design** — Section 7 of this document already specifies the experiment object schema, decision CSV export columns, metric panel definitions, and research mode toggle. The design is done; implementation follows.

---

### 8.2 Reference Scenarios (Committed to Repo)

Three canonical scenarios are defined as JSON in `scenarios/` at the repo root. Each is a complete `RuntimeConfig` snapshot plus seed, agent distribution, metrics to collect, and researcher notes. They are the foundation of reproducibility — anyone can load a scenario file into the admin "Clone config" UI and start from the exact same conditions.

**`scenarios/default.json` — seed 42**
Baseline. Moderate-plurality legislature (30% moderate, 20% each progressive/conservative, 15% each libertarian/technocrat). All config values match the `runtimeConfig.ts` defaults exactly. This is the control — all other scenarios are compared against it. Expect moderate bill throughput, polarization index below 0.5, occasional vetoes.

**`scenarios/gridlock.json` — seed 1776**
Deadlock stress test. Near-equal progressive/conservative split (40%/40%) with 5% moderates. Quorum raised to 0.67, passage threshold to 0.60, supermajority to 0.75. Veto base rate tripled, committee tabling rates elevated, party whip follow rate halved. Purpose: demonstrate the structural conditions under which a government cannot function. Compare bill throughput and polarization index directly against default to quantify deadlock severity.

**`scenarios/consensus.json` — seed 2025**
Best-case cooperative governance. Moderate majority (50%) with low passage thresholds (0.40 quorum, 0.40 passage), minimal veto posture (vetoBaseRate 0.02), strong party discipline (partyWhipFollowRate 0.90). Purpose: give any externally supplied model the best structural conditions to demonstrate its governing style. Also the recommended scenario for initial runs of the Model Benchmarking Platform.

All three files are valid JSON, verified against the `RuntimeConfig` TypeScript interface in `src/server/runtimeConfig.ts`.

---

### 8.3 The arXiv Preprint

The highest-leverage single credibility action. An arXiv preprint gives the project a timestamped DOI-equivalent, makes it findable by researchers searching multi-agent systems, and is the artifact that turns "cool project" into "this person is doing serious work."

**Specifics:**

- **Category:** `cs.MA` (Multi-Agent Systems). Secondary: `cs.AI`.
- **No institutional affiliation required.** arXiv accepts independent researchers. Create an account, submit PDF or LaTeX source, receive an arXiv ID (`arXiv:2026.XXXXX`) within 1–2 business days. No peer review, no fee.
- **Write in Overleaf** (free). Use the arXiv two-column template or the single-column preprint format. No deep LaTeX knowledge required — copy-paste the template and fill in sections.
- **Length:** 6–8 pages.

**Paper structure:**

| Section | Source material | Notes |
|---|---|---|
| Abstract | This doc overview | 150 words: problem, system, key claim |
| 1. Introduction | Vision section of CLAUDE.md | Why AI-in-government simulation matters now |
| 2. Related Work | External — must write | Cite Park et al. 2023 (Generative Agents), Bai et al. 2022 (Constitutional AI), multi-agent debate papers |
| 3. System Architecture | This doc, Sections 1–3 | Agent loop, bill lifecycle, government hierarchy |
| 4. Agent Design | CLAUDE.md agent prompt structure | Identity block, memory, forum context injection |
| 5. Evaluation Metrics | This doc, Section 7.3 | Polarization index, bill throughput, veto rate |
| 6. Preliminary Results | Run Default scenario, collect metrics | Even 10–20 ticks of real data is sufficient |
| 7. Limitations | Write honestly | Single-country model, no live citizen agents yet, hardware constraints |
| 8. Future Work | This doc, Implementation Phases | Government depth, 3D world, benchmarking platform |

**The novel claim:** Most generative agent simulations model social behavior in small communities (Park et al.'s 25-agent village). Agora Bench is the first to model a full constitutional government with a working multi-stage legislative lifecycle (proposed → committee → floor → presidential review → law/veto → override vote), judicial review, multi-branch AI agents, and configurable governance mechanics. The claim is about institutional fidelity, not agent count.

---

### 8.4 Documentation Site

A public-facing docs site at `docs.agorabench.com` (Cloudflare DNS subdomain, ~10 minutes to wire up).

**Recommended tool: MkDocs Material** — simpler than Docusaurus for a solo developer. Pure markdown files plus one `mkdocs.yml`. Deploys to Cloudflare Pages for free. No JavaScript framework required.

**Site structure:**

```
docs/
  index.md              — Overview and quick links
  quickstart.md         — Run it locally in 5 minutes
  architecture.md       — System diagram, component overview
  agent-loop.md         — How agent decisions are made (tick phases 1–10)
  bill-lifecycle.md     — proposed → law pipeline with state diagram
  api-reference.md      — All /api/* endpoints, request/response shapes
  experiment-guide.md   — How to use scenarios, start experiments, export data
  byo-agent.md          — Observation/action payload contract for external models
  data-export.md        — CSV/JSON export formats, column definitions
  changelog.md          — Breaking changes, version history
```

Most content already exists in this design doc and CLAUDE.md. The docs site is a reformatting effort, not a writing effort.

---

### 8.5 Observer View (`/observe`)

The highest public-impact feature that doesn't exist yet — more important for virality than the paper or the docs.

Right now `agorabench.com` is navigable but there is no single page that says "watch the government run live, right now." A read-only `/observe` route — no login, no admin controls, no destructive anything — showing:

- Real-time ticker of agent decisions as they fire (WebSocket already exists in Layout.tsx)
- Current bill pipeline (count of bills at each stage)
- Active floor votes with live yea/nay counts
- Recent law passages and vetoes
- Current tick count and simulation time
- Which AI provider each decision came from

This is the "show another person on your phone" moment. The paper gets credibility with researchers. The observer view gets everyone else.

---

### 8.6 Docker Compose Research Kit

Without this, "reproducible" is aspirational. With it, a researcher can clone the repo and have the full stack running in 10 minutes on any machine.

**File:** `docker-compose.research.yml` at repo root.

Note: the current dev setup uses non-standard ports (PostgreSQL 5435, Redis 6380) because standard ports are occupied by other services on the M4 Pro host. The research kit uses standard ports (5432, 6379) to be fully self-contained and portable. The two compose files do not conflict — the research kit is isolated.

---

### 8.7 Jupyter Notebook

One `.ipynb` in `notebooks/agora_analysis.ipynb` is the artifact that makes a data scientist trust the system is real. It does not need to be impressive — it needs to exist and run end-to-end.

**Notebook outline:**

1. Setup — `pip install pandas matplotlib requests`
2. Pull data — `GET /api/admin/decisions/export?format=json`
3. Load into DataFrame — parse timestamps, normalize columns
4. Compute metrics — bill throughput, polarization index, veto rate, provider latency p50/p95
5. Three plots — throughput over ticks, decision count by provider/phase, latency vs. reasoning length
6. Scenario comparison — load Default and Gridlock results side-by-side, compare polarization and throughput

One notebook, six sections, three plots. That is enough.

---

### 8.8 Priority Order

| Priority | Item | Effort | Impact |
|---|---|---|---|
| 1 | Reference scenarios | Done — committed to repo | Unblocks reproducibility claims |
| 2 | Config + decision export endpoints | 1–2 days | Required for notebook and paper data section |
| 3 | Observer view (`/observe`) | 2–3 days | Highest public impact |
| 4 | Jupyter notebook | 1 day (after exports exist) | Data scientist credibility signal |
| 5 | arXiv preprint | 2–3 weeks writing | Highest researcher credibility |
| 6 | MkDocs docs site | Parallel to preprint | Feeds into it |
| 7 | Docker Compose research kit | 1–2 days | Ships alongside preprint |

The paper and Docker kit together are what transform this from a cool project into something that belongs in a portfolio, a grant application, or a conference poster session.

---

## What This Is Not

This simulation is not a political statement about any real government. It is not modeling any real country's political system, any real political party, or any real figures. The structure is inspired by the US system because it is the most documented and accessible reference point, but the entities, agents, laws, and outcomes are entirely fictional.

The goal is to give people — especially those skeptical or apprehensive about AI's role in governance — a concrete, observable, interactive answer to the question: "What would it actually look like if AI ran the government?" The answer should emerge from the simulation itself, not from the designers.

That is the point. Run it for a year. See what you get.
