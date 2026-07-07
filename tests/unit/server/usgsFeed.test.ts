import { describe, it, expect } from 'vitest';
import { usgsSeverityFromMagnitude, normalizeUsgsFeature } from '@modules/world/server/feeds/usgs';
import usgsFixture from '../../fixtures/world/usgs_significant_week.json';
import malformedFixture from '../../fixtures/world/malformed.json';

/* Fixture is a trimmed capture of a REAL response from
   earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson
   (confirmed field names, no guessing) -- tests never hit the network. */

type UsgsFeature = Parameters<typeof normalizeUsgsFeature>[0];

describe('usgsSeverityFromMagnitude', () => {
  it('maps M0 to 0', () => {
    expect(usgsSeverityFromMagnitude(0)).toBe(0);
  });

  it('maps M4 to 0.5 (midpoint of the 0-8 clamp range)', () => {
    expect(usgsSeverityFromMagnitude(4)).toBe(0.5);
  });

  it('maps M8 and above to 1.0 (clamped, not unbounded)', () => {
    expect(usgsSeverityFromMagnitude(8)).toBe(1.0);
    expect(usgsSeverityFromMagnitude(9.5)).toBe(1.0);
  });

  it('is linear between 0 and 8', () => {
    expect(usgsSeverityFromMagnitude(6)).toBe(0.75);
    expect(usgsSeverityFromMagnitude(2)).toBe(0.25);
  });

  it('returns 0 for null, undefined, or non-finite magnitude', () => {
    expect(usgsSeverityFromMagnitude(null)).toBe(0);
    expect(usgsSeverityFromMagnitude(undefined)).toBe(0);
    expect(usgsSeverityFromMagnitude(NaN)).toBe(0);
  });
});

describe('normalizeUsgsFeature', () => {
  const features = (usgsFixture as { features: UsgsFeature[] }).features;

  it('normalizes a real M3.8 earthquake feature', () => {
    const feature = features.find((f) => f.id === 'uw714040221')!;
    const result = normalizeUsgsFeature(feature);
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      source: 'usgs',
      externalId: 'uw714040221',
      category: 'earthquake',
      severity: 0.48, // 3.8 / 8, rounded to 2dp
      title: 'M 3.8 - 2 km E of Oak Harbor, Washington',
      location: null,
    });
    expect(result?.occurredAt).toEqual(new Date(1782974147600));
  });

  it('normalizes a real M5.3 earthquake feature with higher severity', () => {
    const feature = features.find((f) => f.id === 'us6000t9bg')!;
    const result = normalizeUsgsFeature(feature);
    expect(result?.severity).toBe(0.66); // 5.3 / 8, rounded to 2dp
    expect(result?.summary).toContain('M 5.3');
    expect(result?.summary).toContain('265 km SSE of Dunhuang, China');
  });

  it('falls back to constructed title when title/place absent and severity 0 when magnitude is null', () => {
    const feature = features.find((f) => f.id === 'us_unrated1')!;
    const result = normalizeUsgsFeature(feature);
    expect(result).not.toBeNull();
    expect(result?.severity).toBe(0);
    expect(result?.title).toContain('Unrated');
  });

  it('carries the full raw feature in rawPayload for provenance', () => {
    const feature = features.find((f) => f.id === 'uw714040221')!;
    const result = normalizeUsgsFeature(feature);
    expect(result?.rawPayload).toEqual(feature);
  });

  it('states the exogeneity rationale', () => {
    const feature = features.find((f) => f.id === 'uw714040221')!;
    const result = normalizeUsgsFeature(feature);
    expect(result?.exogeneityNote).toMatch(/no government causes or controls/i);
  });

  it('returns null (not throw) for a feature missing id or time', () => {
    // @ts-expect-error -- deliberately malformed input for the error path
    expect(normalizeUsgsFeature({})).toBeNull();
    // @ts-expect-error -- deliberately malformed input for the error path
    expect(normalizeUsgsFeature(malformedFixture)).toBeNull();
    expect(normalizeUsgsFeature({ id: 'x', properties: { mag: 1, place: 'y', time: null } } as unknown as UsgsFeature)).toBeNull();
  });
});
