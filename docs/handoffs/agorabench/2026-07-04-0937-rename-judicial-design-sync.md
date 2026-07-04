# Handoff — Rename completion, judicial Phase 4 ship, and Claude Design sync

**Date**: 2026-07-04 09:37
**Project**: AgoraBench
**Branch**: main (0 modified, 0 untracked)
**Session topic**: Finished the Molt Government → AgoraBench rename, hardened deploy infra, fixed a class of spectator UI bugs, shipped the Phase 4 judicial system end-to-end, and completed a Claude Design design-system + revamp-brief sync — one continuous session spanning a mid-session machine crash/recovery.

---

## State + in-progress work

Everything below is **shipped and merged to `main`** (HEAD `af580cb`, pushed to origin). Working tree is clean. All 183 tests pass. Live site is healthy (200 OK, systemd unit active).

- **Rename (Molt Government → AgoraBench)** — complete and verified end-to-end this session. Mac repo path, Linux deploy path, GitHub repo name, Claude project keys, launchd agents, dead SSH aliases all migrated/retired. See "Decisions" for what was deliberately left un-renamed.
- **Deploy infra hardening** — complete. `agorabench.service` systemd user unit (documented in an earlier commit `bb26be9` but never actually installed) is now installed and live; cut over from bare `nohup` with ~5s downtime. Nightly pg_dump timer and a 10-min watch timer are standing (from parallel sessions, verified still running).
- **Cloudflare/Vault token saga** — resolved. The account-owned Cloudflare token is valid until 2028-01-11 and wired everywhere it needs to be. A previously-leaked token is confirmed dead and purged from plaintext locations.
- **Site features** — GA4 (Consent Mode v2) + cookie banner + privacy/terms pages: deployed and live.
- **Spectator bug class** (`{data:{events,total}}` unwrap bug) — fixed in all three consumers (capitol map, LiveTicker, dashboard activity list), deployed, verified live.
- **Judicial Phase 4** — the session's centerpiece, shipped as merge `c526e73`. Full state machine, schema, UI, wiki, admin config all merged and deployed to the Linux box.
- **Claude Design sync** — complete. New project created, 21 components synced, all preview cells graded good, zero floor cards. Durable inputs merged to `main` at `e5c5b0a`.
- **Design revamp briefs** — complete, uploaded to the design project's guidelines folder. Owner's plan is to iterate briefs 01 (broadcast dashboard) and 02 (hemicycle votes) first in Claude Design.

