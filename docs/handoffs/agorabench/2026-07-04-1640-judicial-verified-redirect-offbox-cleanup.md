# Handoff — Judicial verification, dead-infra retirement, redirect, off-box backups, cleanup

**Date**: 2026-07-04 16:40
**Project**: AgoraBench
**Branch**: main (clean — 0 modified, 0 untracked, this handoff file itself untracked)
**Session topic**: Post-handoff operations day — verified judicial Phase 10 live, retired dead Cloudflare infra and the legacy domain, automated off-box DB backups, fixed design-brief data bugs, wired the dashboard ElectionBanner to real election data, added judicial regression tests, root-caused the owner's recurring network drops, synced to the owner's Vault reorganization, and closed with a full truth-sync of docs/memory after the owner called out stale-checklist recycling.

## State + in-progress work

Everything in this session is **shipped and closed**, not in-progress. No mid-edit state, no blocked work.

- **Code**: main @ `71f3b62`, pushed to origin.
- **Deploy**: Linux box (10.0.0.10) is running through `c2c9848` (last app-code commit). Commits `0df49d3` (tests) and `71f3b62` (docs) are on origin but **not yet pulled on the box** — both are non-runtime (test files + docs), so no deploy is required for them. Next deploy cycle can just pick them up incidentally.
- **Tests**: 288/288 green (includes 90 new judicial regression tests + 12 new ElectionBanner tests from this session).
- **Live site**: verified healthy in a real browser — judicial lifecycle confirmed end-to-end in prod data, redirect confirmed 301→200 with path/query preserved, dashboard banner confirmed correctly absent (no active election).
- This handoff file is intentionally left **untracked** (repo hook blocks direct edits on main) — commit it next session.

## Decisions + reasoning

- **Redirect moltgovernment.com to agorabench.com (301/308) rather than letting it go dark** — Why: registration is paid through 2027-02-17, redirect is free and preserves months of old inbound links. Implemented app-layer (Express middleware) because the Vault-stored CF token has no edge-redirect permissions (zone Rulesets / Page Rules / account Bulk Redirects all return 403 — token scope is DNS + tunnels only).
- **Kept the old domain's CORS allowlist entries** in `src/core/server/index.ts` rather than removing them — Why: stale open browser tabs on the old domain keep working through the redirect instead of hitting CORS failures.
- **mac-mini-homelab Cloudflare tunnel (`dcca6d94`) deleted, all 16 DNS records deleted** — Why: proved via bobclaw's own AgentMesh memory (`homelab-state.md`: "Vaultwarden retired 2026-05-23") and a dead Docker daemon on bobclaw that every backing service was already decommissioned. Snapshotted first to `/Volumes/DevDrive-M4Pro/Backups/homelab/cloudflare-dns-mac-mini-homelab-dcca6d94-20260704.json`.
- **Vaultwarden DB on bobclaw's colima VM declared not worth extracting** — Why: owner confirmed a Jan-6 docker backup with an old `db.sqlite3` already exists on bobclaw's NetworkBackup; that's sufficient. Do not revisit.
- **5 dangling DNS records at deleted tunnel `396cb7ba`, then 5 Clerk CNAMEs + 1 malformed junk record, all deleted from the moltgovernment.com zone** — Why: Clerk prod is bound to `clerk.agorabench.com` (verified by decoding the live publishable key), so the old-domain Clerk records were inert dead weight. Zone snapshotted first (`Backups/homelab/cloudflare-dns-moltgovernment-zone-20260704.json`).
- **Zone left with only apex, www, and demo (solvonex tunnel)** — the demo record is unrelated to this project and was deliberately left alone.
- **Claude Design (claude.ai/design) iteration for the UI revamp is SHELVED** — Why: owner determined generations weren't capturing his intent; the design happens directly in code now, with `docs/design-briefs/01`–`06` as the intent spec. The design project (`70f66545`) is kept only for genuinely new pages in the future, not as the primary design loop.
- **No notification channel for `agorabench-watch`** — Why: owner explicitly declined ("I don't need a site down ping thing"). Log-only is final. **Do not re-propose.**
- **Off-box backups implemented as rsync + systemd timer to bobclaw, log-only (no alerting), 90-day remote retention** — Why: matches the owner's stated risk tolerance (nightly local dump already exists at 14-day retention; this just adds geographic redundancy without adding alert noise the owner doesn't want).
- **`IdentitiesOnly=yes` required on the off-box backup SSH key** — Why: bobclaw has 8+ authorized keys and trips `MaxAuthTries` without it.
- **bobclaw's degraded 100BASE-TX ethernet link parked, not pursued further** — Why: owner diagnosed and deliberately deprioritized it (works at 100M; a forced-gigabit link test failed, proving at least 2 dead pairs; remaining suspects are the router port/jack or cable, not host-side). Only revisit if the owner raises it again.
- **Postgres WAL archiving stays off** — Why: accepted risk; nightly pg_dump + new off-box copy is judged sufficient protection for this project's stakes.
- **/privacy and /terms pages reviewed and declared final, no lawyer needed** — Why: content verified against actual site behavior (GA4 consent-mode description matches implementation, Clerk disclosure correct, no placeholder text). Note: these pages were originally written by this same Claude persona the prior day (2026-07-03) and re-reviewed fresh today — treat as closed, not as an owner TODO.

