# Sim Review Fixes — 2026-08-16

Source: live sim review at tick ~1263 (findings verified against prod DB, Redis, journald, and code).
Execution doc — each fix is independently shippable. Order matters where noted (F1 gates F2/F3 tuning).

| # | Fix | Priority | Type |
|---|-----|----------|------|
| F1 | Stale 2-min Bull repeatable → tick cadence | P0 | ops + small code |
| F2 | Macro engine growth/impulse units bug | P0 (gates revenue-coupling slice) | debug + code |
| F3 | Floor backlog unbounded (2,003 bills) | P1 | physics mechanic |
| F4 | Elections dead since April | P1 | feature slice |
| F5 | Sam Ritter triple-office retro-vacate | P2 | one-time script |
| F6 | Overseer dormancy (AGGE gated, Bob silent) | P2 | code + ops check |
| F7 | Scanner-probe log noise | P3 | optional tiny |

---

## F1. Stale 2-minute Bull repeatable job (tick cadence)

**Evidence:** `bull:agent-tick:repeat` zset holds TWO members: `__default__:::120000` and `__default__:::5400000`. Config `tickIntervalMs=5400000` (90 min), but ticks fire ms after the previous completes (~11-12 min effective; 34 ticks on 8/16). The 2-min job dates from the Aug 15 restart flurry (service was down Aug 7 11:01 → Aug 15 18:13).

**Root cause:** `startAgentTick()` (`src/core/server/jobs/agentTick.ts:6505`) adds `repeat: { every: rc.tickIntervalMs }` on every boot WITHOUT reconciling existing repeatables. Only `changeTickInterval()` (`:6519`) does the `getRepeatableJobs()` → `removeRepeatableByKey()` cleanup. Any boot under a different config value leaves the old repeatable behind forever.

**Immediate remediation (on 10.0.0.10, no deploy):**
```bash
sudo docker exec molt-gov-redis redis-cli zrem bull:agent-tick:repeat "__default__:::120000"
sudo docker exec molt-gov-redis redis-cli keys 'bull:agent-tick:repeat:*' | xargs -r sudo docker exec molt-gov-redis redis-cli del
systemctl --user restart agorabench
```
The 1 delayed + 3 waiting jobs already enqueued will run once each and not re-schedule — acceptable.

**Durable code fix:** make `startAgentTick()` async-reconcile before adding: `getRepeatableJobs()`, remove any job where `job.every !== rc.tickIntervalMs`, then add (i.e. give boot the same semantics as `changeTickInterval` — or just have boot call `changeTickInterval(rc.tickIntervalMs)`). Log removed stale jobs.

**Verify:** `zrange bull:agent-tick:repeat 0 -1` shows exactly one member matching config; next 3 `tick_log.fired_at` gaps ≈ 90 min.
**Rollback:** none needed (config-intent restoration). If owner wants fast ticking later, use the admin interval control — it goes through `changeTickInterval` and cleans up properly.

---

## F2. Macro engine units/scaling bug

**Evidence:** `world_state` levels are sane (GDP $28.35T, unemployment 3.5%, inflation 4.0%, sentiment 46, regime `expansion`) but `gdp_growth_pct` prints 96.2 / 125.95 and `fiscal_impulse_pct` swings −607 → +365. Rows exist ticks 884–1248 (every ~16 ticks). Observe-only today — nothing reads `world_state` — so zero blast radius, but **this must be fixed before the E5 revenue-coupling slice consumes it**.

**Anchors:**
- `src/core/server/lib/macroMath.ts` `stepMacro()` — `impulsePct = (levelEffect / prev.gdpAnnualized) * 100` (line ~136); pipeline annualization `365/DAYS_PER_QUARTER` (~×4) at lines ~138-140.
- `src/modules/world/server/lib/macroEngine.ts` — assembles `FiscalImpulse {purchases, transfers, tax}` from `laws` structured columns.

**Hypotheses to test (in order):**
1. Impulse fed annualized or cumulative dollars where per-day/per-tick expected (a −607% impulse implies levelEffect ≈ −$170T — orders of magnitude off; check whether the assembly sums the whole active-law stack or all-time enactments instead of the delta since last macro step).
2. `fiscal_tax_delta` unit mismatch — percentage points treated as dollars (or converted against full GDP).
3. Double annualization — `impulsePct` computed against annual GDP then multiplied by `365/DAYS_PER_QUARTER` again in the pipeline.
4. Interaction with F1: the model assumes ticks-as-days; at 2-min cadence macro steps fired ~7.5× faster than design. Re-verify prints after F1 lands before concluding — but 96-126% growth is too large for cadence alone.

**Method:** systematic-debugging — reproduce in a unit test feeding a tick-1263-like law stack into `stepMacro`, assert unit sanity per term (each impulse component as % of GDP < ~5%), localize, fix, regression tests alongside the existing macroMath suite.

**Data decision:** leave existing world_state rows 884–1248 as-is (corrupt columns, observe-only history) — note the fix tick in the PR so charts can window from there.

**Verify:** post-deploy, next 3 macro steps print `gdp_growth_pct` within ±10 and `fiscal_impulse_pct` within ±5 absent mega-bills.

---

## F3. Floor backlog unbounded

**Evidence:** 2,003 `floor` bills queued; inflow 367/day (at continuous cadence) vs throughput cap 5/tick oldest-first (`agentTick.ts:374`); new bills effectively never process. 3,033 laws enacted, 2,450 withdrawn historically. Phase 5.5 withdrawal sweep is OFF (`billWithdrawalEnabled=false`, `agentTick.ts:2105`).

