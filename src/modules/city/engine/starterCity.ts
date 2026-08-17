/* Deterministic starter layout used by the smoke harness and determinism test:
 * coal plant, two powered zone rows (5R/2C/3I) with road frontage, a wire drop
 * crossing the road, and a rail strip (exercises train-sprite generation). */

import type { BuildToolName, CityEngine } from './index';
import { BULLBIT, BIT_MASK } from './micropolis/tileFlags';
import { DIRT } from './micropolis/tileValues';

const SITE_W = 18;
const SITE_H = 14;

function isClearable(raw: number): boolean {
  return (raw & BIT_MASK) === DIRT || (raw & BULLBIT) !== 0;
}

function findSite(width: number, height: number, tiles: number[]): { x: number; y: number } {
  for (let y = 2; y <= height - SITE_H - 2; y++) {
    for (let x = 2; x <= width - SITE_W - 2; x++) {
      let ok = true;
      for (let dy = 0; ok && dy < SITE_H; dy++) {
        for (let dx = 0; ok && dx < SITE_W; dx++) {
          if (!isClearable(tiles[(y + dy) * width + x + dx])) ok = false;
        }
      }
      if (ok) return { x, y };
    }
  }
  throw new Error('No clearable 18x14 site found on this map — pick another seed');
}

function mustBuild(engine: CityEngine, tool: BuildToolName, x: number, y: number): void {
  const r = engine.build(tool, x, y);
  if (!r.ok) {
    throw new Error(`starter city: ${tool} at (${x},${y}) failed with result ${r.result}`);
  }
}

export function buildStarterCity(engine: CityEngine): { x: number; y: number } {
  const state = engine.getState();
  const site = findSite(state.width, state.height, state.tiles);
  const { x: x0, y: y0 } = site;

  for (let dy = 0; dy < SITE_H; dy++) {
    for (let dx = 0; dx < SITE_W; dx++) {
      const raw = state.tiles[(y0 + dy) * state.width + x0 + dx];
      if ((raw & BIT_MASK) !== DIRT) mustBuild(engine, 'bulldozer', x0 + dx, y0 + dy);
    }
  }

  mustBuild(engine, 'coal', x0 + 2, y0 + 2);

  const rowA: BuildToolName[] = ['residential', 'residential', 'residential', 'commercial', 'commercial'];
  const rowB: BuildToolName[] = ['industrial', 'industrial', 'industrial', 'residential', 'residential'];
  for (let i = 0; i < 5; i++) {
    mustBuild(engine, rowA[i], x0 + 2 + i * 3, y0 + 6);
    mustBuild(engine, rowB[i], x0 + 2 + i * 3, y0 + 10);
  }

  for (let dx = 1; dx <= 16; dx++) {
    mustBuild(engine, 'road', x0 + dx, y0 + 8);
    mustBuild(engine, 'road', x0 + dx, y0 + 12);
    mustBuild(engine, 'rail', x0 + dx, y0 + 13);
  }

  for (let dy = 5; dy <= 9; dy++) {
    mustBuild(engine, 'wire', x0 + 16, y0 + dy);
  }

  return site;
}
