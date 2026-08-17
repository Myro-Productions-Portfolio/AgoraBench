/**
 * Capitol City tick step (docs/specs/city-effect-layer.md §6 slice 2):
 * load-or-bootstrap the persisted engine, drive knobs from live state, advance,
 * persist. Called from agentTick behind rc.cityEnabled. Never throws into the
 * tick — a city failure must never break the government tick.
 */

import { gzipSync, gunzipSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import { db } from '@db/connection';
import { cityState, citySnapshots } from '@db/schema/index';
import { getRuntimeConfig } from '@core/server/runtimeConfig.js';
import {
  createCity,
  deserializeCity,
  type CityEngine,
  type CityKnobs,
  type CityStats,
  type ExternalDemand,
} from '../../engine/index.js';
import { buildStarterCity } from '../../engine/starterCity.js';
import { computeCityKnobs, gatherCityDriverInputs } from './cityDriver.js';

/* Fixed world seed for the one canonical city (spec date). Changing it = a new
   city the next time city_state is empty; it never regenerates an existing one. */
export const CAPITOL_CITY_SEED = 20260816;

const CITY_STATE_ROW_ID = 1;
/* ENGINE-NOTES: 1 city-month = 4 cityTime units. */
const CITY_TIME_PER_MONTH = 4;

function compress(serialized: string): string {
  return gzipSync(Buffer.from(serialized, 'utf8')).toString('base64');
}

function decompress(stored: string): string {
  return gunzipSync(Buffer.from(stored, 'base64')).toString('utf8');
}

export interface CityStepResult {
  bootstrapped: boolean;
  cityTimeMonths: number;
  stats: CityStats;
  knobs: Required<CityKnobs>;
  externalDemand: ExternalDemand;
  regime: string;
}

export async function stepCityEngine(tickNumber: number): Promise<CityStepResult | null> {
  const rc = getRuntimeConfig();
  if (!rc.cityEnabled) return null;
  try {
    const [row] = await db
      .select({ state: cityState.state })
      .from(cityState)
      .where(eq(cityState.id, CITY_STATE_ROW_ID))
      .limit(1);

    let engine: CityEngine;
    const bootstrapped = !row;
    if (row) {
      engine = deserializeCity(decompress(row.state));
    } else {
      /* First run: seeded terrain + the deterministic slice-1 starter layout —
         a bare map has no zones, so knobs would drive nothing visible. */
      engine = createCity({ seed: CAPITOL_CITY_SEED });
      buildStarterCity(engine);
    }

    const inputs = await gatherCityDriverInputs();
    const { knobs, externalDemand } = computeCityKnobs(inputs);
    /* Re-applied EVERY tick, not just on change: pins funding against the
       engine's January affordability re-normalization (ENGINE-NOTES). */
    engine.setKnobs(knobs);
    engine.setExternalDemand(externalDemand);
    engine.tick(rc.cityMonthsPerTick);

    const state = engine.getState();
    const cityTimeMonths = Math.floor(state.stats.cityTime / CITY_TIME_PER_MONTH);
    const compressed = compress(engine.serialize());
    const now = new Date();

    await db
      .insert(cityState)
      .values({
        id: CITY_STATE_ROW_ID,
        tickNumber,
        cityTimeMonths,
        state: compressed,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: cityState.id,
        set: { tickNumber, cityTimeMonths, state: compressed, updatedAt: now },
      });

    await db.insert(citySnapshots).values({
      tickNumber,
      cityTimeMonths,
      stats: state.stats,
      snapshot: compressed,
    });

    return {
      bootstrapped,
      cityTimeMonths,
      stats: state.stats,
      knobs,
      externalDemand,
      regime: inputs.regime,
    };
  } catch (err) {
    console.warn('[CITY] step failed (government tick unaffected):', err);
    return null;
  }
}
