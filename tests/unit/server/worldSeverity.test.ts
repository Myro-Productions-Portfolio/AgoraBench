import { describe, it, expect } from 'vitest';
import { severityTier, SEVERITY_COLORS, isStateFips } from '@modules/world/server/lib/worldSeverity';

describe('severityTier', () => {
  it('maps boundary values to the right tier', () => {
    expect(severityTier(0.75)).toBe('severe');
    expect(severityTier(0.749)).toBe('warning');
    expect(severityTier(0.55)).toBe('warning');
    expect(severityTier(0.549)).toBe('advisory');
    expect(severityTier(0.35)).toBe('advisory');
    expect(severityTier(0.349)).toBe('calm');
    expect(severityTier(0.01)).toBe('calm');
    expect(severityTier(0)).toBe('none');
    expect(severityTier(null)).toBe('none');
  });
  it('has a color for every tier', () => {
    (['severe','warning','advisory','calm','none'] as const).forEach(t =>
      expect(SEVERITY_COLORS[t]).toMatch(/^#[0-9a-fA-F]{6}$/));
  });
});

describe('isStateFips', () => {
  it('accepts 2-digit numeric FIPS <= 56, rejects marine/territory/null', () => {
    expect(isStateFips('06')).toBe(true);   // California
    expect(isStateFips('56')).toBe(true);   // Wyoming (boundary)
    expect(isStateFips('57')).toBe(false);  // marine zone
    expect(isStateFips('75')).toBe(false);  // territory
    expect(isStateFips('6')).toBe(false);   // wrong length
    expect(isStateFips(null)).toBe(false);
  });
});
