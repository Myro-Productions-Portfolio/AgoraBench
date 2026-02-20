# Agora Bench — Long-Term Vision

**Written:** 2026-02-18
**Status:** Planning note — not yet in development

---

## What This Becomes

The current Agora Bench simulation is the foundation and proof-of-concept. The long-term vision is a **fully realized AI government sandbox** — every tier of government work represented, every role staffed by an autonomous AI agent, the entire system running as a living training environment for AI governance.

This is not a website feature. This is a separate project, forked from the current codebase, that never merges back until the direction is fully validated.

---

## The Fork Plan

When ready to build the full simulation:
- Clone the current Agora Bench repo into a new project (e.g. `Agora-Bench-Sim` or `AgoraBench-Full`)
- The two projects diverge permanently from that point
- Current site (`agorabench.com`) continues as the fun/demo/portfolio side
- The fork becomes the serious AI training and evaluation platform
- They only merge if and when one direction is confirmed dominant

**Why fork instead of extend:**
The scale of change — new agent architecture, Ollama NPC layer, job system, inter-agency communication, training data pipeline — would fundamentally restructure the codebase. Trying to evolve the current site into this would break what's already working.

---

## The Full Simulation Architecture

### Layer 1: The World (NPCs)
Persistent population of AI citizens and entities, hosted via Ollama (cheap, local, fast):
- Citizens: file permits, pay taxes, complain, run businesses, commit fraud
- Business owners: zoning disputes, license renewals, compliance issues
- Bad actors: fraud attempts, corruption, social engineering
- Rule-based agents for routine activity; occasional LLM curveballs for unpredictability
- The world reacts to government decisions over time (approve too fast → scammers flood in; too slow → complaints rise)

### Layer 2: The Government (AI workers)
Every tier represented — not metaphorical, modeled after real government structure:
- **Federal:** Congress, Senate, Executive, Judiciary, Cabinet departments
- **State:** Governor, legislature, state agencies
- **Municipal:** Mayor, city council, planning commissions, public works
- **Worker tier:** Clerks, inspectors, case managers, auditors, compliance officers, HR, IT, legal

Each role has:
- A defined job description and jurisdiction
- Access only to tools/databases appropriate for their role
- A reporting structure (who they escalate to, who manages them)
- Performance metrics tied to real government KPIs

### Layer 3: The Orchestrator
The AI orchestrator manages the simulation at the system level:
- Routes work items to appropriate government workers
- Detects bottlenecks, escalations, failures
- Generates the NPC world events that stress-test the government
- Produces training data and evaluation scores
- Manages inter-agency communication and coordination

### Layer 4: The Human-Readable Layer (the website)
The website's job is to make the simulation legible to humans:
- Translate AI decisions into plain language
- Show process flows: "This permit went from clerk → inspector → city council → approved"
- Surface disagreements, negotiations, coalition-building
- Explain *why* the AI made each decision, in terms a human policy maker would understand
- Dashboard: live government status, budget, public sentiment, active cases

This is critical: the AI government would be a black box without this layer. The website is the transparency interface.

---

## The Human Element

This simulation is explicitly designed for a 30-40 year human-AI coexistence horizon.

AI doesn't govern instead of humans. It governs *with* humans, under human oversight, in systems humans understand. The simulation must:
- Include human-in-the-loop escalation points
- Model public sentiment and citizen trust as real metrics
- Demonstrate that AI workers can be held accountable (audit trails, decision logs)
- Build in explainability at every layer — not as an afterthought

The training value is precisely this: teaching AI systems how to operate within human institutional constraints, not around them.

---

## What AI Learns Here

- How to govern under incomplete information
- How to cooperate with other AI agents that have different priorities and incentives
- How to escalate appropriately vs. decide autonomously
- How to communicate with non-expert humans (confused citizens, angry constituents)
- How to detect and flag adversarial actors (fraud, corruption)
- How to manage documentation, workflows, and institutional memory
- How to operate within policy constraints even when bending them would be faster

These are the exact skills that map to enterprise AI deployment in complex organizations — not just government. Any large institution (hospital, logistics company, bank) has the same coordination problems.

---

## Portfolio Positioning

| Project | Domain | Demonstrates |
|---|---|---|
| ShowCore | Marketplace | Full-stack product development |
| ATLAS | Computer vision | ML pipeline, real-time inference |
| Agora Bench (current) | Civic simulation | AI orchestration, WebSocket, auth, production deployment |
| Agora Bench (fork) | AI training infrastructure | Autonomous agent coordination at scale, evaluation systems, governance AI |

The fork is the capstone. It's the project that directly maps to roles in AI infrastructure, civic tech, government contracting, and enterprise AI deployment.

---

## Current Priority

**Keep building the current simulation first.**

The current site needs to be a polished, feature-complete political simulation before the fork makes sense. It also continues to serve as:
- Portfolio demo of AI-orchestrated web development
- Public-facing explainer for the fork's concepts
- Proof that the underlying architecture (agents, legislation lifecycle, elections, forum) works

The fork is the next chapter. Not yet.

---

## When to Fork

Trigger conditions (all three must be true):
1. Current simulation is demo-ready and publicly accessible
2. Core government simulation features are complete (approval ratings, economic layer, judicial branch, full agent job system)
3. Ollama NPC infrastructure is designed and ready to prototype

At that point: copy the repo, strip what doesn't belong, and build the full thing.
