// src/modules/world/server/lib/worldFeedPoller.ts
//
// Exogenous world-events feed, E2 slice 1 (docs/specs/exogenous-reality-feed.md).
//
// Orchestrates the three Tier-1 adapters (USGS, NWS, OpenFEMA), each gated
// by its own enable flag, and upserts normalized candidates into
// `world_events` with dedupe on (source, externalId). READ-ONLY slice:
// nothing here is consumed by prompt-building or the tick beyond writing to
// this table -- see the module header in feeds/*.ts for the exogeneity
// doctrine each adapter follows.
//
// Failure-isolated per source, mirroring realityFeed.ts's pullRealitySnapshots:
// one dead API must never block the others or throw into the tick. Each
// fetch*Events() function already never throws (catches internally); this
// module's try/catch per source is a second line of defense against a future
// change to one of them regressing that guarantee.

import { db } from '@db/connection';
import { worldEvents } from '@db/schema/index';
import { getRuntimeConfig } from '@core/server/runtimeConfig.js';
import { fetchUsgsEvents } from '../feeds/usgs.js';
import { fetchNwsEvents } from '../feeds/nws.js';
import { fetchOpenFemaEvents } from '../feeds/openfema.js';
import type { WorldEventCandidate } from '../feeds/types.js';

/** Tick wiring: poll every N ticks per rc.worldFeedPollTicks (default 1 = every tick). */
type WorldEventInsert = typeof worldEvents.$inferInsert;

function toInsertRow(candidate: WorldEventCandidate): WorldEventInsert {
  return {
    source: candidate.source,
    externalId: candidate.externalId,
    occurredAt: candidate.occurredAt,
    category: candidate.category,
    severity: candidate.severity,
    title: candidate.title,
    summary: candidate.summary,
    location: candidate.location,
    rawPayload: candidate.rawPayload as Record<string, unknown>,
    status: 'pending',
    exogeneityNote: candidate.exogeneityNote,
  };
}

/**
 * Insert candidates, skipping rows that already exist for (source,
 * externalId) -- world events are point-in-time occurrences, so re-polling
 * the same event is a no-op rather than a refresh (unlike reality_snapshots,
 * which intentionally re-stamps fetchedAt on every pull of the same date).
 */
async function insertWithDedupe(candidates: WorldEventCandidate[]): Promise<number> {
  if (candidates.length === 0) return 0;
  let inserted = 0;
  for (const candidate of candidates) {
    const result = await db
      .insert(worldEvents)
      .values(toInsertRow(candidate))
      .onConflictDoNothing({ target: [worldEvents.source, worldEvents.externalId] })
      .returning({ id: worldEvents.id });
    if (result.length > 0) inserted++;
  }
  return inserted;
}

/**
 * Poll all enabled Tier-1 sources and upsert-with-dedupe into world_events.
 * Each source is independently try/caught -- one failing source never
 * blocks the others, and this function NEVER throws to the caller.
 *
 * Gated by rc.worldFeedEnabled at the call site (agentTick.ts) as the master
 * dark-by-default switch; per-source flags here let an operator narrow which
 * sources run once the master flag is on.
 */
export async function pollWorldEvents(): Promise<{ inserted: number; errors: string[] }> {
  const rc = getRuntimeConfig();
  const errors: string[] = [];
  let inserted = 0;

  if (rc.worldFeedUsgsEnabled) {
    try {
      inserted += await insertWithDedupe(await fetchUsgsEvents());
    } catch (err) {
      const msg = `usgs: ${err instanceof Error ? err.message : String(err)}`;
      console.warn('[worldFeedPoller]', msg);
      errors.push(msg);
    }
  }

  if (rc.worldFeedNwsEnabled) {
    try {
      inserted += await insertWithDedupe(await fetchNwsEvents());
    } catch (err) {
      const msg = `nws: ${err instanceof Error ? err.message : String(err)}`;
      console.warn('[worldFeedPoller]', msg);
      errors.push(msg);
    }
  }

  if (rc.worldFeedFemaEnabled) {
    try {
      inserted += await insertWithDedupe(await fetchOpenFemaEvents());
    } catch (err) {
      const msg = `openfema: ${err instanceof Error ? err.message : String(err)}`;
      console.warn('[worldFeedPoller]', msg);
      errors.push(msg);
    }
  }

  // worldFeedGdeltEnabled: reserved per spec (Tier 2, no adapter yet). No
  // branch here -- flipping the flag on today is a documented no-op until a
  // gdelt.ts adapter exists.

  return { inserted, errors };
}
