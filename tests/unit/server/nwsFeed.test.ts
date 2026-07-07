import { describe, it, expect } from 'vitest';
import { nwsSeverityFromCap, stateFipsFromSameCode, normalizeNwsFeature } from '@modules/world/server/feeds/nws';
import nwsFixture from '../../fixtures/world/nws_alerts_active.json';
import malformedFixture from '../../fixtures/world/malformed.json';

/* Fixture is a trimmed capture of a REAL response from
   api.weather.gov/alerts/active?area=OK (confirmed field names, no
   guessing) -- tests never hit the network. */

type NwsFeature = Parameters<typeof normalizeNwsFeature>[0];

describe('nwsSeverityFromCap', () => {
  it('maps the full CAP severity vocabulary', () => {
    expect(nwsSeverityFromCap('Extreme')).toBe(1.0);
    expect(nwsSeverityFromCap('Severe')).toBe(0.75);
    expect(nwsSeverityFromCap('Moderate')).toBe(0.5);
    expect(nwsSeverityFromCap('Minor')).toBe(0.25);
    expect(nwsSeverityFromCap('Unknown')).toBe(0.5);
  });

  it('is case-insensitive', () => {
    expect(nwsSeverityFromCap('extreme')).toBe(1.0);
    expect(nwsSeverityFromCap('SEVERE')).toBe(0.75);
  });

  it('falls back to Unknown severity mapping for null/missing/unrecognized values', () => {
    expect(nwsSeverityFromCap(null)).toBe(0.5);
    expect(nwsSeverityFromCap(undefined)).toBe(0.5);
    expect(nwsSeverityFromCap('SomeNewCapValue')).toBe(0.5);
  });
});

describe('stateFipsFromSameCode', () => {
  it('extracts the 2-digit state FIPS from a 6-digit SAME code (Oklahoma, county 040101)', () => {
    expect(stateFipsFromSameCode(['040101'])).toBe('40');
  });

  it('extracts the state FIPS from a Texas SAME code (148201)', () => {
    expect(stateFipsFromSameCode(['148201'])).toBe('48');
  });

  it('returns null for empty, missing, or malformed SAME arrays', () => {
    expect(stateFipsFromSameCode(undefined)).toBeNull();
    expect(stateFipsFromSameCode([])).toBeNull();
    expect(stateFipsFromSameCode(['x'])).toBeNull();
    expect(stateFipsFromSameCode(['ab1234'])).toBeNull();
  });
});

describe('normalizeNwsFeature', () => {
  const features = (nwsFixture as { features: NwsFeature[] }).features;

  it('normalizes a real Minor-severity Flood Advisory alert', () => {
    const feature = features[0];
    const result = normalizeNwsFeature(feature);
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      source: 'nws',
      category: 'weather',
      severity: 0.25,
      location: '40',
    });
    expect(result?.title).toContain('Flood Advisory');
    // properties.id (short urn form) takes priority over @id when both are present.
    expect(result?.externalId).toBe(feature.properties.id);
  });

  it('normalizes an Extreme-severity Hurricane Warning with correct state FIPS (Texas)', () => {
    const feature = features[1];
    const result = normalizeNwsFeature(feature);
    expect(result?.severity).toBe(1.0);
    expect(result?.location).toBe('48');
    expect(result?.title).toContain('Hurricane Warning');
  });

  it('handles an alert with no geocode.SAME by leaving location null, using Unknown severity', () => {
    const feature = features[2];
    const result = normalizeNwsFeature(feature);
    expect(result?.location).toBeNull();
    expect(result?.severity).toBe(0.5);
  });

  it('uses effective time (falling back to sent) as occurredAt', () => {
    const feature = features[0];
    const result = normalizeNwsFeature(feature);
    expect(result?.occurredAt).toEqual(new Date('2026-07-06T23:46:00-05:00'));
  });

  it('states the exogeneity rationale', () => {
    const result = normalizeNwsFeature(features[0]);
    expect(result?.exogeneityNote).toMatch(/no government causes or controls/i);
  });

  it('returns null (not throw) for a feature missing id or sent', () => {
    // @ts-expect-error -- deliberately malformed input for the error path
    expect(normalizeNwsFeature({})).toBeNull();
    // @ts-expect-error -- deliberately malformed input for the error path
    expect(normalizeNwsFeature(malformedFixture)).toBeNull();
  });
});
