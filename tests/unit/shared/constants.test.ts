import { describe, it, expect } from 'vitest';
import {
  GOVERNMENT,
  ELECTION,
  BILL_STATUSES,
  CAMPAIGN_STATUSES,
  ELECTION_STATUSES,
  POSITION_TYPES,
  COMMITTEE_TYPES,
  ALIGNMENTS,
  WS_EVENTS,
  PAGINATION,
  ECONOMY,
} from '@shared/constants';

describe('GOVERNMENT constants', () => {
  it('has correct executive term length', () => {
    expect(GOVERNMENT.EXECUTIVE.PRESIDENT_TERM_DAYS).toBe(90);
  });

  it('has 4 cabinet positions', () => {
    expect(GOVERNMENT.EXECUTIVE.CABINET_SIZE).toBe(4);
    expect(GOVERNMENT.EXECUTIVE.CABINET_POSITIONS).toHaveLength(4);
  });

  it('has 50 congress seats', () => {
    expect(GOVERNMENT.LEGISLATIVE.CONGRESS_SEATS).toBe(50);
  });

  it('has 60-day legislative terms', () => {
    expect(GOVERNMENT.LEGISLATIVE.TERM_DAYS).toBe(60);
  });

  it('has 4 committees', () => {
    expect(GOVERNMENT.LEGISLATIVE.COMMITTEES).toHaveLength(4);
  });

  it('has 7 supreme court justices', () => {
    expect(GOVERNMENT.JUDICIAL.SUPREME_COURT_JUSTICES).toBe(7);
  });
});

describe('ELECTION constants', () => {
  it('has a 14-day campaign duration', () => {
    expect(ELECTION.CAMPAIGN_DURATION_DAYS).toBe(14);
  });

  it('has a 48-hour voting window', () => {
    expect(ELECTION.VOTING_DURATION_HOURS).toBe(48);
  });

  it('requires minimum reputation to run', () => {
    expect(ELECTION.MIN_REPUTATION_TO_RUN).toBeGreaterThan(0);
  });
});

describe('status arrays', () => {
  it('BILL_STATUSES includes all lifecycle stages', () => {
    expect(BILL_STATUSES).toContain('proposed');
    expect(BILL_STATUSES).toContain('committee');
    expect(BILL_STATUSES).toContain('floor');
    expect(BILL_STATUSES).toContain('passed');
    expect(BILL_STATUSES).toContain('failed');
    expect(BILL_STATUSES).toContain('vetoed');
    expect(BILL_STATUSES).toContain('law');
  });

  it('CAMPAIGN_STATUSES includes expected values', () => {
    expect(CAMPAIGN_STATUSES).toContain('active');
    expect(CAMPAIGN_STATUSES).toContain('won');
    expect(CAMPAIGN_STATUSES).toContain('lost');
  });

  it('ELECTION_STATUSES has correct flow', () => {
    expect(ELECTION_STATUSES).toEqual([
      'scheduled',
      'registration',
      'campaigning',
      'voting',
      'counting',
      'certified',
    ]);
  });

  it('POSITION_TYPES includes all government positions', () => {
    expect(POSITION_TYPES).toContain('president');
    expect(POSITION_TYPES).toContain('congress_member');
    expect(POSITION_TYPES).toContain('supreme_justice');
  });

  it('COMMITTEE_TYPES matches government structure', () => {
    expect(COMMITTEE_TYPES).toEqual(['Budget', 'Technology', 'Foreign Affairs', 'Judiciary']);
  });

  it('ALIGNMENTS covers political spectrum', () => {
    expect(ALIGNMENTS).toContain('progressive');
    expect(ALIGNMENTS).toContain('moderate');
    expect(ALIGNMENTS).toContain('conservative');
    expect(ALIGNMENTS).toContain('technocrat');
  });
});

describe('WS_EVENTS', () => {
  it('has all expected WebSocket events', () => {
    expect(WS_EVENTS.ELECTION_VOTE_CAST).toBe('election:vote_cast');
    expect(WS_EVENTS.LEGISLATION_NEW_BILL).toBe('legislation:new_bill');
    expect(WS_EVENTS.LEGISLATION_VOTE_RESULT).toBe('legislation:vote_result');
    expect(WS_EVENTS.GOVERNMENT_OFFICIAL_ELECTED).toBe('government:official_elected');
    expect(WS_EVENTS.DEBATE_NEW_MESSAGE).toBe('debate:new_message');
    expect(WS_EVENTS.HEARTBEAT).toBe('heartbeat');
  });
});

describe('PAGINATION', () => {
  it('has reasonable defaults', () => {
    expect(PAGINATION.DEFAULT_PAGE).toBe(1);
    expect(PAGINATION.DEFAULT_LIMIT).toBe(20);
    expect(PAGINATION.MAX_LIMIT).toBe(100);
  });
});

describe('ECONOMY', () => {
  it('uses MoltDollar currency', () => {
    expect(ECONOMY.CURRENCY_SYMBOL).toBe('M$');
    expect(ECONOMY.CURRENCY_NAME).toBe('MoltDollar');
  });

  it('has initial agent balance', () => {
    expect(ECONOMY.INITIAL_AGENT_BALANCE).toBeGreaterThan(0);
  });

  it('has filing and creation fees', () => {
    expect(ECONOMY.CAMPAIGN_FILING_FEE).toBeGreaterThan(0);
    expect(ECONOMY.PARTY_CREATION_FEE).toBeGreaterThan(0);
  });

  it('has salary tiers for each position', () => {
    expect(ECONOMY.SALARY.PRESIDENT).toBeGreaterThan(ECONOMY.SALARY.CONGRESS);
  });
});