**Do after F1** — real inflow at 90-min cadence is ~16 ticks/day, so re-measure the inflow:throughput ratio first; the mechanic is still needed (proposals/tick > 5 processed/tick) but tuning constants depend on true cadence.

**Fix (physics, not policy — floor time is scarce, sessions end):**
1. **Bill expiry mechanic:** new tick-start sweep — floor bills with `last_action_at` older than `billFloorExpiryTicks` (new RuntimeConfig field, default ~90 ticks ≈ one quarter of session time) transition to a terminal status. Reuse `tabled` unless adding an `expired` enum value is trivial in the schema (check `bills.status` — prefer `expired` for observability). Emits activity event per expired bill (batched log line, not 2,000 spam rows — cap event emission on the one-time first sweep).
2. **Flip `billWithdrawalEnabled=true`** (existing lever, admin toggle — sponsors withdraw failed bills).
3. **Make the floor working-set cap configurable** if it's a hardcoded 5 (`agentTick.ts:374` area) — new RuntimeConfig field `floorWorkingSetSize`, default 5.

**Four-things rule applies** to both new RuntimeConfig fields (server handler branch in `admin.ts` POST /config, AdminPage control, client interface, persistence verify).

**Verify:** first sweep drains the aged portion of the 2,003 backlog (log the count); steady-state floor count plateaus over ~20 ticks; unit tests for the expiry selector.
**Rollback:** `billFloorExpiryTicks=0` disables the sweep (make 0 = off explicit).

---

## F4. Elections revival (minimal slice)

**Evidence:** 2 elections ever (1 certified 2026-04-10, 1 cancelled). Sitting president suppresses all new elections (`agentTick.ts` Phase 14, ~:5612-5655); no registration→campaigning transition; no candidacy mechanic. President unchanged for 4 months.

**Minimal slice (reuses E3 vote-casting, which already works):**
1. `presidentTermTicks` (new RuntimeConfig field; default against ticks-as-days scale — 1,460 ≈ 4 sim-years; owner can dial down) — Phase 14 schedules a presidential election when the incumbent's tenure (derived from `positions.start_date`) exceeds it, INSTEAD of suppressing while seated. Incumbent auto-registers as candidate.
2. Candidacy declaration: at `registration`, each eligible agent gets one cheap LLM yes/no (approval, party, relationship-to-incumbent in prompt); yes → campaign row (`status='active'`).
3. Wire the missing transitions: `registration→campaigning` after `registrationDeadline`, `campaigning→voting` at `votingStartDate` (fields already exist on `elections`), then existing voting-window + `finalizeElection` path takes over. E3's vacate-lower-offices rule fires on certification.

**Four-things rule** for `presidentTermTicks`. Congress term elections = explicitly OUT of this slice (follow-up).

**Verify:** force a term-expired state in a test DB (or temporarily set `presidentTermTicks` low in prod after owner ok), watch one full registration→certified cycle; confirm campaigns page populates and calendar shows the election.

---

## F5. Sam Ritter triple-office retro-vacate

**Evidence:** sam-ritter holds `president` + `congress_member` + `committee_chair` (Technology) simultaneously — predates the E3 vacate-on-higher-office rule (which the owner already approved as default behavior). Note: chair+member together is LEGITIMATE for non-presidents (desmond-park) — chairs are held by members. Only the president's lower offices are wrong.

**Fix (one-time, on prod):** end sam-ritter's `congress_member` and `committee_chair` position rows (`is_active=false`, `end_date=now()`); let Phase 14 auto-fill the congress vacancy and Phase 0.5 chair succession pick a new Technology chair on the next tick. Take a pre-change pg_dump table snapshot of `positions` first.

**Verify:** next tick log shows vacancy fill + chair succession; `/government` overview shows 3 distinct people in the 3 roles; payroll (next payday tick) pays sam-ritter ONE salary.
**Rollback:** restore the two position rows from the snapshot.

---

## F6. Overseer dormancy

**Evidence:** `orchestrator_interventions` has 0 rows EVER — Bob has never called intervene. AGGE is fully disabled because `BOB_ORCHESTRATOR_KEY` is set (existing TODO acknowledges these are separate concerns).

**Fix:**
1. Code: remove the BOB-key gate on AGGE's schedule (`src/core/server/jobs/aggeTick.ts`) — AGGE runs on its own interval regardless of orchestrator presence. Keep a plain `aggeEnabled` RuntimeConfig gate (four-things rule if it doesn't already exist) so it ships dark and gets flipped deliberately.
2. Ops check (not this repo): on openclaw/bspark1, check Bob's session/cron — why zero observe/intervene calls since April. If Bob is retired as an experiment, note it and rely on AGGE alone.

**Verify:** after flipping `aggeEnabled`, `agge_interventions` gains rows and the admin AGGE tab reflects them.

---

## F7. Scanner-probe log noise (optional)

**Evidence:** WP/probe paths (`/wp-includes/...`, `/goods.php`) all get HTTP 200 via the SPA catch-all — harmless (index.html served) but pollutes `/tmp/agorabench.log` and inflates 200-counts.

**Fix (pick one, tiny):** middleware before the SPA catch-all returning 404 for a small prefix list (`/wp-`, `/.well-known/*.php`, `*.php`) — nothing legitimate in this app serves `.php`; or simply skip HTTP-logging those paths. Prefer the 404 (also stops probes reading a 200 as a hit).

**Verify:** `curl -s -o /dev/null -w '%{http_code}' https://agorabench.com/goods.php` → 404; SPA routes unaffected (`/world`, `/divergence` still 200).
