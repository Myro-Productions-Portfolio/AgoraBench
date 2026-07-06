# Spec: Observability & Metrics — the Sim-vs-Reality Scoreboard

*2026-07-05 — defines what "is the AI government doing better?" means, measurably. Extends `docs/DIVERGENCE_EXPERIMENT.md` §2.4 from fiscal-only to the full scoreboard.*

## Design principle: comparability is the whole game

A metric earns a place only if BOTH sides can produce the same number: the sim computes it from its own state, reality supplies it from a machine-readable source. One-sided numbers go on the regular dashboard, not the scoreboard.

Presentation model: **USAFacts' "Government 10-K"** — the US government reported like a company. Our scoreboard is two 10-Ks side by side, same line items, different management.

## The metric registry

New table `metric_definitions` (`key, name, unit, simSource (sql/computed), realitySource (adapter+series), cadence, direction (lower|higher|context)`) + `metric_snapshots` (`metricKey, side (sim|reality), value, atDate, atTick nullable`). Adding a metric = one registry row + one adapter mapping — the comparison UI reads the registry, so the scoreboard grows without UI changes.

## Launch metrics, in readiness order (per verified wave-1 research)

**Tier A — ready the moment the divergence core (epochs 1–2) ships:**
1. Deficit $/day and %-of-GDP — sim: `fiscal_tick_summaries`; reality: Treasury MTS Table 1.
2. Debt & debt-to-GDP — sim: `government_settings.debtOutstanding`; reality: Debt to the Penny.
3. Total spending %-of-GDP + category mix (L1 divergence score) — sim: programs+interest; reality: MTS Table 9.
4. Tax burden (receipts %-of-GDP) — sim: revenue engine; reality: MTS Table 1.

**Tier B — ready now, needs only the export layer:**
5. Legislative throughput — laws enacted per session-equivalent, **session-relative normalized** (GovTrack shows real enactment is back-loaded: ~33% of a session's bills by December of year 1 — raw counts mislead); sim: `laws.enactedTick`; reality: Congress.gov API (already keyed on the box).
6. Time-to-passage — median introduction→enactment; sim: bill status timestamps; reality: Congress.gov.
7. Approval **trend-shape** (not absolute level — methodologies differ): sim: `approval_events`; reality: YouGov congressional tracker / Ballotpedia Polling Index. **Note: Gallup ended presidential approval tracking Feb 2026 (88-year series closed) and FiveThirtyEight is defunct — YouGov/Ballotpedia are the surviving reference sources; both are page-scrapes, not APIs, so cadence is weekly-manual or a tolerant parser.**
8. Shutdown/funding-lapse days — reality: CRS/Wikipedia series (2025 shutdown: 43 days; 2026 DHS lapse: 76); sim: requires the CR/shutdown mechanic (simulation-completeness spec). Displays as "not yet comparable" until then — visible-but-pending beats silently absent.

**Tier C — requires the world-model economy layer (`docs/specs/world-model.md`):**
9. Unemployment rate — reality: FRED UNRATE; sim: needs the macro state vector.
10. Inflation rate — reality: FRED CPIAUCSL; sim: same.
11. GDP growth — reality: FRED GDP; sim: same (static $28T today).
12. Poverty / uninsured rate — reality: Census SAIPE/SAHIE (annual cadence only); sim: social-state vector, later.

**Rejected for v1, recorded so nobody re-litigates:** WGI/Legatum/SPI/OECD composite indices (cross-country relative percentiles — meaningless with one country per side; their *dimension lists* informed the categories above), trust-in-government (Pew series is periodic-report-only; OWID mirror is the fallback if ever wanted).

## Surfaces

- `/divergence` (from the divergence spec) becomes the scoreboard: registry-driven metric rows, each showing sim value, reality value, gap, trend sparklines since T0, and a "comparable since" date for tiered metrics.
- **The 10-K export**: periodic AI-written report (owner's report-export direction, memory: future-direction) — an LLM narrates the quarter: what the AI government did, what reality did, where they diverged and why it appears to have happened. Local model, template-driven, published to the press room (`gazette_issues` — the surface already exists).
- No composite "who's winning" score in v1 — metrics + narrative; a weighted verdict is a product decision after we see real divergence data.

## Reality adapters

Reuse the `reality_snapshots` puller architecture (divergence spec §2.3): each Tier A/B source is one adapter; FRED needs a free key (`FRED_API_KEY` in Vault + .env); Congress.gov key exists. Scrape-based sources (YouGov/Ballotpedia) get tolerant parsers + staleness alarms, never hard failures.

## Config

`scoreboardEnabled` (bool), `tenKReportCadenceTicks` (0=off, def 90 ≈ quarterly), per-adapter enables. Four-things rule throughout.
