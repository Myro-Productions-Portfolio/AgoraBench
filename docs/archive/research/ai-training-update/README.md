# POLIS Training Export — Integration Guide

## What This Is

A drop-in feature for AgoraBench that lets users:
1. See POLIS benchmark scores for all agents
2. Select a model + hardware target
3. Export a ready-to-run fine-tuning package (zip)

The package includes: training dataset (JSONL), training scripts auto-configured for the target hardware, Ollama Modelfile, deploy script, and baseline POLIS scores.

## File Structure

```
polis-training-export/
├── server/
│   └── training-package-generator.js   # API routes + all generation logic
├── client/
│   └── PolisTrainingExport.jsx         # React UI component
└── README.md                           # This file
```

## Backend Integration

### 1. Install dependency

```bash
npm install archiver
```

### 2. Mount the routes in your Express app

```javascript
// In your main server file (e.g., server.js or app.js)
import { trainingRoutes } from './training-package-generator.js';

app.use('/api/training', trainingRoutes);
```

### 3. Wire up database queries

Open `training-package-generator.js` and find the section at the bottom labeled
`DATABASE QUERY STUBS`. Replace the 6 stub functions with your actual PostgreSQL
queries. They should return arrays matching your CSV export schema:

```javascript
async function fetchAgents() {
  const { rows } = await pool.query('SELECT * FROM agents WHERE is_active = true');
  return rows;
}

async function fetchDecisions() {
  const { rows } = await pool.query(`
    SELECT id, created_at as "createdAt", agent_name as "agentName",
           provider, phase, parsed_action as "parsedAction",
           parsed_reasoning as "parsedReasoning", success,
           latency_ms as "latencyMs"
    FROM agent_decisions
    ORDER BY created_at DESC
    LIMIT 50000
  `);
  return rows;
}

// ... same pattern for fetchVotes, fetchBills, fetchLaws, fetchApprovalEvents
```

### 4. API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/training/presets` | List hardware presets |
| GET | `/api/training/models` | List available models |
| POST | `/api/training/scores` | Calculate POLIS scores |
| POST | `/api/training/export` | Generate & download training zip |

## Frontend Integration

### 1. Add the component to your router

```jsx
import PolisTrainingExport from './PolisTrainingExport';

// In your React Router setup
<Route path="/training" element={<PolisTrainingExport />} />
```

### 2. Add navigation link

Add a link to your existing nav (probably near the Experiments page):

```jsx
<NavLink to="/training">Training Export</NavLink>
```

### 3. Font dependencies

The component uses these fonts to match your existing dark theme:
- IBM Plex Sans (body)
- IBM Plex Mono (code/numbers)
- Playfair Display (headings)

If not already loaded, add to your HTML head:
```html
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;600;700&family=Playfair+Display:wght@400;500&display=swap" rel="stylesheet">
```

## Hardware Presets Included

| ID | Name | VRAM | Framework | For |
|----|------|------|-----------|-----|
| `dgx_spark` | NVIDIA DGX Spark | 128GB | NeMo | Full precision, fast |
| `cloud_a100` | Cloud A100 80GB | 80GB | Axolotl | Rented GPU instances |
| `single_gpu_24gb` | RTX 4090 / A5000 | 24GB | Unsloth | Desktop GPU |
| `single_gpu_12gb` | RTX 4070 / T4 | 12GB | Unsloth | Budget GPU |
| `mac_m4_pro` | Mac Mini M4 Pro | 24GB | MLX | Your Mac Mini |

## Models Registered

| ID | HF Repo | Size | Alignment |
|----|---------|------|-----------|
| `politics_left_deepseek` | vsingh1221/politics_left_deepseek | 1.8B | Progressive |
| `politics_center_deepseek` | vsingh1221/politics_center_deepseek | 1.8B | Moderate |
| `politics_right_deepseek` | vsingh1221/politics_right_deepseek | 1.8B | Conservative |
| `llama3.1-8b-political-subreddits` | mradermacher/...i1-GGUF | 8B | General |

To add more models, edit the `MODEL_REGISTRY` object in the generator.

## POLIS Score Dimensions

The composite score (0-100) is a weighted aggregate of:

| Dimension | Weight | What It Measures |
|-----------|--------|-----------------|
| Decision Coherence | 20% | Valid action parsing rate |
| Reasoning Quality | 15% | Non-trivial reasoning in outputs |
| Legislative Independence | 20% | Realistic voting patterns (not rubber-stamping) |
| Whip Discipline Balance | 10% | Party compliance near realistic 85-90% |
| Latency Efficiency | 10% | Response time in reasonable range |
| Approval Stability | 10% | Steady approval without wild swings |
| Participation Rate | 15% | Active engagement in simulation |

## Adding New Hardware Presets

```javascript
// In HARDWARE_PRESETS object:
my_custom_setup: {
  name: 'My Custom Rig',
  vram: '48GB',
  gpuCount: 1,
  gpuModel: 'RTX 6000 Ada',
  maxModelSize: '13B',
  batchSize: 8,
  gradientAccumulation: 4,
  quantization: null,
  trainingFramework: 'unsloth', // unsloth | axolotl | mlx-lm | nemo
  estimatedTimePerEpoch: '~20 min for 8B',
  config: {
    precision: 'bf16',
    maxSeqLength: 4096,
    loraRank: 64,
    loraAlpha: 128,
    loraDropout: 0.05,
    learningRate: 2e-4,
    warmupSteps: 100,
    epochs: 3,
    optimizer: 'adamw_torch',
    schedulerType: 'cosine',
  }
}
```

## The Loop

```
┌─────────────────────────────────────────────┐
│                                             │
│  Run Simulation → Measure POLIS Scores      │
│       │                                     │
│       ▼                                     │
│  Export Training Package                    │
│       │                                     │
│       ▼                                     │
│  Fine-Tune Model on Failures                │
│       │                                     │
│       ▼                                     │
│  Re-Inject into AgoraBench              │
│       │                                     │
│       ▼                                     │
│  Run Simulation Again → Compare Scores ─────┘
│
└─────────────────────────────────────────────┘
```

That's it. Score → Train → Re-inject → Repeat.
