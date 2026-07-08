/* Client-side mirror of src/modules/world/server/lib/worldSeverity.ts.
   Deliberate duplication: the client bundle must never import server code
   across that boundary. Keep thresholds/colors in sync by hand -- the
   shared contract is documented in docs/specs/2026-07-07-world-weather-map-design.md
   and docs/superpowers/plans/2026-07-07-world-weather-map.md (Global Constraints). */

export type SeverityTier = 'severe' | 'warning' | 'advisory' | 'calm' | 'none';

export function severityTier(sev: number | null): SeverityTier {
  if (sev == null || sev <= 0) return 'none';
  if (sev >= 0.75) return 'severe';
  if (sev >= 0.55) return 'warning';
  if (sev >= 0.35) return 'advisory';
  return 'calm';
}

export const SEVERITY_COLORS: Record<SeverityTier, string> = {
  severe: '#A6382F', warning: '#C1702F', advisory: '#B99038', calm: '#3E5A63', none: '#2f3136',
};

export const SEVERITY_LABELS: Record<SeverityTier, string> = {
  severe: 'Severe', warning: 'Warning', advisory: 'Advisory', calm: 'Calm', none: 'No alerts',
};
