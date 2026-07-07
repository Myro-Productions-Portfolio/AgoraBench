// src/modules/world/server/feeds/usgs.ts
//
// USGS Earthquakes adapter (Tier 1, docs/specs/exogenous-reality-feed.md).
//
// Endpoint: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson
// NOTE the path is "earthquakes/feed" PLURAL -- the singular "earthquake/feed"
// 404s (confirmed live 2026-07-06).
//
// Response is a standard GeoJSON FeatureCollection. Field names confirmed by
// live inspection 2026-07-06:
//   properties: mag, place, time (epoch ms), url, sig, alert, tsunami
//   geometry.coordinates: [lon, lat, depth]
//   feature.id: USGS event id, stable, used as externalId.
//
// No auth required. Failure-isolated: any fetch/parse error is caught by the
// caller (worldFeedPoller.ts) -- this module never throws into the tick,
// mirroring realityFeed.ts's per-source try/catch discipline.

import type { WorldEventCandidate } from './types.js';

const USGS_SIGNIFICANT_WEEK_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson';
const REQUEST_TIMEOUT_MS = 15_000;

interface UsgsFeature {
  type: string;
  id: string;
  properties: {
    mag: number | null;
    place: string | null;
    time: number | null;
    url: string | null;
    sig: number | null;
    alert: string | null;
    tsunami: number | null;
    title: string | null;
  };
  geometry: {
    type: string;
    coordinates: [number, number, number] | null;
  } | null;
}

interface UsgsGeoJsonResponse {
  type: string;
  features: UsgsFeature[];
}

/**
 * Magnitude-normalized severity, 0-1. Richter magnitude is logarithmic and
 * effectively unbounded upward but M8+ events are catastrophic-tier and
 * exceedingly rare (largest recorded ~M9.5) -- clamp the top of the useful
 * narrative range at M8 rather than the theoretical max, floor at M0.
 * Linear in between: M4 (light, felt but rarely damaging) -> 0.5,
 * M6 (strong, regional damage) -> 0.75, M8 (great) -> 1.0.
 */
export function usgsSeverityFromMagnitude(mag: number | null | undefined): number {
  if (mag === null || mag === undefined || !Number.isFinite(mag)) return 0;
  const clamped = Math.max(0, Math.min(8, mag));
  return Math.round((clamped / 8) * 100) / 100;
}

/** Fetch with a hard timeout and a single retry (no retry storms), mirrors realityFeed.ts. */
async function fetchJson<T>(url: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Normalize one USGS GeoJSON feature into a WorldEventCandidate, or null if unusable. */
export function normalizeUsgsFeature(feature: UsgsFeature): WorldEventCandidate | null {
  if (!feature.id || !feature.properties) return null;
  const { mag, place, time, title } = feature.properties;
  if (time === null || time === undefined) return null;

  const magStr = mag !== null && mag !== undefined ? `M ${mag}` : 'Unrated';
  const placeStr = place ?? 'unknown location';

  return {
    source: 'usgs',
    externalId: feature.id,
    occurredAt: new Date(time),
    category: 'earthquake',
    severity: usgsSeverityFromMagnitude(mag),
    title: (title ?? `${magStr} - ${placeStr}`).slice(0, 300),
    summary: `${magStr} earthquake ${placeStr}.`,
    // USGS significant-quakes feed is global; state-level FIPS location is
    // not derivable from the "place" free-text string without a geocoding
    // step out of scope for this slice -- left null.
    location: null,
    rawPayload: feature,
    exogeneityNote: 'Seismic event -- a physical occurrence no government causes or controls.',
  };
}

/**
 * Fetch and normalize the current significant-earthquakes-this-week feed.
 * NEVER throws -- fetch failure or unexpected shape logs and returns [].
 */
export async function fetchUsgsEvents(): Promise<WorldEventCandidate[]> {
  try {
    const body = await fetchJson<UsgsGeoJsonResponse>(USGS_SIGNIFICANT_WEEK_URL);
    const features = Array.isArray(body?.features) ? body.features : [];
    return features
      .map(normalizeUsgsFeature)
      .filter((c): c is WorldEventCandidate => c !== null);
  } catch (err) {
    console.warn('[worldFeed:usgs]', err instanceof Error ? err.message : String(err));
    return [];
  }
}
