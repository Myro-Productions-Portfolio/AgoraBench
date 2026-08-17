# Research: Existing Games as a Downstream Effect/Spectator Layer

*2026-08-16 — owner asked whether an existing game could visualize how AgoraBench's laws/policies/budgets affect government services (BMV-style offices, transportation, state services). Researched fresh (web, 2026-08-16). AI-facing reference doc; verdict summary in chat. Companion precedent: `agentsociety-assessment.md` (external engine rejected as physics; rendering layers on our physics blessed).*

## Architectural constraint (from prior doctrine, non-negotiable)

Any game tie-in is a **one-way consequence renderer**: AgoraBench state → game knobs, never game state → sim. The sim's truth stays in the E5 world-model (macro engine shipped, PR #46). A second free-running simulation feeding back is the exact failure the AgentSociety assessment rejected. Contract surface we already produce: regime, GDP growth, unemployment, inflation, sentiment, shock impulses, tax rate, treasury, budget, categorized laws.

## Candidates (10 evaluated)

### 1. OpenTTD — viable, top pick on the transport axis
- **Integration:** Admin port (TCP 3977, password-gated) — documented binary protocol for external processes: `AdminUpdateFrequency` (live push subscriptions), `AdminPoll`, `AdminRemoteConsoleCommand` (full RCON, no in-game presence). Server pushes company economy/statistics, date, events. RCON `setting <name> <value>` changes game settings live; `settings_access` permission flag exists. GameScript (server-side Squirrel) can bridge admin-port JSON to the full GS API: `GSCompany` (loans/cash), `GSTown` (growth/funding), `GSSubsidy`, `GSInfrastructure`, `GSGameSettings`. Community bridges exist (ServerGS, AdminCmd; OpenTTD MCP servers exist in 2026 — people are already doing "external agent drives OpenTTD").
  - https://github.com/OpenTTD/OpenTTD/blob/master/docs/admin_network.md
  - https://wiki.openttd.org/en/Development/Server%20admin%20port
  - https://docs.openttd.org/gs-api/classGSEventAdminPort · https://docs.openttd.org/gs-api/annotated
  - https://github.com/erenard/AdminCmd · https://github.com/JGRennison/OpenTTD-patches/wiki/Network-server-administration
  - https://lobehub.com/mcp/inewlegend-openttd-mcp
- **Headless:** first-class dedicated server, maintained Docker images (`bateau/openttd`, 1M+ pulls). **License:** GPL-2.0. **Health:** actively maintained.
- **Gap:** it's transport/logistics — subsidies, town funding, infrastructure. No bureaucracy/civil-services representation.

### 2. micropolisJS headless fork ("Hallucinating Splines" pattern) — viable, top pick on the services axis
- Live 2026 precedent (HN-featured, Feb 2026): micropolisJS patched headless (~4 small patches), wrapped in a REST API (Hono), external agent controls **zoning, roads/power/water, budget, tax rate, police/fire funding, tick advancement**, public spectator site.
  - https://github.com/andrewedunn/hallucinating-splines · https://hallucinatingsplines.com
  - HN thread https://news.ycombinator.com/item?id=46946593 (comments 429'd to fetch — critique/limitations unread)
- **Fit:** classic SimCity model — tax rate → service budget → visible service-quality/RCI consequences. Closest match to the owner's "BMV/offices" framing of any candidate. Engine is plain JS/TS → portable to our Ubuntu box, could even render the map client-side on agorabench.com.
- **License:** GPL-3.0 (Micropolis/EA lineage) — fine for public spectator site. **Risk:** base micropolisJS dormant (maintainer stepped back 2022); Splines is 28-star single-maintainer. Realistic use = fork the engine + copy the headless patches, own it ourselves; never depend on their hosted infra.

### 3. Cities: Skylines II — fails
No official code-mod SDK or headless mode as of research date (Colossal Order → Iceflake transition early 2026; Paradox lists code modding as still in development, asset mods only). Community network-API mod targets CS1 (2015), UDP localhost, requires GUI running. Commercial EULA gray zone for spectator use.
- https://www.paradoxinteractive.com/games/cities-skylines-ii/modding · https://github.com/finger563/cities-skylines-network-api

### 4. Democracy 4 — fails at runtime
Thematically the closest data model (policy-as-network; we already steal its voter-graph design for E5 Layer 4), but modding is static CSV read at new-game start. No live API, no headless, no server component.
- https://www.positech.co.uk/democracy4/modding.html

### 5. Workers & Resources: Soviet Republic — no control surface found (3-strike stop). No RCON/API/scripting evidence across wiki, Steam, ModDB/Nexus.

### 6. Simutrans — headless-capable (`-server`), GPL, active (v124.5, May 2026), has in-process Squirrel scenario/AI API — but no external network admin protocol. Would require building the bridge OpenTTD ships for free. Rank below OpenTTD.
- https://dwachs.github.io/simutrans-sqapi-doc/

### 7. micropolisJS upstream — dormant; value is as the engine for #2. Roll into #2.

### 8. Citybound — WIP solo Rust project, not feature-complete, no API. Not viable.

### 9. NationStates — mature API but wrong shape: controls your own nation's moves, text/stats output, no spatial/visual world. Fails the spectator-legibility requirement.

### 10. New 2024–2026 entrants — nothing beyond Hallucinating Splines. Citystate Metropolis models policy consequences but no API evidence (3-strike stop).

## The real risk (adversarial finding)

**No candidate closes the semantic gap — the bill→knob translation layer is the actual project.** Every game exposes generic sliders (tax %, service budget %, subsidy $). None can represent arbitrary bill text. We would hard-code a curated subset of policy categories with plausible game-knob analogs and no-op everything else — lossy and arbitrary by construction. Design the bill→knob taxonomy first, pick the game second. Mitigation available to us that Hallucinating Splines lacked: we don't have to map bills directly — the macro engine already reduces policy to numeric state (growth, unemployment, budget levels). Driving the game from **macro state** instead of per-bill mapping shrinks the taxonomy problem to a handful of well-defined couplings; per-category law flavor (e.g. an infrastructure law visibly funds roads) layers on top selectively.

## Natural tiers (real stages, not manufactured)

- **MVP:** micropolisJS engine forked headless on the Linux box; one-way driver reads macro state per tick (tax rate → city tax, budget allocations → police/fire/transit funding, unemployment/GDP → RCI demand weights); spectator map tab on agorabench.com. No feedback path, feature-flagged like everything else.
- **Phase 2:** per-category law hooks (curated whitelist: infrastructure/transit/public-safety/tax categories get visible city effects; everything else intentionally no-ops), Gazette cross-references ("the city under Law X").
- **Not planned:** any game→sim feedback; that seam stays closed by doctrine.
