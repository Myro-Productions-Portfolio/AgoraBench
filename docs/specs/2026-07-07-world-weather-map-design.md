# Spec: World Weather Map — /world visual redesign

*2026-07-07 — turn the `/world` text wall into a clickable US severity map. Owner-approved design (mockup: interactive US choropleth driven by real prod data). This is a spectator/UX slice on top of the already-shipped E2 slice-1 feed (PR #27); it changes **only the human-facing rendering**, not the feed, the data, or anything the AI sees.*

## Problem

`/world` currently renders every `world_events` row as a full-text card. NWS alone produces 200–870 active alerts at any moment (routine flood watches, small-craft advisories), so the page is an unreadable barrage for a human spectator. The full text is essential *for the agents* (once injection turns on) but hostile to a person who just wants to see what the weather is doing.

## Decision (locked, with reasoning)

1. **No new weather API — NWS-only, as-is.** The NWS feed already carries state location in its SAME/UGC codes; that is exactly why `world_events.location` is 99.8% populated (897/899 rows). A Google/other weather API would add a paid, rate-limited dependency that supplies nothing new and would violate the divergence spec's single-source exogeneity discipline. **The data problem is already solved; this is purely a rendering problem.**
2. **Precomputed inline SVG choropleth, zero new runtime dependencies.** State geometry is generated **once at build time** from the free public `us-atlas` US-states TopoJSON into plain SVG `<path>` data, shipped as a static asset. No map library, no tile server, no API key, no client-side topojson decode. This matches the project's established house pattern — `BudgetPage.tsx` and `DivergencePage.tsx` both render charts as "inline SVG, no chart dependency" (their words). react-simple-maps/d3-geo would fight that pattern for no benefit at 50-state scale.
3. **Map is the front door; text is a per-state drill-down.** Default view = the map + a nationwide summary. Click a state → its alerts populate a detail rail. The paginated text list is demoted from the primary surface to the drill-down target.
4. **Non-state FIPS go in a "coastal & territories" tray, off the painted map.** Marine zones and territories (FIPS 57/58/75, etc. — which top the raw counts because coastal advisories fire constantly) are not paintable states. They list in a compact tray beside the map so they stay visible without drowning the 50-state signal.

## Architecture

Three isolated units, each independently testable:

### A. Geometry generator (build-time, one-off)
- `scripts/generate-us-state-paths.ts` — reads a committed copy of `us-atlas` states TopoJSON, projects via Albers (CONUS) with Alaska + Hawaii as placed insets, emits `src/modules/world/client/lib/usStatePaths.ts` — a typed `Record<fipsCode, svgPathData>` plus a `Record<fips, [cx,cy]>` label-centroid map and the shared `viewBox`.
- Committed as generated source (not regenerated at app build) so the app has zero geo dependency. The `us-atlas` file + the script are committed for reproducibility; regeneration is a manual `pnpm tsx scripts/generate-us-state-paths.ts` when geometry ever needs changing.
- **What it does / how you use it / what it depends on:** produces static path data; consumed by the map component; depends only on the committed TopoJSON at generation time, nothing at runtime.

### B. State-aggregate API
- New `GET /api/world/state-summary?category={all|weather|disaster|earthquake}` returning, per state FIPS: `{ fips, count, maxSeverity, topCategory }`, plus a `coastal[]` array for non-state FIPS, plus `nationwide { totalAlerts, statesWithAlerts }`. Pure read, public router (same mount as the existing `GET /api/world/events`), limit/param whitelisted, no `req.body`.
- SQL: `GROUP BY location` with `count(*)`, `max(severity)`, `mode() WITHIN GROUP (ORDER BY category)`, filtered by category when not `all`. Length-2 numeric FIPS ≤ 56 → states; everything else → coastal tray. `inArray`/parameterized only — no raw `ANY()`.
- Existing `GET /api/world/events` gains an optional `?state={fips}` filter to back the drill-down rail (keeps pagination).

### C. Map UI (`WorldPage.tsx` rewrite)
- **Map panel (hero):** SVG choropleth from unit A, states filled by `sevColor(maxSeverity)` from unit B. Hover = preview, click = pin + load that state's events. Severity legend + category filter chips (re-fetch unit B on change). Semantic severity ramp **separate from the gold accent**: calm `#3E5A63` → advisory `#B99038` → warning `#C1702F` → severe `#A6382F`; no-data `#2f3136`.
- **Rail:** "Nationwide now" summary (total alerts, states affected, clickable top-6 hotspot strip) + a detail card that shows the selected state's alerts (title, category, per-event severity stripe, FIPS), fed by `GET /api/world/events?state=`.
- **Coastal tray:** compact list of non-state FIPS alerts below/beside the map.
- Uses AgoraBench tokens exactly (Playfair serif headers, stone/gold, surface/border grays). Both light+dark inherit from the existing app theme (the app is dark-first; follow existing page conventions).

## Severity → color mapping (single source of truth)
`maxSeverity >= 0.75 → severe; >= 0.55 → warning; >= 0.35 → advisory; > 0 → calm; null → no-data.` Extracted as a pure `worldSeverity.ts` helper (mirrors courtMath/fiscalMath pattern) so map fill, legend, and detail stripes all agree and it's unit-testable.

## Live refresh
The map re-fetches the state-summary on a light interval (or on the existing tick websocket event if one is wired for world events) so new alerts repaint without a manual reload. MVP: poll every N seconds while the page is open; upgrade to WS later if cheap.

## Explicitly out of scope
- No change to adapters, the `world_events` table, the tick poller, or any prompt/injection path (this slice is still pre-injection; the agents' data is untouched).
- No GDELT/FRED (still Tier 2, still gated).
- No county-level granularity (state-level only; county TopoJSON is 10× the geometry for no current signal).
- AGGE curation / materiality filtering remains the *next* E2 slice — this redesign makes the raw feed watchable in the meantime but does not thin it for agents.

## Testing / done
- Unit: `worldSeverity` mapping (boundaries 0.35/0.55/0.75, null); state-summary aggregation against fixtures (state vs coastal split, category filter, mode tie); generator output shape (all 50 states + DC present, valid path `d`, centroids in-viewBox).
- Build clean, existing 485-test suite stays green.
- Manual verify: `/world` renders the map from live prod data, click drills into a real state, filter repaints, coastal tray populated — driven end-to-end against production `world_events`.

## Integration points (existing code)
- Route already registered: `App.tsx:70` `/world`; nav `Layout.tsx:33`; shortcut `g o` `Layout.tsx:87`. Rewriting `WorldPage.tsx` in place — no routing changes.
- API sibling: `src/modules/world/server/routes/world.ts` (add `/state-summary`, extend `/events` with `?state`).
