/* Capitol City public spectator API (docs/specs/city-effect-layer.md §4,
   slice 3). Public, read-only, same posture as GET /world/macro: no auth
   gate, nothing here mutates state, nothing here feeds back into the sim. */

import { Router } from 'express';
import { gunzipSync } from 'node:zlib';
import { desc, eq } from 'drizzle-orm';
import { db } from '@db/connection';
import { cityState, citySnapshots } from '@db/schema/index';
import { encodeTileCategories } from '../lib/tileCategories';
import type { CityStats } from '../../engine/types';

const router = Router();

const CITY_STATE_ROW_ID = 1;
const HISTORY_DEFAULT_LIMIT = 96;
const HISTORY_MAX_LIMIT = 500;

export interface CityStatsDelta {
  population: number;
  funds: number;
  score: number;
  crime: number;
  pollution: number;
}

/* Curated latest-minus-previous movement for the spectator delta line. */
export function computeStatsDelta(latest: CityStats, previous: CityStats): CityStatsDelta {
  return {
    population: latest.population - previous.population,
    funds: latest.funds - previous.funds,
    score: latest.cityScore - previous.cityScore,
    crime: latest.crimeAverage - previous.crimeAverage,
    pollution: latest.pollutionAverage - previous.pollutionAverage,
  };
}

/* GET /api/city/state -- current map + stats. `started: false` until the
   first city tick has persisted (cityEnabled dark = graceful empty state). */
router.get('/city/state', async (_req, res, next) => {
  try {
    const [row] = await db
      .select({
        tickNumber: cityState.tickNumber,
        cityTimeMonths: cityState.cityTimeMonths,
        state: cityState.state,
        updatedAt: cityState.updatedAt,
      })
      .from(cityState)
      .where(eq(cityState.id, CITY_STATE_ROW_ID))
      .limit(1);
    if (!row) {
      res.json({ success: true, data: { started: false } });
      return;
    }

    /* Snapshot v2 JSON (engine serialize()), parsed directly — never via
       deserializeCity(): constructing an engine here would clobber the global
       PRNG under a concurrently running tick. Only `map` is read. */
    const snap = JSON.parse(gunzipSync(Buffer.from(row.state, 'base64')).toString('utf8')) as {
      map: { width: number; height: number; tiles: number[] };
    };

    const snapshots = await db
      .select({ stats: citySnapshots.stats })
      .from(citySnapshots)
      .orderBy(desc(citySnapshots.id))
      .limit(2);
    if (snapshots.length === 0) {
      res.json({ success: true, data: { started: false } });
      return;
    }

    const stats = snapshots[0].stats;
    res.json({
      success: true,
      data: {
        started: true,
        tickNumber: row.tickNumber,
        cityTimeMonths: row.cityTimeMonths,
        updatedAt: row.updatedAt,
        map: {
          width: snap.map.width,
          height: snap.map.height,
          /* base64 Uint8Array, one category code per tile, row-major. */
          categories: encodeTileCategories(snap.map.tiles),
        },
        stats,
        delta: snapshots.length >= 2 ? computeStatsDelta(stats, snapshots[1].stats) : null,
      },
    });
  } catch (error) {
    next(error);
  }
});

/* GET /api/city/history?limit= -- stats series for timelapse/charts, newest
   first. Never returns the compressed snapshot blobs. */
router.get('/city/history', async (req, res, next) => {
  try {
    const limitParam = Number.parseInt(String(req.query.limit ?? String(HISTORY_DEFAULT_LIMIT)), 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, HISTORY_MAX_LIMIT)
      : HISTORY_DEFAULT_LIMIT;
    const rows = await db
      .select({
        tickNumber: citySnapshots.tickNumber,
        cityTimeMonths: citySnapshots.cityTimeMonths,
        stats: citySnapshots.stats,
      })
      .from(citySnapshots)
      .orderBy(desc(citySnapshots.id))
      .limit(limit);
    res.json({ success: true, data: { snapshots: rows } });
  } catch (error) {
    next(error);
  }
});

export default router;
