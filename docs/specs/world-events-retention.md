# Spec: World-Events Retention + Map Recency Window

*2026-07-12 — fixes the two real consequences of the unbounded `world_events` feed found in the 7/12 status review: (1) the `/world` choropleth aggregates ALL history so states show their worst-ever severity forever and never cool down; (2) the table itself grows without bound (~920 NWS rows/day, ~1 GB/yr at current rate). Engine housekeeping, not policy — nothing here touches what agents see (the prompt-injection channel is already recency-windowed by design and needs no change).*

---

## 0. Current state (audited 2026-07-12, tick 875)

| Consumer | Query shape | Affected by stacking? |
|---|---|---|
| Agent prompts (`worldEventsContext.ts`) | last `worldEventsRecencyHours` (72h) · severity ≥ 0.35 · top 6 · 900-char cap | **No** — self-limiting, and still dark (`worldEventsInjectionEnabled=false`) |
| `/world` events list (`GET /api/world/events`) | paginated, newest `occurredAt` first | **No** — bounded pages; it is deliberately a history browser |
| `/world` map + hotspot rail + coastal tray (`GET /api/world/state-summary`) | `GROUP BY location` over **all rows ever**, `MAX(severity)`, `COUNT(*)` | **Yes** — hotspots never fade, counts only grow |
| The table itself | no pruning code anywhere; all 5,718 rows `status='pending'` | **Yes** — unbounded, ~20 MB in 8 days |

Live facts that shape the design:

- **Ingest rate:** NWS ~920 rows/day (5,688 of 5,718 rows); OpenFEMA 26; USGS 4.
- **Source re-serve windows** (matters for delete-then-reinsert churn):
  - USGS: `significant_week.geojson` — 7-day rolling window; rows older than 7 days never come back.
  - NWS: `/alerts/active` — active alerts only; alerts leave the feed within days.
  - OpenFEMA: `$top=25 $orderby=declarationDate desc` — the 25 most recent declarations *regardless of age* (currently spanning 2025-09-28 → 2026-07-05). Deleted FEMA rows WILL be re-inserted on the next poll for as long as they remain in the top 25.
- **`status` lifecycle is spoken for:** `exogenous-reality-feed.md` defines `pending|injected|rejected|expired` as the *AGGE curation* state machine (curation slice not yet built; nothing writes `status` today). Retention must NOT write `status` values or it collides with that future slice.

## 1. Design

Two independent pieces, both gated behind existing/new RuntimeConfig, no migration, no schema change.

### 1.1 Map recency window (the visible fix)

`GET /api/world/state-summary` gains a recency predicate:

```
WHERE occurred_at >= now() - worldMapRecencyHours   (AND category filter as today)
```

- New RuntimeConfig field **`worldMapRecencyHours`** — default **168** (7 days), clamp 1–720.
- Deliberately a *separate* knob from `worldEventsRecencyHours` (72h): that one is agent-facing physics (what officeholders are briefed on); this one is spectator display ("what is the weather map showing"). They will legitimately diverge.
- The endpoint returns `windowHours` in its payload so the page can label the map ("last 7 days") without hardcoding — the count badges change meaning from all-time to windowed, and the UI should say so.
- `GET /api/world/events` (list + per-state drill-down) stays unwindowed: it is the history browser, already paginated.

### 1.2 Retention sweep (the growth bound)

New `sweepWorldEvents()` in `worldFeedPoller.ts`:

```
DELETE FROM world_events WHERE fetched_at < now() - worldEventsRetentionDays
```

- New RuntimeConfig field **`worldEventsRetentionDays`** — default **30**, allowed values **0 or 7–365**. `0` = sweep disabled (never delete). Floor of 7 keeps retention comfortably above both the 72h injection window and USGS's 7-day re-serve window.
- **Keyed on `fetched_at`, not `occurred_at`** — deliberate. OpenFEMA rows carry `occurred_at` up to months in the past at first fetch; an `occurred_at` key would delete them immediately and re-insert them every poll. `fetched_at` gives "we have held this row N days" semantics.
- **FEMA churn is accepted and documented:** the ~25 standing declarations age out after N days, get re-inserted on the next poll with a fresh `fetched_at`, and live another N days. ~25 rows re-cycling monthly is noise, and it keeps standing declarations visible — arguably the correct behavior.
- Runs in the existing world-feed tick block (`agentTick.ts` ~6251), immediately after `pollWorldEvents()`, under the same gates (`worldFeedEnabled && tickNumber % worldFeedPollTicks === 0`). Failure-isolated exactly like the poller: never throws, logs `deleted N` alongside the existing `pulled N` line.
- One DELETE per poll on a ≤30k-row / ~100 MB-steady-state table needs no index on `fetched_at`; revisit only if retention or ingest grows 10×.
- **Does not touch `status`** — the `pending|injected|rejected|expired` machine stays wholly owned by the future AGGE curation slice.

### 1.3 Steady-state math

At current ingest (~950 rows/day, ~3.5 KB/row incl. `raw_payload`): 30-day retention ⇒ ~28k rows, ~100 MB total relation size, flat forever. Acceptable; `raw_payload` stripping rejected (below).

## 2. Rejected alternatives

- **Soft-expiry (`status='expired'`) instead of DELETE** — collides with the AGGE curation state machine, keeps unbounded row growth, and the only reader that filters on `expired` (the injection channel) is already recency-bounded anyway.
- **`raw_payload` stripping at N days** (`SET raw_payload='{}'`) — saves ~75 MB steady-state; not worth a third config field and a second UPDATE per poll at this scale. Revisit if retention is ever raised to 365d.
- **Windowing `GET /api/world/events`** — it's the history browser; pagination already bounds it. Windowing it would just hide the (now bounded-at-30-days) history for no gain.
- **Reusing `worldEventsRecencyHours` for the map** — couples spectator display to agent-briefing physics; changing what agents react to would silently change the public map, and vice versa.

## 3. Config summary (four-things rule applies to both)

| Field | Type | Default | Clamp | Consumer |
|---|---|---|---|---|
| `worldMapRecencyHours` | number | 168 | 1–720 | `state-summary` query window |
| `worldEventsRetentionDays` | number | 30 | 0 or 7–365 (0 = off) | `sweepWorldEvents()` cutoff |

Each needs, in the same commit: RuntimeConfig interface + DEFAULTS entry, `POST /admin/config` whitelist branch with the clamp above, AdminPage control + client interface entry, persistence verified.

## 4. Verification plan (post-deploy)

1. `state-summary` window: call the API, cross-check one state's `count`/`maxSeverity` against direct SQL with the same 168h predicate; confirm a state whose only events are older than 7 days now renders quiet.
2. Sweep: nothing is >30 days old yet (feed went live 7/05), so temporarily set `worldEventsRetentionDays=7` via admin, wait one poll tick, confirm the `[SIMULATION] World events: ... deleted N` log line and that `MIN(fetched_at)` moved; restore to 30.
3. `worldEventsRetentionDays=0`: confirm the sweep logs nothing and deletes nothing for one tick.
4. Prompt-channel unchanged: `buildWorldEventsBlock()` untouched by diff (grep), injection flag still false.