## File paths + line refs

- `src/core/server/index.ts` — moltgovernment.com → agorabench.com redirect middleware (commit `0d3997a`); old-domain CORS allowlist entries deliberately retained nearby.
- `src/modules/government/server/routes/government.ts` — `totalSeats` now derives from `runtimeConfig.congressSeats` instead of a hardcoded `50` (commit `2830526`).
- `src/modules/elections/client/components/BranchCard.tsx` — added `vacant` + `icon` props, removed hardcoded `/images/branches/*.webp` paths (commit `58e2013`).
- `src/core/shared/constants.ts` — `WS_EVENTS` rebuilt from the 38 events actually emitted server-side (commit `2830526`); old constant listed 5 events that were never emitted.
- `src/modules/elections/client/hooks/useActiveElection.ts` — new shared hook, fetches `/api/elections/active`, refetches on election WS events (commit `c2c9848`).
- `src/modules/elections/client/*activeElectionBanner*` — pure derivation module for banner target date, precedence: `votingEndsAt` → `votingStartsAt` → `scheduledDate` (commit `c2c9848`).
- DashboardPage — renders `ElectionBanner` only when a real active election exists (commit `c2c9848`).
- ElectionsPage — refactored onto `useActiveElection` hook, byte-identical output to prior implementation (commit `c2c9848`).
- `src/core/server/jobs/agentTick.ts:~3555-3780` — Phase 10 judicial majority-vote tally and damages math, **still inline and untested** (not extracted to a pure module); this is the one remaining untested judicial code path.
- `tests/unit/server/judicialParsing.test.ts` — 50 tests: vote keywords, garbage/ambiguous input, citation parsing (commit `0df49d3`). Documents a known-harmless quirk: `parseCitedArticles` coerces boolean `true` → citation `[1]` via `Number()`.
- `tests/unit/server/courtMath.test.ts` — 40 tests: court case stage-gate timing (commit `0df49d3`).
- `docs/TODO.md` — rewritten to EOD reality (commit `71f3b62`); new **"Decisions (do not re-propose)"** section added — read this before proposing any work next session.
- `docs/handoffs/agorabench/2026-07-04-0937-rename-judicial-design-sync.md` — marked SUPERSEDED (commit `71f3b62`).
- `docs/design-briefs/01`–`06` — UI revamp intent spec (code-first now, not Claude Design-first).
- `~/bin/agorabench-offbox.sh` + `agorabench-offbox.{service,timer}` (on Linux box, not in repo) — daily 10:00 UTC rsync of pg_dumps to `bobclaw:/Volumes/NetworkBackup/Backups/agorabench/`, verifies newest dump by exact size, logs to `~/agorabench-offbox.log`.
- `~/.ssh/id_ed25519_offbox_backup` (Linux box) — dedicated backup key, authorized on bobclaw with `from="10.0.0.10,10.0.0.101"` + no-forwarding restrictions.
- Memory: `judicial-phase10-live-verified.md`, `vault-cloudflare-paths.md` (fully rewritten for the new Vault tree — includes the token's no-redirect-perms scope and an account-owned-token verify-endpoint gotcha).
- Vault: CF creds now at `Secrets/cloud/cloudflare` (moved from the old `services/cloudflare` path during the owner's reorg); `auth/clerk` updated to live keys as v2 (test pair kept as `_test` fields); `CREDENTIALS.md` secret-map row updated to match.
- Backups (off-repo): `/Volumes/DevDrive-M4Pro/Backups/homelab/cloudflare-dns-mac-mini-homelab-dcca6d94-20260704.json`, `.../cloudflare-dns-moltgovernment-zone-20260704.json`, `/Volumes/DevDrive-M4Pro/Backups/AgoraBench/agorabench-stash{0-earlydocs,1-png-compress}.patch`.

## Next steps + open questions

1. **Spot-check judicial transaction effects the first time a case ends `outcome='struck'` in prod** (law flip + `court_damages` + approval deltas) — this is the only verification path left for the untested inline tally/damages math at `agentTick.ts:~3555-3780`. Check `court_cases` occasionally, or watch for a ruling WS event mentioning striking.
2. **UI revamp per `docs/design-briefs/`** — start with `01` (broadcast dashboard) and `02` (hemicycle votes), implemented directly in code. Only re-engage the Claude Design project (`70f66545`) if it's used for a genuinely new page.
3. **Postgres WAL archiving** — remains off, accepted risk. No action unless the owner revisits.
4. **moltgovernment.com renewal decision** — registration expires 2027-02-17. Decide renew-vs-let-redirect-die closer to that date.
5. **Pull `0df49d3` and `71f3b62` onto the Linux box** at the next natural deploy — no urgency, non-runtime commits.
- ? None outstanding beyond the above — this was a closing/cleanup session, not one that generated new unknowns.

**Process note for next session**: the owner flagged a recurring failure pattern — reciting already-completed items back to him (tunnel-token chore, done twice), re-proposing a declined feature (notification channel), and framing verifiable Claude work as an owner TODO (privacy/terms review). Before proposing work: check `docs/TODO.md`'s "Decisions (do not re-propose)" section first, and if something can be verified or finished directly instead of being handed to the owner, do that.
