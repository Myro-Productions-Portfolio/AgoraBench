// src/modules/world/server/feeds/openfema.ts
//
// OpenFEMA adapter (Tier 1, docs/specs/exogenous-reality-feed.md).
//
// Endpoint: https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries
// OData params: $top (page size), $orderby=declarationDate desc.
//
// DOCTRINE (spec §Doctrine): "FEMA response actions (the declaration is
// government output; the underlying disaster is the event)". This adapter
// therefore extracts the INCIDENT -- incidentType, fipsStateCode,
// incidentBeginDate/incidentEndDate, designatedArea -- as the event content.
// The declaration metadata (declarationType, femaDeclarationString,
// programDeclared flags, declarationDate) is government output and is never
// surfaced in title/summary; it rides along in rawPayload only for
// provenance/audit, never as the narrative content itself.
//
// Response fields confirmed by live inspection 2026-07-06:
//   DisasterDeclarationsSummaries[]: id, disasterNumber, femaDeclarationString,
//     state, declarationType, declarationDate, incidentType, declarationTitle,
//     incidentBeginDate, incidentEndDate, fipsStateCode, fipsCountyCode,
//     designatedArea.
//
// No auth/key required. Failure-isolated: never throws to the caller.

import type { WorldEventCandidate } from './types.js';

const OPENFEMA_URL =
  'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=25&$orderby=declarationDate%20desc';
const REQUEST_TIMEOUT_MS = 15_000;

interface OpenFemaRow {
  id: string;
  disasterNumber: number | null;
  femaDeclarationString: string | null;
  state: string | null;
  declarationType: string | null;
  declarationDate: string | null;
  incidentType: string | null;
  declarationTitle: string | null;
  incidentBeginDate: string | null;
  incidentEndDate: string | null;
  fipsStateCode: string | null;
  fipsCountyCode: string | null;
  designatedArea: string | null;
}

interface OpenFemaResponse {
  DisasterDeclarationsSummaries: OpenFemaRow[];
}

/**
 * Severity from incident type. FEMA does not publish a numeric severity
 * scale on declarations, so this is a coarse hazard-class heuristic ordered
 * by typical physical destructiveness/scope -- documented explicitly since
 * it is an interpretation, not a value FEMA provides. Unlisted/unknown
 * incident types fall to the low-middle default rather than 0, since every
 * declared incident cleared FEMA's material-impact bar to be declared at all.
 */
const INCIDENT_SEVERITY_MAP: Record<string, number> = {
  'hurricane': 0.9,
  'typhoon': 0.9,
  'earthquake': 0.9,
  'tsunami': 0.9,
  'volcanic eruption': 0.85,
  'wildfire': 0.7,
  'flood': 0.6,
  'severe storm(s)': 0.55,
  'severe storm': 0.55,
  'tropical storm': 0.6,
  'tornado': 0.65,
  'winter storm': 0.45,
  'snowstorm': 0.45,
  'mud/landslide': 0.5,
  'drought': 0.4,
  'fire': 0.5,
  'biological': 0.6,
  'chemical': 0.6,
  'other': 0.3,
};
const DEFAULT_INCIDENT_SEVERITY = 0.4;

export function openFemaSeverityFromIncidentType(incidentType: string | null | undefined): number {
  if (!incidentType) return DEFAULT_INCIDENT_SEVERITY;
  return INCIDENT_SEVERITY_MAP[incidentType.toLowerCase()] ?? DEFAULT_INCIDENT_SEVERITY;
}

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

/**
 * Normalize one OpenFEMA declaration row into a WorldEventCandidate. The
 * EVENT CONTENT is the incident (type/location/dates) -- the declaration
 * itself is government output per the exogeneity doctrine, so it is not
 * quoted in title/summary. `id` (the per-area declaration row id) is used as
 * externalId since it is unique per (disaster, area) row, which is the grain
 * this feed's dedupe key needs.
 */
export function normalizeOpenFemaRow(row: OpenFemaRow): WorldEventCandidate | null {
  if (!row.id || !row.incidentBeginDate) return null;

  const incidentType = row.incidentType ?? 'Disaster';
  const area = row.designatedArea ?? 'a designated area';
  const stateFips = row.fipsStateCode && /^\d{2}$/.test(row.fipsStateCode) ? row.fipsStateCode : null;

  const endClause = row.incidentEndDate ? ` through ${row.incidentEndDate.slice(0, 10)}` : ' (ongoing)';

  return {
    source: 'openfema',
    externalId: row.id,
    occurredAt: new Date(row.incidentBeginDate),
    category: 'disaster',
    severity: openFemaSeverityFromIncidentType(row.incidentType),
    title: `${incidentType} - ${area}`.slice(0, 300),
    summary: `${incidentType} incident affecting ${area}, beginning ${row.incidentBeginDate.slice(0, 10)}${endClause}.`,
    location: stateFips,
    rawPayload: row,
    exogeneityNote:
      'Underlying disaster incident (not the FEMA declaration, which is government output responding to it).',
  };
}

/**
 * Fetch and normalize the most recent OpenFEMA disaster declarations,
 * extracting the incident as event content per the exogeneity doctrine.
 * NEVER throws -- fetch failure or unexpected shape logs and returns [].
 */
export async function fetchOpenFemaEvents(): Promise<WorldEventCandidate[]> {
  try {
    const body = await fetchJson<OpenFemaResponse>(OPENFEMA_URL);
    const rows = Array.isArray(body?.DisasterDeclarationsSummaries) ? body.DisasterDeclarationsSummaries : [];
    return rows
      .map(normalizeOpenFemaRow)
      .filter((c): c is WorldEventCandidate => c !== null);
  } catch (err) {
    console.warn('[worldFeed:openfema]', err instanceof Error ? err.message : String(err));
    return [];
  }
}
