import { describe, it, expect } from 'vitest';
import {
  parseFredValue,
  normalizeUnrateObservations,
  normalizeCpiYoY,
  normalizeGdpGrowth,
  congressElapsedFraction,
  congressThroughputValue,
  congressMedianPassageDays,
  parseBallotpediaCongressionalApproval,
  inferPollEndDate,
  bridgeTierARows,
  type FredObservation,
  type CongressLawListItem,
} from '@modules/government/server/lib/scoreboardFeed';
import { METRIC_KEYS } from '@core/server/lib/scoreboardMath';
import { readFileSync } from 'fs';
import { join } from 'path';
import fredFixture from '../../fixtures/reality/fred_observations.json';
import lawListFixture from '../../fixtures/reality/congress_law_list.json';
import billDetailFixture from '../../fixtures/reality/congress_bill_detail.json';

/* Provenance: congress_* fixtures and ballotpedia_polling_index.html are
   trimmed REAL captures (api.congress.gov + ballotpedia.org, 2026-08-19).
   fred_observations.json is in the DOCUMENTED response shape only -- FRED
   requires an api_key and none existed at build time; shape cross-confirmed
   against the pyfredapi and fredr client docs (see the fixture's _note). */

const ballotpediaHtml = readFileSync(
  join(__dirname, '../../fixtures/reality/ballotpedia_polling_index.html'),
  'utf-8',
);

describe('parseFredValue', () => {
  it("parses decimal strings and treats '.' (FRED missing-value) as null", () => {
    expect(parseFredValue('4.2')).toBe(4.2);
    expect(parseFredValue('.')).toBeNull();
    expect(parseFredValue('')).toBeNull();
    expect(parseFredValue(undefined)).toBeNull();
    expect(parseFredValue('n/a')).toBeNull();
  });
});

describe('normalizeUnrateObservations', () => {
  const obs = fredFixture.unrate.observations as FredObservation[];

  it('emits one reality row per valid monthly observation, skipping missing months', () => {
    const rows = normalizeUnrateObservations(obs);
    expect(rows).toHaveLength(3); // the '.' month drops
    expect(rows[0]).toMatchObject({
      metricKey: METRIC_KEYS.unemploymentRate,
      side: 'reality',
      value: 4.2,
      atDate: '2026-07-01',
      atTick: null,
    });
  });
});

describe('normalizeCpiYoY', () => {
  const obs = fredFixture.cpiaucsl.observations as FredObservation[];

  it('computes the 12-month % change per month that has a year-earlier pair', () => {
    const rows = normalizeCpiYoY(obs);
    // Fixture spans 2026-06 back to 2025-05: only 2026-06 and 2026-05 have pairs.
    expect(rows).toHaveLength(2);
    const byDate = new Map(rows.map((r) => [r.atDate, r.value]));
    expect(byDate.get('2026-06-01')).toBeCloseTo((325.0 / 315.5 - 1) * 100, 2);
    expect(byDate.get('2026-05-01')).toBeCloseTo((324.1 / 314.7 - 1) * 100, 2);
  });

  it('emits nothing when no year-apart pairs exist', () => {
    expect(normalizeCpiYoY(obs.slice(0, 3))).toHaveLength(0);
  });
});

describe('normalizeGdpGrowth', () => {
  const obs = fredFixture.gdp.observations as FredObservation[];

  it('computes annualized quarter-over-quarter growth per consecutive-quarter pair', () => {
    const rows = normalizeGdpGrowth(obs);
    expect(rows).toHaveLength(4); // 5 quarters -> 4 pairs
    const latest = rows.find((r) => r.atDate === '2026-04-01')!;
    expect(latest.metricKey).toBe(METRIC_KEYS.gdpGrowth);
    expect(latest.value).toBeCloseTo((Math.pow(30612.4 / 30353.9, 4) - 1) * 100, 2);
  });
});

describe('congressElapsedFraction', () => {
  it('anchors the 119th Congress to Jan 3 2025 -> Jan 3 2027', () => {
    expect(congressElapsedFraction('2025-01-03')).toBe(0);
    expect(congressElapsedFraction('2026-01-03')).toBeCloseTo(0.5, 5);
    expect(congressElapsedFraction('2027-01-03')).toBe(1);
    expect(congressElapsedFraction('2030-01-01')).toBe(1); // clamped
  });
});

describe('congressThroughputValue', () => {
  it('projects the full-session total by expected back-loaded share, not elapsed fraction', () => {
    // At exactly half the session the expected share is 0.33 + (0.02/0.52)*0.67,
    // NOT 0.5 -- the whole point of session-relative normalization.
    const expectedShare = 0.33 + (0.02 / 0.52) * 0.67;
    expect(congressThroughputValue(104, '2026-01-03')).toBeCloseTo(104 / expectedShare, 1);
  });

  it('nulls out before the session starts', () => {
    expect(congressThroughputValue(10, '2024-06-01')).toBeNull();
  });

  it('the real captured list carries the enacted count in pagination.count', () => {
    expect(lawListFixture.pagination.count).toBe(104);
    const items = lawListFixture.bills as CongressLawListItem[];
    expect(items[0].latestAction?.actionDate).toBe('2026-07-12');
  });
});

