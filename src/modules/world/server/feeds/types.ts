/* Shared shape every Tier-1 adapter normalizes into
   (docs/specs/exogenous-reality-feed.md). This is the pre-insert candidate --
   `fetchedAt`/`status` are stamped by the caller (worldFeedPoller.ts), not
   the adapter itself, so adapters stay pure functions of (raw payload) ->
   (candidate | null). */

export type WorldEventCategory = 'earthquake' | 'weather' | 'disaster' | 'news' | 'market';

export interface WorldEventCandidate {
  source: string;
  externalId: string;
  occurredAt: Date;
  category: WorldEventCategory;
  /** Normalized 0-1, per-adapter mapping. */
  severity: number;
  title: string;
  summary: string;
  /** 2-digit state FIPS, or null when the event has no state-level location. */
  location: string | null;
  rawPayload: unknown;
  /** Restates why this event is exogenous (world-caused, not government output). */
  exogeneityNote: string;
}
