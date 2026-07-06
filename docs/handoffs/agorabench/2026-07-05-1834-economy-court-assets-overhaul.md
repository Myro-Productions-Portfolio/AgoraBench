# Handoff — Court records/precedent, US-scale economy overhaul, dashboard fixes, asset refinement + icon unification

**Date**: 2026-07-05 18:34
**Project**: AgoraBench
**Branch**: main (clean — 0 modified, 0 untracked, this handoff file itself untracked)
**Session topic**: Marathon feature session (2026-07-04 evening into 07-05) — judicial court-records system with real precedent citations, full economy overhaul to US-scale dollars, dashboard layout fixes, complete asset audit + refinement + icon unification, and the asset-generation brief for a separate ComfyUI session. Twelve PRs merged, all deployed to prod and live-verified.

## State + in-progress work

Everything in this session is **shipped and closed**, not in-progress. No mid-edit state, no blocked work.

- **Code**: main @ `b2fbf9f`, pushed to origin.
- **Deploy**: Linux box (10.0.0.10) is running through `b2fbf9f` — deployed and live-verified.
- **Tests**: 296 → 313 (PR #5) → 318 (PR #6), all green.
- **Live site**: verified in a real browser across most PRs — treasury/payroll figures, court records/precedent links, dashboard feed alignment, favicon/touch-icon, empty states, 404 page, unified icons, party logo all confirmed live.
- This handoff file is intentionally left **untracked** (repo hook blocks direct edits on main) — commit it next session.
- **Cross-session dependency**: a separate overnight chat (2026-07-05) already attempted the asset-generation work from PR #11's brief. The owner **rejected the entire batch** as too dark/indistinct. Do not resume generation without reading the memory files listed below first — the brief in `docs/ASSET-GENERATION-TODO.md` predates those verdicts and is stale on approach (though targets are still valid).

## Decisions + reasoning

- **Court precedent citations injected into judicial prompts (Phase 10)** — Why: justices were deciding cases with no memory of prior rulings; up to 5 same-law-then-same-type prior decided cases, distilled to one-line holdings, injected before `constitutionBlock10` (truncation-aware) so citations are grounded in real case data, not hallucinated.
- **Raised prod `maxPromptLengthChars` 4000→5000 via direct jsonb_set** — Why: court prompts were already ~3,400 chars; a full precedent block adds ~1,300, would have silently truncated without headroom.
- **Economy: FULL US SCALE, not a toy number** (GDP $28T, population 330M, treasury $1.5T, daily citizen revenue = GDP × 18% / 365 ≈ $13.8B) — Why: owner's explicit choice from a structured options review; MoltDollar fictional currency retired in favor of plain `$` display.
- **Wealth rebase formula: `balance = 25000 + old×20`, preserving relative ranking, with conversion ledger rows** — Why: needed a principled one-time migration that didn't erase relative agent standing; ledger rows give an audit trail.
- **Real 2026 US government salaries, paid BI-WEEKLY (`payPeriodTicks=14`, annual/26, net of withholding)** — Why: owner wanted realism (Pres $400k, Cabinet $253.1k, Congress+chairs $174k, Justices $306.6k; sourced from NTU/uscourts.gov/CRS) over arbitrary sim numbers.
- **Withholding money-flow: Phase 12 treasury debits GROSS, Phase 13 remits withholding back** — Why: a **pre-merge review caught the original design as a money-minting bug** (withholding was being double-credited); fixed in `4e7582e` before merge. This is the single most important correctness catch of the session — re-check this logic if payroll numbers ever look wrong.
- **Phase 13 wealth tax deleted, replaced by `dailyCitizenRevenue` accrual + one `revenue_collected` event** — Why: wealth tax made no sense at nation-state scale; a single daily revenue event is simpler and matches the "GDP-scale economy" framing.
- **Election +500 cash bonus removed, reputation kept; `campaignFilingFee` made real ($2,500 charged at announce)** — Why: cash bonus was a vestige of the toy economy; filing fee existed in config but was dead code, now enforced.
- **Migration 0026 (bigint rebase) applied directly to prod after a fresh backup**, guarded so the data rebase only runs while treasury <1e9 — Why: idempotency guard prevents accidental double-rebase if the migration is ever re-run.
- **Dashboard Recent Activity feed uses absolute-fill inside a `relative min-h-[440px]` grid cell, sidebar drives height** — Why: simplest way to pixel-align two independently-sized columns without hardcoding a shared height; verified live with delta 0 between feed bottom and Quick Stats card bottom.
- **Asset repo diet (~59MB removed) — all deleted files backed up first** to `/Volumes/DevDrive-M4Pro/Backups/AgoraBench/asset-sources/` (18 files, 58MB) before deletion, including an untracked Signal screenshot that was moved rather than deleted — Why: standard practice, nothing destructive without a recoverable copy.
- **Unified icon system replacing ALL Unicode glyphs/emoji app-wide** (28 stroke SVGs, 16×16, strokeWidth 1.2, currentColor) — Why: consistent visual language; also fixed a real bug (double ⚖ glyph in AdminPage sidebar tabs). Semantics enforced: scales=justice, document=legislation, everywhere.
- **`no-agents.jpg` empty-state art deliberately left unwired** — Why: the only candidate container is too small for the art to read well; revisit only if a suitable larger container appears.
- **dpa.webp recovered and repurposed as `pa.webp`** (Progressive Alliance logo) via 100%-rename `git mv`, not regenerated — Why: owner confirmed the asset had no baked-in lettering issues, so recovery was strictly cheaper than regeneration.
- **Asset generation work handed to a separate ComfyUI/Flux session (DGX Sparks) rather than done inline** — Why: generation is a different toolchain/workflow than app code; `docs/ASSET-GENERATION-TODO.md` written as a self-contained brief. (See State section — that overnight attempt was rejected; read the post-mortem memories before retrying.)

## File paths + line refs

- `src/modules/legislation/server/routes/court.ts` — `GET /api/court/cases`: pagination (`limit≤100`/`offset` + `meta.total`), search `q` (ILIKE case number/caption/question), `outcome` + `caseType` filters, all whitelisted (PR #5, `23eee6a`).
- `src/modules/legislation/server/lib/courtMath.ts` — `extractCaseNumbers`, `distillHolding`, `buildPrecedentBlock`, `buildPrecedentInjection` — precedent citation scanning/formatting logic (PR #5).
- `src/core/server/jobs/agentTick.ts:~3250` — `buildPrecedentInjection10`, Phase 10 precedent injection into oral-argument/counsel/deliberation/opinion prompts.
- `src/core/server/jobs/agentTick.ts:~3555-3780` — Phase 10 judicial majority-vote tally and damages math, **still inline and untested** (carried over from prior session, still the one remaining untested judicial code path).
- `CourtRecordsPage.tsx` (new, `/court/records`) — dense compliance-style table, debounced search, filters, 50/page.
- `CasePage.tsx` — renders `referencedCases` + `relatedCases` with inline linkification.
- `CourtPage.tsx` — docket scrolls internally when >6 cases (`max-h-[52rem]`).
- `docs/deploy/economy-overhaul-config.sql` — runtime_config jsonb merge applied to prod for the economy overhaul.
- `db/migrations/0026_economy_bigint_rebase.sql` — int4→bigint rebase for all money columns, `transactions.amount` varchar→bigint (guarded DO block), `balance_after` added (`IF NOT EXISTS`), guarded one-time data rebase. Applied to prod after backup `~/pre-economy-overhaul-20260704.dump` on the Linux box.
- `src/modules/agents/server/routes/*` (finances) — new `GET /api/agents/:id/finances`.
- `AgentProfilePage.tsx` — new Finances tab (balance chart from `balance_after`, ledger table, lifetime aggregates); party logo path fixed `.png`→`.webp` (PR #9, was silently 404ing on every profile).
- `formatMoney` shared helper — replaced 3 separate `fmtM` copies + ~20 inline `M$` sites.
- `BudgetPage.tsx` — `$`/day + Daily Revenue + Next Payday tiles.
- `DashboardPage.tsx` — Revenue/Spending 30d tiles wired (previously showed `--`).
- `src/modules/agents/client/hooks/useAgentMap.ts` — removed `salary_payment`/`tax_collected` from location mapping, loop skips unmapped types — fixes a bug where all agents visually teleported to the Treasury on payday.
- Phase 11 crisis ratio fix — was dividing by the old $50,000 seed constant, would never trigger at $1.5T treasury scale; `aggeTick` stress threshold updated to `<5000` accordingly.
- Recent Activity feed: dashboard sidebar/feed alignment fix (PR #7/#8) — absolute-fill in `relative min-h-[440px]` cell; `[&>*:last-child]:mb-0` on last sidebar card.
- `index.html` — real `/favicon.ico` (32px PNG-in-ico via `sips`) declared before the svg; apple-touch-icon shrunk 2048px/4.6MB → 180px/36KB (PR #9).
- `src/core/client/components/EmptyState.tsx` (new) — image/title/hint/compact props, dark-theme scrim; wired to `no-campaigns` (Dashboard), `no-activity` (ActivityPage), `no-bills` (LegislationPage).
- `src/core/client/pages/NotFoundPage.tsx` (new) — 404.jpg + catch-all route.
- `src/core/client/components/icons/index.tsx` (new) — 28 stroke SVGs, unified icon system. Replaced Unicode glyphs in `AdminPage.tsx` `SIDEBAR_TABS`, `GlobalSearch.tsx`, `AgentsDirectoryPage.tsx` `POSITION_ICON`, and emoji in the Tools dropdown; `ActivityFeed` `TYPE_ICONS` migrated to the shared set.
- `src/core/client/components/icons/CapitolIcon.tsx` — deleted as a standalone file, absorbed into the unified icon set as the footer logomark (shows as `D` in `git status` at session start — this is expected, already committed in PR #10 as `aaf21e6`).
- `public/images/parties/pa.webp` — recovered from `dpa.webp` via `git mv`, PARTY_LOGO_MAP updated (PR #12, `b2fbf9f`). Live-verified serving (33,690 bytes, webp content-type).
- `docs/ASSET-GENERATION-TODO.md` (PR #11, `76b5bee`) — self-contained brief for a separate ComfyUI session. Remaining generation targets after PR #12: MC + LFP party logos, map background v2 (3840×2160). **Read the overnight-session memories below before acting on this doc.**
- `docs/archive/IMAGE-ASSETS-BRIEF.md`, `docs/archive/MAP-BACKGROUND-PROMPT.md` — master asset intent specs referenced during the audit.

## Next steps + open questions

1. **Verify first bi-weekly payday (tick 742)** in prod: gross salary + `'tax'`-type withholding ledger rows per officeholder, treasury delta = −net total, `balance_after` populated correctly. Not checked this session — do this first.
2. **Read these memory files before touching asset generation again**: `feedback-art-style-calibration.md` (owner rejected the whole overnight batch as too dark/indistinct — rule: get 3-4 style samples approved before bulk generation), `capitol-map-t2i-verdict.md` (flux1-dev cannot hit the coordinate-pinned map spec via pure T2I; use SVG/code-drawn base + img2img texture pass; native 4K FLUX is pathological on GB10), `incident-2026-07-05-spark1-hang-agent-stalls.md` (spark1 thermal-hung under 4K FLUX load, needed a physical power cycle), `overnight-asset-session-2026-07-05.md` (integration ON HOLD pending owner review; review tree at `Projects/AgoraBench-asset-review-2026-07-05`). `docs/ASSET-GENERATION-TODO.md` predates all of these verdicts — the generation targets (MC/LFP logos, map bg v2) are still correct, but the *approach* must change per the calibration rule.
3. **Spot-check judicial transaction effects on the first `outcome='struck'` case in prod** — carried over, `agentTick.ts:~3555-3780` inline tally/damages math is still untested end-to-end.
4. **Watch first $-scale LLM bill proposals** — clamps should hold at the $75B one-time cap; not yet observed under the new economy scale.
5. **Two console errors seen on dashboard load during Playwright verification** this session, unrelated to assets/layout — undiagnosed, owner aware, not yet investigated.
6. **moltgovernment.com renewal decision** by 2027-02-17 — carried over, no urgency.
- ? Should the rejected overnight asset batch be discarded entirely, or is any of it salvageable after a style recalibration pass? (Owner review of the `AgoraBench-asset-review-2026-07-05` tree is the next step to answer this.)

**Process note for next session**: new feedback memory this session — always close Playwright/MCP browsers immediately after verification (owner called this out again); this applies to subagent instructions too, not just the main session.
