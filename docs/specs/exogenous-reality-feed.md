# Spec: Exogenous Reality Feed

*2026-07-05 — the ingestion pipeline for world-caused events. Sources live-verified by research (wave 1); curation rules live in `docs/specs/agge-v2.md`; the exogeneity doctrine lives in `docs/DIVERGENCE_EXPERIMENT.md` §1.*

## Doctrine (restated because everything hangs on it)

Inject only what the world does TO a government; never what a government does. Research classified every candidate source on this axis — several "obvious" feeds failed the test and are explicitly **banned as injections** (they remain scoreboard inputs): GDP/unemployment/CPI (BEA/BLS — outcomes of policy), treasury yields (respond to fiscal/monetary choices), FEMA *response* actions (the declaration is government output; the underlying disaster is the event).

## Source tiers (all claims live-verified 2026-07-05)

**Tier 1 — MVP set. No auth, verified responding, high exogeneity, high narrative value:**

| Source | Endpoint | Cadence | Notes |
|---|---|---|---|
| USGS Earthquakes | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson` | ~5 min | Path is `earthquakes/feed` (plural — singular 404s). Feeds: `{significant,4.5,2.5,1.0,all}_{hour,day,week,month}.geojson`; arbitrary queries via `/fdsnws/event/1/query` |
| NWS Alerts | `https://api.weather.gov/alerts/active?area={ST}` | real-time | No key; requires descriptive `User-Agent` header. CAP-format alerts by state |
| OpenFEMA | `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=N&$orderby=declarationDate desc` | near-real-time | OData params. Use the *incident* (type, FIPS, dates) as the event; ignore the declaration side |

These three chain naturally (quake → alerts → declaration) into one storyline.

**Tier 2 — needs a free key or an LLM layer:**
- GDELT 2.0 DOC API (`api.gdeltproject.org/api/v2/doc/doc?query=...&mode=artlist&format=json`) — world-news attention signal; hard 1-request-per-5-seconds limit; measures *media attention*, so it needs an LLM summarization/dedup pass before it becomes an event candidate. This is also the "huge news events" channel the owner asked for — a major world story surfaces here first.
- FRED (`api.stlouisfed.org/fred/series/observations`, free key, 120 req/min) — **only the exogenous subset**: oil (DCOILWTICO), global commodities, foreign-economy series. US macro series are scoreboard-only (see observability spec).

**Tier 3 — descoped, with reasons recorded:** polling/public opinion (no free machine-readable source exists post-Gallup/538 shutdowns), Alpha Vantage/Stooq (rate-limited/scraper-blocked; FRED carries SP500/VIXCLS if ambient market signal is ever wanted), BEA/BLS (endogenous).

## Pipeline

```
adapters (per source) → world_events (normalized, deduped) → AGGE curation → injection channels
```

1. **Adapters** (`src/modules/world/server/feeds/*.ts`, one per source): fetch on schedule, normalize to a common shape, dedupe on `(source, externalId)`. Failure-isolated — a dead API logs and skips, never throws into the tick.
2. **`world_events` table**: `id, source, externalId, occurredAt, category (earthquake|weather|disaster|news|market), severity (0-1 normalized per category), title, summary, location, rawPayload jsonb, status (pending|injected|rejected|expired), exogeneityNote, fetchedAt`. Severity normalization is per-adapter (quake: magnitude-based; weather: alert severity field; news: GDELT volume z-score).
3. **AGGE curation** (spec'd in agge-v2.md Function 1): exogeneity test → materiality test → impact-channel choice → budgeted injection (`aggeMaxEventInjectionsPerDay`). Local-model LLM call; no cloud spend.
4. **Injection channels**, weakest to strongest — AGGE picks per event:
   - **a. Prompt context**: "World events: …" block in Phase 1/11/11.5 prompts (pattern: `congressContext.ts`).
   - **b. DWE modulation**: category-mapped multipliers (disaster → Engine 6 fiscal-pressure analog; the mapping table is config, not code).
   - **c. Agenda pressure**: emergency-session agenda item; pairs with the declare/no-declare mechanic (simulation-completeness spec §emergency-powers) — the event unlocks a *choice*, never forces the outcome.
   - **d. Fiscal shock demand**: creates a *proposal opportunity* (e.g. "disaster relief" spend_once suggestion in proposal prompts), never an auto-appropriation.
5. **Spectator surface**: `/world` page + activity-feed entries — viewers see the same world the agents see, with provenance links to the real event.

## Scale note (from the owner's federalism direction)

Events carry `location` (state FIPS where applicable) from day one, even while the sim is federal-only — when state/city tiers exist (`docs/specs/government-vertical.md`), the same feed routes a Kansas tornado to the Kansas governor-agent without adapter changes.

## Config (four-things rule)

`worldFeedEnabled` (bool, def false), `worldFeedPollTicks` (1–48, def 1), per-source enable flags (`worldFeedUsgsEnabled` etc.), `worldFeedGdeltEnabled` (def false until LLM curation proven), plus AGGE's injection budget (agge-v2 spec).

## Build order

Adapters+table+/world page (read-only, nothing injected — deploy, watch a week of events accumulate) → AGGE curation + channel a (prompts) → channels b/c/d one at a time. Every step observable before the next turns on.
