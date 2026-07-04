import { describe, it, expect } from 'vitest';
import {
  deriveBannerTargetDate,
  deriveBannerTitle,
  deriveBannerDescription,
  type ActiveElection,
} from '../../../src/modules/elections/client/hooks/activeElectionBanner';

const base: ActiveElection = {
  id: 'e1',
  title: 'Presidential Election',
  type: 'presidential',
  status: 'voting',
  votingStartsAt: null,
  votingEndsAt: null,
  scheduledDate: '2026-08-01T00:00:00.000Z',
};

describe('deriveBannerTargetDate', () => {
  it('returns null when there is no active election', () => {
    expect(deriveBannerTargetDate(null)).toBeNull();
  });

  it('prefers votingEndsAt when voting is active', () => {
    const el: ActiveElection = {
      ...base,
      votingEndsAt: '2026-07-10T00:00:00.000Z',
      votingStartsAt: '2026-07-05T00:00:00.000Z',
    };
    expect(deriveBannerTargetDate(el)).toEqual(new Date('2026-07-10T00:00:00.000Z'));
  });

  it('falls back to votingStartsAt when voting has not ended', () => {
    const el: ActiveElection = { ...base, votingStartsAt: '2026-07-05T00:00:00.000Z' };
    expect(deriveBannerTargetDate(el)).toEqual(new Date('2026-07-05T00:00:00.000Z'));
  });

  it('falls back to scheduledDate when no voting window is set', () => {
    expect(deriveBannerTargetDate(base)).toEqual(new Date('2026-08-01T00:00:00.000Z'));
  });
});

describe('deriveBannerTitle', () => {
  it('returns a generic fallback when there is no active election', () => {
    expect(deriveBannerTitle(null)).toBe('Election');
  });

  it('returns the election title when active', () => {
    expect(deriveBannerTitle(base)).toBe('Presidential Election');
  });
});

describe('deriveBannerDescription', () => {
  it('shows only the candidate count when there is no active election', () => {
    expect(deriveBannerDescription(null, 3)).toBe('3 candidates declared.');
  });

  it('appends the election status when active', () => {
    expect(deriveBannerDescription(base, 3)).toBe('3 candidates declared. Status: voting.');
  });

  it('uses the singular form for exactly one candidate', () => {
    expect(deriveBannerDescription(null, 1)).toBe('1 candidate declared.');
    expect(deriveBannerDescription(base, 1)).toBe('1 candidate declared. Status: voting.');
  });

  it('handles zero candidates', () => {
    expect(deriveBannerDescription(null, 0)).toBe('0 candidates declared.');
  });
});
