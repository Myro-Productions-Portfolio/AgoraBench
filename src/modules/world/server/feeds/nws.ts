// src/modules/world/server/feeds/nws.ts
//
// NWS Alerts adapter (Tier 1, docs/specs/exogenous-reality-feed.md).
//
// Endpoint: https://api.weather.gov/alerts/active (CAP-format alerts).
// REQUIRES a descriptive User-Agent header -- api.weather.gov rejects
// requests without one (confirmed live 2026-07-06: NWS docs mandate a
// contact-identifying UA, e.g. "AppName (contact@example.com)").
//
// Response is a GeoJSON FeatureCollection. Field names confirmed by live
// inspection 2026-07-06:
//   properties: id (or "@id"), event, headline, description, areaDesc,
//     severity (CAP: Extreme|Severe|Moderate|Minor|Unknown),
//     certainty, urgency, sent, effective, expires,
//     geocode.SAME (6-digit codes, first 2 digits = state FIPS).
//
// No auth/key required (UA header only). Failure-isolated: this module
// never throws -- caller (worldFeedPoller.ts) still wraps it defensively,
// but fetchNwsEvents() itself catches everything, mirroring realityFeed.ts.

import type { WorldEventCandidate } from './types.js';

const NWS_ALERTS_ACTIVE_URL = 'https://api.weather.gov/alerts/active';
// NWS API etiquette: identify the application + a contact method. See
// https://www.weather.gov/documentation/services-web-api -- requests
// without a descriptive User-Agent are rejected.
const NWS_USER_AGENT = 'AgoraBench World Events Feed (agorabench.com, contact: admin@agorabench.com)';
const REQUEST_TIMEOUT_MS = 15_000;

interface NwsAlertProperties {
  id?: string;
  '@id'?: string;
  event: string | null;
  headline: string | null;
  description: string | null;
  areaDesc: string | null;
  severity: string | null;
  certainty: string | null;
  urgency: string | null;
  sent: string | null;
  effective: string | null;
  expires: string | null;
  geocode?: { SAME?: string[]; UGC?: string[] };
}

interface NwsAlertFeature {
  type: string;
  id?: string;
  properties: NwsAlertProperties;
}

interface NwsAlertsResponse {
  type: string;
  features: NwsAlertFeature[];
}

/**
 * CAP severity vocabulary -> 0-1. CAP defines exactly these five values
 * (https://alerts.weather.gov specifies the enum); "Unknown" maps to the
 * midpoint rather than 0 since an un-classified alert is not necessarily
 * low-severity, just unrated.
 */
const CAP_SEVERITY_MAP: Record<string, number> = {
  extreme: 1.0,
  severe: 0.75,
  moderate: 0.5,
  minor: 0.25,
  unknown: 0.5,
};

export function nwsSeverityFromCap(severity: string | null | undefined): number {
  if (!severity) return CAP_SEVERITY_MAP.unknown;
  return CAP_SEVERITY_MAP[severity.toLowerCase()] ?? CAP_SEVERITY_MAP.unknown;
}

/**
 * First 2 digits of a 6-digit SAME code are the state FIPS code
 * (https://www.weather.gov/nwr/counties -- SAME format is SSCCC preceded by
 * a leading digit for county/zone type). Returns null when no SAME code is
 * present or it's malformed.
 */
export function stateFipsFromSameCode(sameCodes: string[] | null | undefined): string | null {
  if (!sameCodes || sameCodes.length === 0) return null;
  const first = sameCodes[0];
  if (!first || first.length < 3) return null;
  const fips = first.slice(1, 3);
  return /^\d{2}$/.test(fips) ? fips : null;
}

async function fetchJson<T>(url: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': NWS_USER_AGENT, Accept: 'application/geo+json' },
      });
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

/** Normalize one NWS CAP alert feature into a WorldEventCandidate, or null if unusable. */
export function normalizeNwsFeature(feature: NwsAlertFeature): WorldEventCandidate | null {
  const props = feature.properties;
  if (!props) return null;
  const externalId = props.id ?? props['@id'] ?? feature.id;
  if (!externalId || !props.sent) return null;

  const eventName = props.event ?? 'Weather Alert';
  const area = props.areaDesc ?? 'an affected area';

  return {
    source: 'nws',
    externalId,
    occurredAt: new Date(props.effective ?? props.sent),
    category: 'weather',
    severity: nwsSeverityFromCap(props.severity),
    title: (props.headline ?? `${eventName} - ${area}`).slice(0, 300),
    summary: (props.description ?? `${eventName} in effect for ${area}.`).slice(0, 2000),
    location: stateFipsFromSameCode(props.geocode?.SAME),
    rawPayload: feature,
    exogeneityNote: 'Weather condition -- an atmospheric event no government causes or controls.',
  };
}

/**
 * Fetch and normalize all currently active NWS alerts.
 * NEVER throws -- fetch failure or unexpected shape logs and returns [].
 */
export async function fetchNwsEvents(): Promise<WorldEventCandidate[]> {
  try {
    const body = await fetchJson<NwsAlertsResponse>(NWS_ALERTS_ACTIVE_URL);
    const features = Array.isArray(body?.features) ? body.features : [];
    return features
      .map(normalizeNwsFeature)
      .filter((c): c is WorldEventCandidate => c !== null);
  } catch (err) {
    console.warn('[worldFeed:nws]', err instanceof Error ? err.message : String(err));
    return [];
  }
}
