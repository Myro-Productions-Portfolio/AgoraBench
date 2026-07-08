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

export function isStateFips(location: string | null): boolean {
  if (!location || location.length !== 2) return false;
  const n = Number(location);
  return Number.isInteger(n) && n >= 1 && n <= 56;
}
