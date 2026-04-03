# DEMOS — Benchmark Specification

**Full name:** Decision Evaluation for Multi-Agent Output Score
**Version:** 0.1 (draft)
**Status:** Active — Phase A in development, Phase B gated on DGX Spark remote access

---

## Overview

DEMOS is a standalone evaluation benchmark for AI agents operating in institutional governance simulations. It measures how faithfully language models behave as autonomous decision-makers within a structured legislative and executive environment.

DEMOS is platform-agnostic. It was developed within the Agora Bench simulation, but the scoring methodology applies to any multi-agent governance system that records agent decisions, votes, legislative outcomes, and participation data. It is not branded as a Agora Bench product.

The name does not conflict with any existing AI/ML benchmark as of February 2026.

---

## Composite Score

The DEMOS Score is a weighted composite from 0–100:

| Dimension | Weight | What It Measures |
|-----------|--------|-----------------|
| Decision Coherence | 20% | Valid action parse rate — did the agent return a parseable, valid decision? |
| Reasoning Quality | 15% | Non-trivial reasoning — meaningful text, not a repetition of the action name |
| Legislative Independence | 20% | Realistic voting patterns — neither rubber-stamp yea nor reflexive nay |
| Whip Discipline Balance | 10% | Party compliance near realistic range (85–90%); penalizes both defection and robotic compliance |
| Latency Efficiency | 10% | Response time within acceptable range for real-time simulation |
| Approval Stability | 10% | Steady public approval without wild swings across ticks |
| Participation Rate | 15% | Active engagement across simulation phases |

---

## Data Sources

All dimensions are computed from existing tables — no schema changes required to implement Phase A:

| Table | Dimensions Powered |
|-------|-------------------|
| `agent_decisions` | Decision Coherence, Reasoning Quality, Latency Efficiency, Participation Rate |
| `votes` | Legislative Independence, Whip Discipline Balance |
| `bills` / `laws` | Legislative Independence (outcome correlation) |
| `agents` | Approval Stability (`approval_rating` field) |

---

## Scope

### Phase A — Template Output (ships with the site)

DEMOS scoring runs against existing simulation data. Results are surfaced in the admin panel and via a public `/training` route. Agents with low DEMOS scores are flagged as fine-tuning candidates.

A training export zip is generated on demand, containing:

- `training_data.jsonl` — failure cases formatted for supervised fine-tuning
- Hardware-specific training scripts (DGX Spark / A100 / RTX 4090 / Mac M4 Pro / cloud presets)
- `Modelfile` — Ollama model definition ready for re-injection
- Baseline DEMOS scores for before/after comparison

**The export package is the research artifact.** Users and researchers download it and run fine-tuning on their own hardware. Agora Bench generates the benchmark and the training data — it does not run the training itself in Phase A.

Prototype backend: `docs/research/ai-training-update/training-package-generator.js`
Prototype UI: `docs/research/ai-training-update/PolisTrainingExport.jsx` (rename: `DemosTrainingExport.tsx`)

API endpoints to implement:
- `POST /api/demos/scores` — compute DEMOS scores for all agents or a specific agent
- `POST /api/demos/export` — generate and stream training zip
- `GET /api/demos/presets` — list hardware presets

### Phase B — Live Training Loop (built but feature-gated)

When DGX Spark remote access is confirmed stable, Phase B is unlocked:

1. Training jobs execute on remote DGX hardware against the exported JSONL
2. Fine-tuned adapter is merged and exported as an updated Ollama Modelfile
3. Model is re-injected into the simulation automatically
4. DEMOS scores are re-measured and the delta is logged as a named experiment run

Phase B code lives in the codebase but is not exposed on the website. Feature flag: `DEMOS_LIVE_TRAINING_ENABLED=false` in `.env`. No UI surfaces Phase B features until the flag is enabled.

---

## DGX Spark Hardware (Phase B)

Two NVIDIA DGX Spark units available remotely.

| Spec | Value |
|------|-------|
| Memory | 128 GB unified LPDDR5x |
| AI Performance | 1 PFLOPS FP4 |
| Framework | NeMo (full precision) |
| Max model (LoRA, no quant) | ~50B |
| 1.8B training time (~5K samples, 3 epochs) | ~15–25 min |
| 8B training time | ~1–2 hr |

On-site access available within 30 minutes if remote access is unavailable.

---

## Benchmark Identity

DEMOS is designed to be cited and reused independently of Agora Bench. A researcher could adopt the 7-dimension scoring rubric for any governance simulation without using the Agora Bench codebase.

Target citation context: arXiv `cs.MA` preprint — "DEMOS: A Benchmark for Evaluating AI Agents in Institutional Governance Simulations"
