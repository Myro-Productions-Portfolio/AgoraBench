# Engine notes for Slice 2 — verified facts

All facts below were read from the vendored source and/or verified by running the smoke
harness (`pnpm city:smoke`) at commit time.

## Time

- 1 city-month = 4 `cityTime` units = 4 full 16-phase simulation cycles = **64 `simTick()` frames**.
  The wrapper's `tick(months)` runs exactly that; `serialize()` only permits month boundaries.
- 1 year = 48 `cityTime`. Tax collection + budget + city evaluation fire every 48 `cityTime`
  (each January). 10-day census every 4 `cityTime` (monthly), 120-day census every 40.
- Calendar starts at year 1900, month 0.

## Map

- Default **120 × 100** tiles (`GameMap` default; generator seeded 1:1 from `createCity({seed})`).
- Tile raw value: bits 0-9 = tile id (`BIT_MASK 0x3ff`), flags: ZONE `0x0400`, ANIM `0x0800`,
  BULL `0x1000`, BURN `0x2000`, COND `0x4000`, POWER `0x8000`. `getState().tiles` returns raw values.

## Knobs (`setKnobs`) — what the engine actually supports

| Knob | Engine field | Range | Default | Notes |
|---|---|---|---|---|
| `taxRate` | `budget.cityTax` | integer 0–20 | 7 | Feeds the 21-entry valve `taxTable`; effect on revenue at next January. |
| `roadFunding` | `budget.roadPercent` | 0–1 | 1 | Roads + rail maintenance. Effect: `roadEffect` 0–32. |
| `fireFunding` | `budget.firePercent` | 0–1 | 1 | Effect: `fireEffect` 0–1000. |
| `policeFunding` | `budget.policePercent` | 0–1 | 1 | Effect: `policeEffect` 0–1000. |
| `disastersEnabled` | `disasterManager.disastersEnabled` | bool | false | Fire/flood/tornado/monster rolls each cycle. |

- **Funding percentages are desired levels, not guarantees**: every January
  `_calculateBestPercentages` overwrites them with what the treasury can afford
  (priority road → fire → police). Set them each tick if you want them pinned.
- **RCI valves are NOT settable.** `resValve`/`comValve`/`indValve` (ranges ±2000/±1500/±1500)
  are recomputed from census + tax + gameLevel every 2nd sim cycle by `Valves.setValves`;
  a direct write is overwritten within one month. The spec §3 GDP-regime → valve coupling
  needs a small physics seam added to `valves.js` in Slice 2 (e.g. an additive external-demand
  bias term). This is the one place Slice 2 must touch upstream code.
- Fixed at construction: `LEVEL_EASY` (maintenance ×0.7, tax yield ×1.4), `SPEED_SLOW`
  (most frequent scan cadence — speed changes scan physics, not wall-clock, in headless use).

## Money

- New city starts with **$20,000** (`totalFunds`). Tax revenue = `floor(floor(totalPop *
  landValueAverage / 120) * cityTax * 1.4)` each January.
- Build costs: res/com/ind zone 100, road 10/tile (50 over water), rail 20/tile, wire 5/tile,
  park 10, police/fire 500, coal 3000, port 3000, stadium 5000, nuclear 5000, airport 10000,
  bulldoze 1/tile.

## Population / stats

- `population` (= `evaluation.cityPop`) `= (resPop + 8*(comPop + indPop)) * 20`.
  City class thresholds: TOWN >2k, CITY >10k, CAPITAL >50k, METROPOLIS >100k, MEGALOPOLIS >500k.
- `census.totalPop` (a different number: `resPop/8 + comPop + indPop`) gates behaviors,
  e.g. train sprites only spawn once it exceeds 10.

## Serialization

- `serialize()` → JSON string capturing full state: tiles, all 16 block maps + power grid,
  census (incl. 120-entry history arrays), valves (incl. caps), budget, evaluation, disaster
  state, sprites, sim counters, and **PRNG state**. Verified byte-identical across
  save → reload → resume vs continuous run (`pnpm city:smoke` + `determinism.test.ts`).
- Size at month 24 of the starter city: **~116 KB raw, ~8.1 KB gzipped** (fits the
  `city_snapshots` per-tick budget comfortably).

## Surprises / gotchas

- Upstream HEAD is broken headless in two places we had to patch: a bare-`budget`
  ReferenceError at every census boundary, and a `crimeScan` whose loop bounds were undefined
  (crime map silently never updated). See PROVENANCE.md for all six patches.
- The engine stalls waiting for a "budget window" whenever it wants user confirmation
  (January with autoBudget off, or treasury shortfall). The wrapper auto-confirms with
  current funding levels after every frame — never drive `simTick()` without that handling.
- Sprites (trains etc.) only move via the browser animation loop (`moveObjects`), which we
  never call: headless sprites spawn and sit static. Harmless; they are serialized anyway.
- The first `simTick()` of a fresh city runs a one-shot initial evaluation (~100 PRNG draws);
  deserialization skips it via the `_skipInitialEvaluation` patch — resume would otherwise
  diverge from a continuous run.
- Disasters default **off** and, when off, consume no PRNG draws (safe for MVP determinism).

## Licensing (verified against `micropolis/LICENSE` + `COPYING`)

GPL-3.0 (COPYING is the stock GPLv3 text) + EA §7 additional terms (trademark, notices,
indemnity, mark-modified-versions). GPLv3 obligations trigger on *conveying*; "mere
interaction with a user through a computer network, with no transfer of a copy, is not
conveying" — so **running the engine server-side and serving city state/rendered output
creates no source-distribution obligation** (that clause is AGPL-only, and this is not AGPL).
Spec §2's claim is confirmed. One standing constraint: the backend now in-process-links GPL
code, so the backend may never be *distributed* to third parties without GPL compliance —
running it on our own server is unrestricted, and no GPL code may enter the client bundle
(verified absent from `dist/client` after build).
