import { describe, it, expect } from 'vitest';
import { openFemaSeverityFromIncidentType, normalizeOpenFemaRow } from '@modules/world/server/feeds/openfema';
import openFemaFixture from '../../fixtures/world/openfema_disaster_declarations.json';
import malformedFixture from '../../fixtures/world/malformed.json';

/* Fixture is a trimmed capture of a REAL response from
   www.fema.gov/api/open/v2/DisasterDeclarationsSummaries (confirmed field
   names, no guessing) -- tests never hit the network. */

type OpenFemaRow = Parameters<typeof normalizeOpenFemaRow>[0];

describe('openFemaSeverityFromIncidentType', () => {
  it('maps known high-severity incident types', () => {
    expect(openFemaSeverityFromIncidentType('Hurricane')).toBe(0.9);
    expect(openFemaSeverityFromIncidentType('Earthquake')).toBe(0.9);
  });

  it('maps known mid-severity incident types', () => {
    expect(openFemaSeverityFromIncidentType('Wildfire')).toBe(0.7);
    expect(openFemaSeverityFromIncidentType('Tropical Storm')).toBe(0.6);
  });

  it('is case-insensitive', () => {
    expect(openFemaSeverityFromIncidentType('wildfire')).toBe(0.7);
    expect(openFemaSeverityFromIncidentType('HURRICANE')).toBe(0.9);
  });

  it('falls back to the documented default for unmapped or missing incident types', () => {
    expect(openFemaSeverityFromIncidentType('Some Unmapped Hazard')).toBe(0.4);
    expect(openFemaSeverityFromIncidentType(null)).toBe(0.4);
    expect(openFemaSeverityFromIncidentType(undefined)).toBe(0.4);
  });
});

describe('normalizeOpenFemaRow', () => {
  const rows = (openFemaFixture as { DisasterDeclarationsSummaries: OpenFemaRow[] }).DisasterDeclarationsSummaries;

  it('normalizes a real Tropical Storm incident, using the incident (not the declaration) as content', () => {
    const row = rows[0];
    const result = normalizeOpenFemaRow(row);
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      source: 'openfema',
      externalId: '81d772f1-c9ae-48a5-90a7-42010db6f5a7',
      category: 'disaster',
      severity: 0.6,
      location: '69',
    });
    expect(result?.title).toContain('Tropical Storm');
    expect(result?.title).toContain('Rota (Municipality)');
    // The declaration string/type is government output and must not appear
    // in the narrative content per the exogeneity doctrine.
    expect(result?.title).not.toContain('EM-3647-MP');
    expect(result?.summary).not.toContain('EM-3647-MP');
  });

  it('includes an end date clause when incidentEndDate is present, "(ongoing)" when null', () => {
    const ongoing = normalizeOpenFemaRow(rows[0]);
    expect(ongoing?.summary).toContain('(ongoing)');

    const ended = normalizeOpenFemaRow(rows[1]);
    expect(ended?.summary).toContain('through 2026-07-05');
  });

  it('normalizes a Wildfire incident with correct severity and California FIPS', () => {
    const row = rows[2];
    const result = normalizeOpenFemaRow(row);
    expect(result?.severity).toBe(0.7);
    expect(result?.location).toBe('06');
    expect(result?.title).toContain('Wildfire');
  });

  it('returns null location for missing or non-2-digit fipsStateCode', () => {
    const row = rows[3];
    const result = normalizeOpenFemaRow(row);
    expect(result?.location).toBeNull();
    expect(result?.severity).toBe(0.4); // unmapped incident type default
  });

  it('carries the full raw row in rawPayload for provenance, including declaration metadata', () => {
    const row = rows[0];
    const result = normalizeOpenFemaRow(row);
    expect(result?.rawPayload).toEqual(row);
  });

  it('states the exogeneity rationale distinguishing incident from declaration', () => {
    const result = normalizeOpenFemaRow(rows[0]);
    expect(result?.exogeneityNote).toMatch(/not the FEMA declaration/i);
  });

  it('returns null (not throw) for a row missing id or incidentBeginDate', () => {
    // @ts-expect-error -- deliberately malformed input for the error path
    expect(normalizeOpenFemaRow({})).toBeNull();
    // @ts-expect-error -- deliberately malformed input for the error path
    expect(normalizeOpenFemaRow(malformedFixture)).toBeNull();
  });
});