describe('congressMedianPassageDays', () => {
  it('computes introduction -> became-law days from the real captured detail', () => {
    const introducedDate = billDetailFixture.bill.introducedDate; // 2025-01-15
    const becameLawDate = billDetailFixture.bill.latestAction.actionDate; // 2026-05-11
    expect(congressMedianPassageDays([{ introducedDate, becameLawDate }])).toBe(481);
  });

  it('takes the median across laws and skips unparseable/inverted pairs', () => {
    const days = congressMedianPassageDays([
      { introducedDate: '2025-01-01', becameLawDate: '2025-01-11' }, // 10
      { introducedDate: '2025-01-01', becameLawDate: '2025-02-10' }, // 40
      { introducedDate: '2025-01-01', becameLawDate: '2025-04-11' }, // 100
      { introducedDate: '2025-05-01', becameLawDate: '2025-01-01' }, // inverted -> skipped
      { introducedDate: 'garbage', becameLawDate: '2025-01-01' }, // skipped
    ]);
    expect(days).toBe(40);
  });

  it('nulls out on no valid pairs', () => {
    expect(congressMedianPassageDays([])).toBeNull();
  });
});

describe('inferPollEndDate', () => {
  it('anchors a year-less M/D-M/D range to the fetch year', () => {
    expect(inferPollEndDate('7/25-7/27', '2026-08-19')).toBe('2026-07-27');
  });

  it('rolls back a year when the range would land in the future (December poll read in January)', () => {
    expect(inferPollEndDate('12/28-12/30', '2026-01-05')).toBe('2025-12-30');
  });

  it('returns null for unrecognizable ranges', () => {
    expect(inferPollEndDate('last week', '2026-08-19')).toBeNull();
    expect(inferPollEndDate('', '2026-08-19')).toBeNull();
  });
});

describe('parseBallotpediaCongressionalApproval', () => {
  it('reads the labeled 30-day congressional average from the real captured page', () => {
    const parsed = parseBallotpediaCongressionalApproval(ballotpediaHtml, '2026-08-19');
    expect(parsed).not.toBeNull();
    expect(parsed!.approvePct).toBe(14);
    expect(parsed!.disapprovePct).toBe(67);
    // Newest Cong. Approval poll on the captured page ran 7/25-7/27.
    expect(parsed!.latestPollEndDate).toBe('2026-07-27');
  });

  it('falls back to the newest individual congressional poll row when the average row is missing', () => {
    const withoutAverage = ballotpediaHtml.replace('Congressional approval (average):', 'REMOVED');
    const parsed = parseBallotpediaCongressionalApproval(withoutAverage, '2026-08-19');
    expect(parsed).not.toBeNull();
    expect(parsed!.approvePct).toBe(14);
  });

  it('returns null (never throws) on an unrecognizable page', () => {
    expect(parseBallotpediaCongressionalApproval('<html><body>redesigned</body></html>', '2026-08-19')).toBeNull();
    expect(parseBallotpediaCongressionalApproval('', '2026-08-19')).toBeNull();
  });
});

describe('bridgeTierARows', () => {
  // Real MTS/debt values from the existing reality fixtures (May/July 2026).
  const topLine = {
    recordDate: '2026-05-31',
    outlaysFytd: 4_901_851_413_143,
    receiptsFytd: 3_655_648_146_756,
    deficitFytd: 1_246_203_266_386,
  };
  const debt = { recordDate: '2026-07-03', debtOutstanding: 39_375_989_952_866 };
  const GDP = 28_000_000_000_000;

  it('derives all four Tier A reality rows with the right dates and units', () => {
    const rows = bridgeTierARows({ topLine, debt, gdpAnnual: GDP });
    const byKey = new Map(rows.map((r) => [r.metricKey, r]));

    // FY2026 day 242 as of 2026-05-31 (Oct 1 fiscal-year start).
    expect(byKey.get(METRIC_KEYS.deficitPerDay)).toMatchObject({
      side: 'reality',
      atTick: null,
      atDate: '2026-05-31',
      value: Math.round(1_246_203_266_386 / 242),
    });
    expect(byKey.get(METRIC_KEYS.debtToGdp)).toMatchObject({ value: 140.6, atDate: '2026-07-03' });
    expect(byKey.get(METRIC_KEYS.spendingPctGdp)!.value).toBe(26.4);
    expect(byKey.get(METRIC_KEYS.taxBurdenPctGdp)!.value).toBe(19.7);
  });

  it('emits only what the available snapshots support', () => {
    expect(bridgeTierARows({ topLine: null, debt, gdpAnnual: GDP })).toHaveLength(1);
    expect(bridgeTierARows({ topLine: null, debt: null, gdpAnnual: GDP })).toHaveLength(0);
    const noDeficit = { ...topLine, deficitFytd: null };
    const rows = bridgeTierARows({ topLine: noDeficit, debt: null, gdpAnnual: GDP });
    expect(rows.map((r) => r.metricKey).sort()).toEqual([METRIC_KEYS.spendingPctGdp, METRIC_KEYS.taxBurdenPctGdp].sort());
  });
});
