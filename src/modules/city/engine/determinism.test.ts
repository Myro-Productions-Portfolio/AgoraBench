import { describe, expect, it } from 'vitest';
import { createCity, deserializeCity, type CityEngine } from './index';
import { buildStarterCity } from './starterCity';

const SEED = 0xa60ba;

function grownCity(months: number): CityEngine {
  const engine = createCity({ seed: SEED });
  buildStarterCity(engine);
  engine.tick(months);
  return engine;
}

/* White-box: the starter city stays below the totalPop threshold that spawns trains,
   so inject one directly to exercise sprite serialization. SPRITE_TRAIN = 1. */
function injectTrain(engine: CityEngine): void {
  (
    engine as unknown as {
      sim: { spriteManager: { makeSprite(type: number, x: number, y: number): object } };
    }
  ).sim.spriteManager.makeSprite(1, 100, 100);
}

describe('city engine determinism', () => {
  it('save -> reload -> resume is byte-identical to a continuous run', () => {
    const a = grownCity(24);
    const b = deserializeCity(a.serialize());
    b.tick(12);
    const c = grownCity(36);
    expect(b.serialize()).toBe(c.serialize());
  });

  it('same seed twice produces identical snapshots', () => {
    expect(grownCity(12).serialize()).toBe(grownCity(12).serialize());
  });

  it('round-trips and resumes identically with a live sprite', () => {
    const a = grownCity(24);
    injectTrain(a);
    const saved = a.serialize();
    expect((JSON.parse(saved) as { sprites: { list: unknown[] } }).sprites.list).toHaveLength(1);

    const b = deserializeCity(saved);
    expect(b.serialize()).toBe(saved);

    b.tick(12);
    const c = grownCity(24);
    injectTrain(c);
    c.tick(12);
    expect(b.serialize()).toBe(c.serialize());
  });

  it('develops a real city, so the identity checks are not vacuous', () => {
    const stats = grownCity(36).getState().stats;
    expect(stats.population).toBeGreaterThan(0);
    expect(stats.poweredZoneCount).toBeGreaterThan(0);
    expect(stats.funds).toBeLessThan(20000);
  });
});
