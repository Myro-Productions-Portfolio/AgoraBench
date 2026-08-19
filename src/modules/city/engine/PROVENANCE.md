# Provenance — vendored micropolisJS core

- **Upstream:** https://github.com/graememcc/micropolisJS
- **Vendored commit:** `f13a1624d111d235e804bd80f48ba7c9f66a8e0f` (2026-08-17)
- **License:** GPL-3.0 with EA additional terms — see `micropolis/LICENSE`, `micropolis/COPYING`,
  `micropolis/MicropolisPublicNameLicense.md`. **Server-side only: nothing under
  `src/modules/city/engine/` may ever be imported by client code** (keeps GPL out of the
  browser bundle; the spectator renderer is written from scratch).
- **Scope:** the 56-file simulation core (`micropolis/*.js`, `*.ts` — map generation, zones/RCI,
  budget, traffic, power, valves, census, evaluation, disasters, sprites, tools). UI modules
  (DOM windows, canvas, input, storage, jQuery-dependent queryTool/gameTools/text) were not
  vendored; the set is import-closed with zero external dependencies.
- **Reference:** https://github.com/andrewedunn/hallucinating-splines (`9a50360b`) was studied
  for which patches make the engine headless. No code was taken from it.

## Local patches to upstream files

Each site is marked with a `PATCH(agorabench)` comment.

1. **`random.ts`** — `Math.random` replaced with a seedable mulberry32 PRNG; added
   `seedRandom` / `getRandomState` / `setRandomState`. Determinism + snapshot-able PRNG state.
2. **`simulation.js`** — fixed upstream bug: bare `budget` → `this.budget` in the phase-9
   `take10Census` / `take120Census` calls (ReferenceError at the first census boundary).
3. **`simulation.js`** — added `_skipInitialEvaluation()` so a deserialized instance can skip
   the one-shot initial-evaluation wrapper (it consumes ~100 PRNG draws a continuous run
   would not repeat).
4. **`eventEmitter.js`** — listener storage moved from a per-decoration closure (shared by all
   instances of a decorated constructor) to a non-enumerable per-object slot. The shared store
   cross-wired coexisting engine instances and grew without bound in a long-running process.
5. **`boatSprite.js`** — removed dead `SpriteConstants` named import (no such export; Node ESM
   rejects the module graph over it, webpack only warned).
6. **`blockMapUtils.js`** — `crimeScan` loop bounds used non-existent `mapWidth`/`mapHeight`
   (upstream regression; the scan silently never ran) → `gameMapWidth`/`gameMapHeight`.
7. **`valves.js`** — external RCI demand seam (Slice 2, spec §3): the upstream valve
   integrator now runs on new `resBase`/`comBase`/`indBase` fields (identical arithmetic);
   the visible `resValve`/`comValve`/`indValve` become base + injectable
   `externalOffset{Res,Com,Ind}` (default 0), re-clamped to the native ranges, caps
   re-applied. All offsets 0 = byte-identical dynamics to upstream. Exposed through the
   wrapper as `setExternalDemand({r,c,i})`; snapshot version bumped 1 → 2 (valve state
   gained fields).

## Tile artwork served to the client (2026-08-19)

`images/tiles.png` from the same pinned commit is vendored at
`public/images/micropolis-tiles.png` and shipped to the browser as a static
asset for the spectator sprite renderer. This does not breach the code-side
GPL wall above: the sheet is an art asset (data), not linked code — nothing
under `src/modules/city/engine/` is imported by the client bundle. Attribution
and provenance (upstream URL, pinned commit, sha256, license pointers) live
beside the asset in `public/images/MICROPOLIS-TILES-ATTRIBUTION.md`.

## Local additions (not upstream code)

- `micropolis/*.d.ts` — minimal type shims for the untyped `.js` modules the wrapper imports.
- `index.ts`, `types.ts` — public headless wrapper (create/tick/build/knobs/serialize).
- `starterCity.ts`, `smoke.ts`, `determinism.test.ts` — harness (`pnpm city:smoke`) + tests.
