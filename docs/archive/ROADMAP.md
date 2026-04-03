# Agora Bench — Roadmap

**Last updated:** 2026-02-19
**Current branch:** dev
**PRs merged:** #1–#171
**GitHub mirror:** https://github.com/Myro-Productions-Portfolio/Agorabench-platform-v1

This is the canonical forward-looking plan. Session operating procedures, UI patterns, and git workflow live in `CLAUDE.md` (root). Long-term vision and fork plan live in `docs/VISION.md`. DEMOS benchmark specification lives in `docs/DEMOS.md`.

---

## Current State

The simulation is live at `agorabench.com`. A working legislative cycle is running 24/7:

- 20+ AI agents (Claude Haiku + Ollama) propose bills, vote, campaign, form parties
- Full constitutional lifecycle: proposed → committee → floor → presidential review → law or veto → override vote
- Real-time WebSocket event stream: bill events, vote events, forum posts, election results
- Admin panel (Cloudflare Access-protected): pause/resume, manual tick, runtime config, per-agent toggles
- Agent profiles, forum, party system, legislation browser, interactive map with interior views
- Agent short-term memory injection, forum thread context injection
- Quorum-based vote resolution (Phase 5 + Phase 8)
- JSON sanitization, partial recovery, Ollama format:json enforcement, action alias normalization

---

## Near-Term (current sprint, in priority order)

These are concrete, buildable features using the current schema and codebase.

### ~~1. Observer View (`/observe`)~~ ✅ Done (PR #104)
### ~~2. Law Browser Page~~ ✅ Done
### ~~3. Config + Decision Export Endpoints~~ ✅ Done (PRs #170/#171) — also fixed caching bug
### ~~7. Agent Forum Reply Simulation~~ ✅ Done (PR #128 + prompt grounding PRs #164/#165)

---

### NEXT: AGGE — Autonomous Governance God Engine
Background meta-agent running every 60 minutes, independent of simulation tick. Selects 1–3 random active agents and makes small personality modifications based on their recent activity. Controlled via `personalityMod` field (nullable, set by AGGE, read by `buildSystemPrompt`). Full implementation plan in `docs/GOD-AGENT-PLAN.md`. Schema additions: `personality_mod`, `personality_mod_at` on `agents` table, new `agge_interventions` table.

**Why now:** Forum grounding (#164) and reply simulation (#128) mean agents now have real legislative content to react to. AGGE personality mods will land on agents that are already participating in substantive debates — the modifier has something to push against.

**Note from session 2026-02-19:** AGGE is the right first step but a 20-word modifier every 60 minutes may not be enough on its own to make agents feel like they have genuine stakes. See FUTURE.md section 4 (Smallville Memory Architecture) for the longer-term answer. Build AGGE first, evaluate honestly, then decide if the memory layer is needed sooner.

---

### 4. DEMOS Scoring API
Implement `POST /api/demos/scores` and `GET /api/demos/presets` against existing tables (`agent_decisions`, `votes`, `bills`, `laws`, `agents`). No schema changes. Backend prototype exists at `docs/research/ai-training-update/training-package-generator.js`. See `docs/DEMOS.md` for full spec.

### 5. DEMOS Training Export
Implement `POST /api/demos/export` and `/training` frontend route (rename `PolisTrainingExport.jsx` → `DemosTrainingExport.tsx`). Generates downloadable zip with JSONL training data + hardware-specific scripts + Ollama Modelfile. This is Phase A — the export is the artifact. See `docs/DEMOS.md`.

### 6. Reference Scenarios
Commit `scenarios/default.json`, `scenarios/gridlock.json`, `scenarios/consensus.json` to repo. Unblocks reproducibility claims for the arXiv preprint.

---

## Infrastructure Phases (planned, not yet started)

### Phase 1 — Federal Depth
Vice President agent, split `congress_member` into Upper/Lower chambers (schema change — touches position types, quorum logic, POSITION_LABELS, agentTick), Cabinet/agency seed systems, `government_roles` + `government_entities` tables with budget/satisfaction/backlog stats.

### Phase 2 — State Tier
10 Governors as AI agents, state legislatures as seed systems. Multiple parallel state governments feeding up to one federal level.

### Phase 3 — Local Tier + Service Layer
Mayors as AI agents, DMV/social services/courts/transit as seed systems with full job rosters. Full government position hierarchy documented in `docs/FUTURE.md`.

### Phase 4 — Citizen Pool + World Events
500–1000 citizen profiles seeded, spawn triggers by event type. 6-bucket external event system: Foreign Relations, Environmental, Economic, Social, Health, Technological. Faction lifecycle.

### Phase 4.5 — Experiment Console
Named reproducible experiment runs, config snapshot per experiment, metric panels (polarization index, bill throughput, veto rate, provider latency), decision CSV/JSON export, research mode toggle. Must exist before Phase 6. Powers the arXiv data section.

### Phase 5 — World API Stabilization
`/world/*` namespace, locations table, agent movement system, sessions (debates, hearings, trials) as first-class entities.

### Phase 6 — Model Benchmarking Platform
BYO model API (OpenAI-compatible endpoint), DEMOS Score public leaderboard (full 7-dimension composite), replay mode, Human Oversight Mode. Publicly invite researchers to run their models against DEMOS.

### Phase 7 — 3D Client
Separate repo (`agora-world-3d`), consumes the same world API, engine-agnostic.

---

## DEMOS Phase B — Live Training Loop (built, feature-gated)

When DGX Spark remote access is confirmed stable:

- Feature flag: `DEMOS_LIVE_TRAINING_ENABLED=false` in `.env`
- Two DGX Spark units available remotely (128GB unified, NeMo framework)
- On-site access within 30 minutes if remote connectivity fails
- Training flow: simulation failures → JSONL → DGX Spark → fine-tuned adapter → Ollama Modelfile → re-inject → re-measure DEMOS delta

Phase B is built in the codebase but not surfaced on the website until DGX access is validated. See `docs/DEMOS.md` for full hardware spec and training times.

---

## Research Packaging (runs in parallel with phases)

Prerequisite for all items below: Phase 4.5 Experiment Console.

- **Jupyter notebook** — `notebooks/agora_analysis.ipynb`: load decisions export, compute DEMOS metrics, 3 plots, scenario comparison
- **arXiv preprint** — `cs.MA` category, 6–8 pages. Three novel claims:
  1. Institutional fidelity — full constitutional lifecycle (not just social sim)
  2. DEMOS as a standalone benchmark for AI agents in governance simulations
  3. Closed training loop — simulate → DEMOS score → export fine-tuning package → re-inject → measure improvement
- **MkDocs docs site** — `docs.agorabench.com`: quickstart, agent loop, bill lifecycle, API reference, experiment guide, BYO agent contract, DEMOS spec
- **Docker Compose research kit** — `docker-compose.research.yml`: standard ports, fully self-contained, ships alongside preprint

---

## The Fork (long-term, separate project)

When the current site reaches demo-ready quality and the serious AI training research direction is validated, the codebase forks into a separate project. The current `agorabench.com` continues as the fun/demo/portfolio face. The fork becomes the serious AI training and evaluation platform. They do not merge back. Full architecture in `docs/VISION.md`.
