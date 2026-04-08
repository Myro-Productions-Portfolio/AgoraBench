# Inference URL & Model Dropdowns — Design Spec

**Date:** 2026-04-07
**Status:** Approved

---

## Problem

Both the simulation agent inference URL and the AGGE inference URL are either env-only or free-text fields. The model dropdown uses a single shared `availableModels` state that queries whatever `OPENAI_BASE_URL` is — so it only ever shows the one model loaded on whatever vLLM it hits. When AGGE uses OpenRouter, the model dropdown shows nothing.

---

## Scope

Two independent inference config sections:

1. **AGGE tab → Inference Config** — already exists, upgrade in place
2. **Simulation tab → new "Inference" section** — promotes env vars to DB-persisted runtimeConfig fields

They are fully independent. No shared state, no collision.

---

## Architecture

### New runtimeConfig Fields

Add to `src/core/server/runtimeConfig.ts`:

```typescript
simInferenceUrl: string;   // replaces OPENAI_BASE_URL at runtime
simInferenceModel: string; // replaces OPENAI_MODEL at runtime
```

Defaults: `''` (empty = fall back to env vars).

### admin.ts Config Handler

Add `simInferenceUrl` and `simInferenceModel` to the POST `/admin/config` whitelist with string type validation. No range clamps needed.

### ai.ts / agentTick.ts

When resolving the simulation inference URL and model, check `rc.simInferenceUrl` / `rc.simInferenceModel` first, then fall back to `process.env.OPENAI_BASE_URL` / `process.env.OPENAI_MODEL`.

### GET /api/admin/models

Add optional `?url=` query param. When provided, fetch models from that URL instead of `OPENAI_BASE_URL`. Response is the same shape.

For known cloud providers (detected by URL pattern), return a hardcoded curated list instead of making a live fetch:

| URL pattern | Returns |
|-------------|---------|
| `openrouter.ai` | Curated list (see below) |
| `anthropic.com` | Curated Anthropic models |
| `openai.com` | Curated OpenAI models |
| anything else | Live `/v1/models` query |

**OpenRouter curated list:**
- `google/gemini-flash-2.5`
- `google/gemini-pro-2.5`
- `anthropic/claude-sonnet-4-6`
- `anthropic/claude-opus-4-6`
- `anthropic/claude-haiku-4-5`
- `meta-llama/llama-3.3-70b-instruct`
- `mistralai/mistral-large`
- `openai/gpt-4o`
- `openai/gpt-4o-mini`

**Anthropic curated list:**
- `claude-sonnet-4-6`
- `claude-opus-4-6`
- `claude-haiku-4-5-20251001`

**OpenAI curated list:**
- `gpt-4o`
- `gpt-4o-mini`
- `gpt-4-turbo`
- `o1`
- `o3-mini`

---

## UI Components

### Inference URL Field (used in both sections)

A **combo control**: dropdown of presets on top, editable text input below. Selecting a preset fills the text input. The text input is always editable for custom URLs.

**Presets:**
| Label | URL |
|-------|-----|
| bspark2 vLLM (default) | `http://10.0.0.169:8000/v1` |
| bspark1 vLLM | `http://10.0.0.69:8000/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Anthropic | `https://api.anthropic.com/v1` |
| OpenAI | `https://api.openai.com/v1` |
| Custom | (clears the text input) |

Saving: on blur of the text input, save to runtimeConfig and trigger model fetch for that section.

### Model Name Field (used in both sections)

- Fetches models from `GET /api/admin/models?url=<currentUrl>` when the URL changes or on mount
- If models returned: show as `<select>` dropdown
- If empty or fetch failed: show free-text `<input>`
- Each section has its own independent model state (`simModels`, `aggeModels`) and fetch function

### State separation in AdminPage.tsx

Replace single `availableModels` / `modelsFetchFailed` with:

```typescript
const [simModels, setSimModels] = useState<string[]>([]);
const [simModelsFailed, setSimModelsFailed] = useState(false);
const [aggeModels, setAggeModels] = useState<string[]>([]);
const [aggeModelsFailed, setAggeModelsFailed] = useState(false);
```

Two fetch functions: `fetchSimModels()` and `fetchAggeModels()`, each passing their respective URL to `?url=`.

---

## Data Flow

```
User selects preset URL (AGGE section)
  → aggeInferenceUrl state updated
  → saveConfig({ aggeInferenceUrl })
  → fetchAggeModels() → GET /api/admin/models?url=<aggeUrl>
  → aggeModels state updated → model dropdown re-renders

User selects preset URL (Sim section)
  → simInferenceUrl state updated
  → saveConfig({ simInferenceUrl })
  → fetchSimModels() → GET /api/admin/models?url=<simUrl>
  → simModels state updated → model dropdown re-renders
```

AGGE inference (aggeTick.ts) and sim inference (ai.ts) each resolve their URL independently — no shared lookup.

---

## Non-Overlap Guarantee

- `aggeInferenceUrl` / `aggeInferenceModel` → used only in `aggeTick.ts`
- `simInferenceUrl` / `simInferenceModel` → used only in `ai.ts` (callOpenAI)
- Env vars (`OPENAI_BASE_URL`, `OPENAI_MODEL`, `AGGE_INFERENCE_URL`, `AGGE_INFERENCE_MODEL`) remain as startup fallbacks, never written by the app
- DB runtimeConfig fields take precedence over env vars at runtime

---

## Files Changed

| File | Change |
|------|--------|
| `src/core/server/runtimeConfig.ts` | Add `simInferenceUrl`, `simInferenceModel` fields + defaults |
| `src/modules/admin/server/routes/admin.ts` | Add both fields to POST `/admin/config` whitelist |
| `src/modules/admin/server/routes/models.ts` | Add `?url=` param, add curated lists for cloud providers |
| `src/core/server/services/ai.ts` | Resolve sim URL/model from `rc.simInferenceUrl` first |
| `src/modules/admin/client/pages/AdminPage.tsx` | Split model state, add preset dropdowns to both sections, add Sim Inference section |

---

## Out of Scope

- Per-agent model overrides (already exists separately)
- API key management per provider (handled by the Providers tab)
- OpenRouter model discovery via live API
