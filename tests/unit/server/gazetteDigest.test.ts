import { describe, it, expect } from 'vitest';
import { buildGazetteDigest, type GazetteDigestInput } from '@core/server/lib/gazetteDigest';

function emptyInput(): GazetteDigestInput {
  return {
    passedBills: [],
    failedBills: [],
    vetoedBills: [],
    electionWinners: [],
    brokenDeals: [],
    events: [],
  };
}

describe('buildGazetteDigest', () => {
  it('returns null when nothing notable happened', () => {
    expect(buildGazetteDigest(emptyInput())).toBeNull();
  });

  it('renders one bullet per outcome in fixed order: passed, vetoed, failed, elections, deals, events', () => {
    const digest = buildGazetteDigest({
      passedBills: [{ title: 'Housing Act' }],
      vetoedBills: [{ title: 'Surveillance Act' }],
      failedBills: [{ title: 'Tax Act' }],
      electionWinners: ['Senator Vance'],
      brokenDeals: [{ wrongedPartyName: 'Rep. Cole' }],
      events: [{ type: 'media_event', title: 'Breaking', description: 'Markets rally' }],
    });
    expect(digest).toBe(
      [
        '- Bill passed: "Housing Act"',
        '- Vetoed by the President: "Surveillance Act"',
        '- Failed on the floor: "Tax Act"',
        '- Election decided: Senator Vance won',
        '- Vote pact broken: Rep. Cole was betrayed',
        '- News: Breaking — Markets rally',
      ].join('\n'),
    );
  });

  it('is deterministic for the same input', () => {
    const input: GazetteDigestInput = {
      ...emptyInput(),
      passedBills: [{ title: 'A' }, { title: 'B' }],
      events: [{ type: 'appointment', title: 'New chair', description: 'Budget Committee' }],
    };
    expect(buildGazetteDigest(input)).toBe(buildGazetteDigest(input));
  });

  it('caps at 8 bullets', () => {
    const digest = buildGazetteDigest({
      ...emptyInput(),
      passedBills: Array.from({ length: 20 }, (_, i) => ({ title: `Bill ${i}` })),
    });
    expect(digest).not.toBeNull();
    expect(digest!.split('\n').length).toBe(8);
  });

  it('caps total length at 1200 chars', () => {
    const digest = buildGazetteDigest({
      ...emptyInput(),
      passedBills: Array.from({ length: 8 }, (_, i) => ({ title: `${'Very Long Title '.repeat(20)}${i}` })),
    });
    expect(digest).not.toBeNull();
    expect(digest!.length).toBeLessThanOrEqual(1200);
  });

  it('slices each event line to ~120 chars of text and squashes whitespace', () => {
    const digest = buildGazetteDigest({
      ...emptyInput(),
      events: [{ type: 'tax_collected', title: 'Taxes\n\ncollected', description: 'D'.repeat(500) }],
    });
    expect(digest).not.toBeNull();
    const [line] = digest!.split('\n');
    expect(line.startsWith('- Treasury: Taxes collected — ')).toBe(true);
    expect(line.length).toBeLessThanOrEqual('- Treasury: '.length + 120);
    expect(line).not.toContain('\n');
  });

  it('labels unknown event types generically', () => {
    const digest = buildGazetteDigest({
      ...emptyInput(),
      events: [{ type: 'something_new', title: 'T', description: 'D' }],
    });
    expect(digest).toBe('- Event: T — D');
  });

  it('keeps at least one bullet even when a single bullet is near the cap', () => {
    const digest = buildGazetteDigest({
      ...emptyInput(),
      passedBills: [{ title: 'T'.repeat(2000) }],
    });
    expect(digest).not.toBeNull();
    expect(digest!.length).toBeLessThanOrEqual(1200);
    expect(digest!.startsWith('- Bill passed: ')).toBe(true);
  });
});