**Not yet verified — this is the actual loose end:**
- The **first live execution of the judicial Phase 10 inside a real tick** was still unconfirmed when this session ended. A log watcher (Monitor) was armed but is session-scoped and dies with the session. **Next session must check this first** (see Next Steps #1, task #21 has the full checklist).
- Two owner-facing dashboard chores are pending (not blocking, just not done): deleting 10 auto-minted Cloudflare tunnel tokens, and skimming `/privacy` + `/terms` page wording.

---

## Decisions + reasoning

- **Kept Docker/DB internals on the old `molt-gov`/`molt_government` naming** (containers `molt-gov-postgres`/`molt-gov-redis`, volumes `molt_gov_pgdata`/`molt_gov_redis`, DB `molt_government`, user `molt_gov`, compose project name pinned `molt-government` in `docker-compose.yml`).
  Why: these are internal identifiers with zero user-facing value in renaming, and touching them (volume renames, DB renames) carries real data risk for no payoff. Do not "finish" this rename.
- **Judicial migration `0007_first_black_tarantula.sql` applied directly via `psql` on prod**, not through `drizzle-kit migrate`.
  Why: the box's migration journal is empty by design — this project uses a push-style workflow (`drizzle-kit push`), not the migrate/journal workflow. Never run `db:migrate` on prod without first backfilling the journal, or it will try to replay everything.
- **Phase 10 (judicial) built as a restart-safe multi-tick state machine**, not a single-tick monolith.
  Why: an LLM-heavy phase (~11 calls/tick worst case: filing → docketed → hearing → deliberation → opinion) can't safely assume it completes atomically within one tick if the process restarts mid-flight; state is persisted in `court_cases`/`court_case_events` so it resumes correctly.
- **First use of DB transactions in the codebase** (drizzle/postgres-js) for judicial effects (law flip, court_damages, approval deltas, relationships).
  Why: these effects must be atomic — a partial application (e.g., damages transferred but law not flipped) would corrupt sim state. This is a new runtime pattern other future multi-effect phases should copy rather than reinvent.
- **`.btn-gold` documented as unavailable** in the Claude Design conventions header (it's purged from compiled CSS).
  Why: without this note, the design agent would keep referencing a class that silently does nothing in the real app; better to steer it toward what's actually shipped.
- **Design briefs uploaded to the design project's `guidelines/` folder + `guidelinesGlob` added to `.design-sync/config.json`**, rather than only living in the repo.
  Why: the design agent reads guidelines natively from the project; wiring the glob into config means future re-syncs carry the briefs forward automatically instead of requiring a manual re-upload.
- **Owner explicitly deferred two decisions rather than having them made for him** — see Open Questions. Both involve either DNS/Vaultwarden availability or a public redirect decision, judged values/positioning calls, not obvious lookups.

---

## File paths + line refs

### Rename / infra
- `docker-compose.yml` — compose project pinned `name: molt-government` (intentionally unchanged)
- `~/.config/systemd/user/agorabench.service` on Linux box 10.0.0.10 (not in repo) — `ExecStart=/usr/bin/pnpm run start`, `Restart=always`/`RestartSec=10`, logs appended to `/tmp/agorabench.log`
- `~/.ssh/config.bak-cleanup` (Mac) — backup taken before removing dead `gitea`/`gitea-ts` aliases
- `/Volumes/DevDrive-M4Pro/Backups/AgoraBench/claude-project-key-Molt-Goverment-20260702.tar.gz` — archived old Claude project key

### Spectator bug fixes
- `src/.../useAgentMap.ts` — commit `7c4bd49` — unwrap `{events, total}` from `/api/activity` (bug present since Feb 20; every agent had silently defaulted to `'party-hall'`)
- LiveTicker component — commit `9b9cb4d` (unwrap) and `1aa81cd` (query eligible activity types via new `activityApi.forType`, since rare events were being drowned by vote spam in the recent-100 window)
- DashboardPage activity list — commit `9b9cb4d`

### Judicial Phase 4 (merge `c526e73`)
- `src/core/db/migrations/0007_first_black_tarantula.sql` — new tables `court_cases`, `court_case_events`, `court_case_votes` (applied directly via psql on prod)
- `src/core/shared/constitution.ts` — 8-article Constitution referenced by justices during deliberation
- `src/core/server/lib/judicialParsing.ts` — exact-vocabulary vote/citation parsing from justice LLM output
- Phase 10 tick logic — filing (Engine-7 challenges by lowest-approval nay voters + 25% deal disputes) → docketed → `judicial_hearing` governmentEvents insert → oral arguments (`Promise.allSettled` walls) → deliberation (7 justices) → opinion + dissent → effects (laws.isActive flip, court_damages transactions, approval deltas, relationships)
- `src/core/server/runtimeConfig.ts` — 7 new fields incl. `courtEnabled` kill switch, fully wired per the "four things" rule (server handler, UI control, client interface, persistence verified)
- Admin UI — new "Supreme Court" section
- `CourtPage` — docket board: stat tiles, 5-dot stage tracker, filters, legacy archive of 459 `judicial_reviews` preserved read-only at `/api/court/archive`
- `CasePage` — three-act courtroom: letterboxed supreme-court interior, bench seated by seniority (chief center), `SpeechBubble` transcripts, verdict banners, opinion reader with citation chips → `ConstitutionDrawer`
- `LawsPage` — dead badge links fixed in commit `9cf484b` (found by workflow reviewer)
- WS events `court:case_filed` / `court:hearing` / `court:ruling` wired into map + ticker

### Claude Design sync
- `.design-sync/config.json`, `.design-sync/NOTES.md`, `.design-sync/conventions.md`, `.design-sync/previews/`, `.design-sync/overrides/` — merged to main at `e5c5b0a`
- `app-compiled.css` — compiled Tailwind snapshot used as the design agent's style ground truth
- `resync.mjs` — re-sync entry point; anchors on the project's `_ds_sync.json`
- Design project: https://claude.ai/design/p/70f66545-6dc2-47c6-a5a3-f3c0fd87576d (projectId `70f66545-6dc2-47c6-a5a3-f3c0fd87576d`) — **do not confuse with** the owner's unrelated older "Design System" project `111d3508`
- Build ran in worktree `.claude/worktrees/design-sync` (branch `chore/design-sync`, now merged); `ds-bundle/` is regenerable, worktree can be cleaned up
- `docs/design-briefs/` — commit `af580cb`, 7 files / 1551 lines: `README.md` + `01-broadcast-dashboard.md` + `02-hemicycle-votes.md` + `03-bill-journey.md` + `04-gazette-front-page.md` + `05-election-night.md` + `06-agent-dossiers.md`

### Memory files updated this session
- `~/.claude/projects/-Volumes-DevDrive-M4Pro-Projects-AgoraBench/memory/project-paths.md`
- `~/.claude/projects/-Volumes-DevDrive-M4Pro-Projects-AgoraBench/memory/gitea-decommissioned-no-db-backup.md`
- `~/.claude/projects/-Volumes-DevDrive-M4Pro-Projects-AgoraBench/memory/vault-cloudflare-paths.md`
- `~/.claude/projects/-Volumes-DevDrive-M4Pro-Projects-AgoraBench/memory/claude-design-system.md` (new)

---

## Next steps + open questions

1. **[Priority] Verify the first live judicial Phase 10 execution completed inside a real tick.** `grep` `/tmp/agorabench.log` on 10.0.0.10 for the judicial phase; confirm a case was filed and progressed through the stages. Full checklist is under task #21. Kill switch if something's wrong: set `courtEnabled=false` in admin.
2. Add regression test coverage for `courtMath` / `judicialParsing` — noted gap under task #12 (test hardening).
3. Owner dashboard chores (not blocking, low effort): delete the 10 auto-minted "Cloudflare Tunnel API Token" management-plane tokens (confirmed safe — running tunnels use their own connector creds); skim `/privacy` and `/terms` wording (currently template text).
4. Fix data bugs surfaced during design-brief research (task #22): hardcoded `totalSeats` = 50, `BranchCard` 'Vacant' state, `ElectionBanner` null `targetDate` handling, stale `WS_EVENTS` const.
5. `BranchCard` hardcodes `/images/branches/*.webp` — causes broken icon chips in Claude Design generations. Candidate fix: switch to an `icon` prop. Not yet implemented.
6. When picking up design-brief iteration: start with briefs 01 (broadcast dashboard) and 02 (hemicycle votes) per owner's stated plan, in the Claude Design project linked above.
7. Ops follow-ups bucket (task #19): notification channel for `agorabench-watch` (currently log-only), off-box backup automation (nightly pg_dump exists but is on-box only), and the two orphaned-tunnel decisions below.
- ? **mac-mini-homelab tunnel (`dcca6d94`) is DOWN** while still owning DNS for 15 subdomains, including `vault.myroproductions.com` (Vaultwarden) and `grafana`. Fix or retire? Owner has not decided — flagged, not resolved.
- ? **`moltgovernment.com` apex/www CNAME dangles** at the deleted `molt-government` tunnel. Redirect to `agorabench.com` or let it go dark? Note: some CORS keep-alive code assumes a redirect that doesn't currently exist — worth checking before deciding.
- ? Process note: during design-brief research this session, a doc-research subagent overstepped scope (wrote + merged + pushed changes itself rather than just reporting). Output was verified clean and kept as-is, but watch for this pattern recurring in future subagent dispatches.
