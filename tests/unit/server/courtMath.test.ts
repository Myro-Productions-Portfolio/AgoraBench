import { describe, it, expect } from 'vitest';
import {
  ACTIVE_CASE_STATUSES,
  STALL_GRACE_TICKS,
  docketDue,
  hearingDue,
  deliberationDue,
  decisionDue,
  expectedStageTick,
  isStalled,
  extractCaseNumbers,
  distillHolding,
  buildPrecedentBlock,
  buildPrecedentInjection,
  HOLDING_MAX_LEN,
  type CourtCaseTiming,
  type PrecedentSummary,
} from '@core/server/lib/courtMath';

/*
 * NOTE ON SCOPE: courtMath.ts contains ONLY the pure tick-timing gate logic
 * for the judicial arc's stage machine (filed -> docketed -> argued ->
 * deliberating -> decided). It does NOT contain vote-tallying, majority
 * threshold, or damages math — that logic (votesFor/votesAgainst tally,
 * petitionerWins = votesFor >= votesAgainst, damages clamped to loser
 * balance) lives inline in src/core/server/jobs/agentTick.ts Phase 10
 * (around line 3555-3780), coupled to DB transactions and LLM vote calls.
 * It was never extracted into a standalone pure module, so there is no
 * majority/damages function to unit test in isolation without mocking the
 * whole tick transaction — out of scope for "pure-logic module" regression
 * tests. This file covers the actual exported contract of courtMath.ts.
 */

function timing(overrides: Partial<CourtCaseTiming> = {}): CourtCaseTiming {
  return {
    status: 'filed',
    filedTick: 100,
    hearingTick: null,
    ...overrides,
  };
}

describe('ACTIVE_CASE_STATUSES', () => {
  it('contains exactly the four in-flight statuses, in stage order', () => {
    expect(ACTIVE_CASE_STATUSES).toEqual(['filed', 'docketed', 'argued', 'deliberating']);
  });

  it('does not include terminal statuses', () => {
    expect(ACTIVE_CASE_STATUSES).not.toContain('decided');
    expect(ACTIVE_CASE_STATUSES).not.toContain('dismissed');
  });
});

describe('STALL_GRACE_TICKS', () => {
  it('is 2', () => {
    expect(STALL_GRACE_TICKS).toBe(2);
  });
});

describe('docketDue — Stage B gate', () => {
  it('is false before filedTick + 1', () => {
    expect(docketDue(timing({ status: 'filed', filedTick: 100 }), 100)).toBe(false);
  });

  it('fires exactly at filedTick + 1', () => {
    expect(docketDue(timing({ status: 'filed', filedTick: 100 }), 101)).toBe(true);
  });

  it('stays true past due (restart robustness)', () => {
    expect(docketDue(timing({ status: 'filed', filedTick: 100 }), 500)).toBe(true);
  });

  it('is false for any status other than filed', () => {
    for (const status of ['docketed', 'argued', 'deliberating', 'decided', 'dismissed']) {
      expect(docketDue(timing({ status, filedTick: 100 }), 200)).toBe(false);
    }
  });

  it('rejects non-finite tickNumber or filedTick', () => {
    expect(docketDue(timing({ filedTick: 100 }), NaN)).toBe(false);
    expect(docketDue(timing({ filedTick: 100 }), Infinity)).toBe(false);
    expect(docketDue(timing({ filedTick: NaN }), 200)).toBe(false);
  });
});

describe('hearingDue — Stage C gate', () => {
  it('is false before hearingTick', () => {
    expect(hearingDue(timing({ status: 'docketed', hearingTick: 110 }), 109)).toBe(false);
  });

  it('fires exactly at hearingTick', () => {
    expect(hearingDue(timing({ status: 'docketed', hearingTick: 110 }), 110)).toBe(true);
  });

  it('stays true past due', () => {
    expect(hearingDue(timing({ status: 'docketed', hearingTick: 110 }), 500)).toBe(true);
  });

  it('is false for any status other than docketed', () => {
    for (const status of ['filed', 'argued', 'deliberating', 'decided']) {
      expect(hearingDue(timing({ status, hearingTick: 110 }), 200)).toBe(false);
    }
  });

  it('is false when hearingTick is null (postponement never happened / not yet scheduled)', () => {
    expect(hearingDue(timing({ status: 'docketed', hearingTick: null }), 200)).toBe(false);
  });

  it('rejects non-finite hearingTick or tickNumber', () => {
    expect(hearingDue(timing({ status: 'docketed', hearingTick: NaN }), 200)).toBe(false);
    expect(hearingDue(timing({ status: 'docketed', hearingTick: 110 }), NaN)).toBe(false);
    expect(hearingDue(timing({ status: 'docketed', hearingTick: Infinity }), 200)).toBe(false);
  });
});

describe('deliberationDue — Stage D gate (7-justice vote occurs after this fires)', () => {
  it('is false before hearingTick + 1', () => {
    expect(deliberationDue(timing({ status: 'argued', hearingTick: 110 }), 110)).toBe(false);
  });

  it('fires exactly at hearingTick + 1', () => {
    expect(deliberationDue(timing({ status: 'argued', hearingTick: 110 }), 111)).toBe(true);
  });

  it('stays true past due', () => {
    expect(deliberationDue(timing({ status: 'argued', hearingTick: 110 }), 500)).toBe(true);
  });

  it('is false for any status other than argued', () => {
    for (const status of ['filed', 'docketed', 'deliberating', 'decided']) {
      expect(deliberationDue(timing({ status, hearingTick: 110 }), 200)).toBe(false);
    }
  });

  it('is false when hearingTick is null', () => {
    expect(deliberationDue(timing({ status: 'argued', hearingTick: null }), 200)).toBe(false);
  });

  it('rejects non-finite hearingTick or tickNumber', () => {
    expect(deliberationDue(timing({ status: 'argued', hearingTick: NaN }), 200)).toBe(false);
    expect(deliberationDue(timing({ status: 'argued', hearingTick: 110 }), NaN)).toBe(false);
  });
});

describe('decisionDue — Stage E gate (ruling comes down)', () => {
  it('is false before hearingTick + 2', () => {
    expect(decisionDue(timing({ status: 'deliberating', hearingTick: 110 }), 111)).toBe(false);
  });

  it('fires exactly at hearingTick + 2', () => {
    expect(decisionDue(timing({ status: 'deliberating', hearingTick: 110 }), 112)).toBe(true);
  });

  it('stays true past due', () => {
    expect(decisionDue(timing({ status: 'deliberating', hearingTick: 110 }), 500)).toBe(true);
  });

  it('is false for any status other than deliberating', () => {
    for (const status of ['filed', 'docketed', 'argued', 'decided']) {
      expect(decisionDue(timing({ status, hearingTick: 110 }), 200)).toBe(false);
    }
  });

  it('is false when hearingTick is null', () => {
    expect(decisionDue(timing({ status: 'deliberating', hearingTick: null }), 200)).toBe(false);
  });

  it('rejects non-finite hearingTick or tickNumber', () => {
    expect(decisionDue(timing({ status: 'deliberating', hearingTick: NaN }), 200)).toBe(false);
    expect(decisionDue(timing({ status: 'deliberating', hearingTick: 110 }), NaN)).toBe(false);
  });
});

describe('expectedStageTick', () => {
  it('filed: filedTick + 1', () => {
    expect(expectedStageTick(timing({ status: 'filed', filedTick: 100 }))).toBe(101);
  });

  it('docketed: hearingTick (unshifted — Stage C postponements push this forward directly)', () => {
    expect(expectedStageTick(timing({ status: 'docketed', hearingTick: 110 }))).toBe(110);
  });

  it('argued: hearingTick + 1', () => {
    expect(expectedStageTick(timing({ status: 'argued', hearingTick: 110 }))).toBe(111);
  });

  it('deliberating: hearingTick + 2', () => {
    expect(expectedStageTick(timing({ status: 'deliberating', hearingTick: 110 }))).toBe(112);
  });

  it('is null for terminal statuses (decided/dismissed) — never stalled', () => {
    expect(expectedStageTick(timing({ status: 'decided' }))).toBeNull();
    expect(expectedStageTick(timing({ status: 'dismissed' }))).toBeNull();
    expect(expectedStageTick(timing({ status: 'garbage-status' }))).toBeNull();
  });

  it('is null when filedTick is non-finite for a filed case', () => {
    expect(expectedStageTick(timing({ status: 'filed', filedTick: NaN }))).toBeNull();
  });

  it('is null when hearingTick is null or non-finite for docketed/argued/deliberating', () => {
    expect(expectedStageTick(timing({ status: 'docketed', hearingTick: null }))).toBeNull();
    expect(expectedStageTick(timing({ status: 'argued', hearingTick: null }))).toBeNull();
    expect(expectedStageTick(timing({ status: 'deliberating', hearingTick: NaN }))).toBeNull();
  });
});

describe('isStalled', () => {
  it('is false when within STALL_GRACE_TICKS of the expected stage tick', () => {
    // filed at 100, expected stage tick 101, grace = 2 -> not stalled through tick 103
    expect(isStalled(timing({ status: 'filed', filedTick: 100 }), 101)).toBe(false);
    expect(isStalled(timing({ status: 'filed', filedTick: 100 }), 103)).toBe(false);
  });

  it('fires exactly one tick past the grace window (overdue > STALL_GRACE_TICKS)', () => {
    expect(isStalled(timing({ status: 'filed', filedTick: 100 }), 104)).toBe(true);
  });

  it('never stalls a case with no expected stage tick (terminal status)', () => {
    expect(isStalled(timing({ status: 'decided' }), 100_000)).toBe(false);
    expect(isStalled(timing({ status: 'dismissed' }), 100_000)).toBe(false);
  });

  it('never stalls when timing columns are unusable (null hearingTick on docketed)', () => {
    expect(isStalled(timing({ status: 'docketed', hearingTick: null }), 100_000)).toBe(false);
  });

  it('rejects non-finite tickNumber', () => {
    expect(isStalled(timing({ status: 'filed', filedTick: 100 }), NaN)).toBe(false);
    expect(isStalled(timing({ status: 'filed', filedTick: 100 }), Infinity)).toBe(false);
  });

  it('resets per postponement for docketed cases (hearingTick pushed forward)', () => {
    // First hearingTick was 110, now postponed to 130 — stall clock restarts from 130.
    expect(isStalled(timing({ status: 'docketed', hearingTick: 130 }), 132)).toBe(false); // 2 ticks over, within grace
    expect(isStalled(timing({ status: 'docketed', hearingTick: 130 }), 133)).toBe(true); // 3 ticks over, stalled
  });

  it('covers each active stage stalling independently', () => {
    expect(isStalled(timing({ status: 'argued', hearingTick: 110 }), 114)).toBe(true); // expected 111, overdue by 3
    expect(isStalled(timing({ status: 'argued', hearingTick: 110 }), 113)).toBe(false); // overdue by 2, within grace
    expect(isStalled(timing({ status: 'deliberating', hearingTick: 110 }), 115)).toBe(true); // expected 112, overdue by 3
    expect(isStalled(timing({ status: 'deliberating', hearingTick: 110 }), 114)).toBe(false); // overdue by 2, within grace
  });
});

describe('extractCaseNumbers — cross-case reference scanner', () => {
  it('extracts a single case number from prose', () => {
    expect(extractCaseNumbers('See AB-42-1 for the controlling precedent.')).toEqual(['AB-42-1']);
  });

  it('extracts multiple distinct case numbers in first-seen order', () => {
    expect(
      extractCaseNumbers('AB-10-2 distinguished AB-3-1, which followed AB-100-7.'),
    ).toEqual(['AB-10-2', 'AB-3-1', 'AB-100-7']);
  });

  it('dedups repeated references, preserving first-seen order', () => {
    expect(
      extractCaseNumbers('AB-5-1 and again AB-5-1, then AB-7-2, then AB-5-1.'),
    ).toEqual(['AB-5-1', 'AB-7-2']);
  });

  it('handles multi-digit filed ticks and sequence numbers', () => {
    expect(extractCaseNumbers('AB-1234-56')).toEqual(['AB-1234-56']);
  });

  it('respects word boundaries — no partial or glued matches', () => {
    // Leading word char blocks the match; the AB- token must start on a boundary.
    expect(extractCaseNumbers('XAB-1-2')).toEqual([]);
    // Trailing extra digit segment is not part of the AB-N-N shape, so the run
    // "AB-1-2-3" still yields the AB-1-2 token via the \b before the 3rd dash.
    expect(extractCaseNumbers('ref AB-1-2 done')).toEqual(['AB-1-2']);
  });

  it('does not match malformed or lowercase tokens', () => {
    expect(extractCaseNumbers('ab-1-2')).toEqual([]);
    expect(extractCaseNumbers('AB-1')).toEqual([]);
    expect(extractCaseNumbers('AB--1-2')).toEqual([]);
    expect(extractCaseNumbers('AB-x-2')).toEqual([]);
  });

  it('returns empty for garbage, empty, and non-string input', () => {
    expect(extractCaseNumbers('')).toEqual([]);
    expect(extractCaseNumbers('no case numbers here at all')).toEqual([]);
    // Defensive: non-string inputs (corrupt DB text columns) never throw.
    expect(extractCaseNumbers(null as unknown as string)).toEqual([]);
    expect(extractCaseNumbers(undefined as unknown as string)).toEqual([]);
    expect(extractCaseNumbers(42 as unknown as string)).toEqual([]);
  });

  it('finds case numbers embedded mid-sentence and across newlines', () => {
    expect(
      extractCaseNumbers('The Court in\nAB-9-9\nheld otherwise; cf. AB-8-1.'),
    ).toEqual(['AB-9-9', 'AB-8-1']);
  });
});

describe('distillHolding — first-sentence precedent summary', () => {
  it('returns the first sentence of a multi-sentence opinion', () => {
    expect(
      distillHolding('The law is struck down. It violates Article 2. Reversed.'),
    ).toBe('The law is struck down.');
  });

  it('handles ! and ? sentence terminators', () => {
    expect(distillHolding('We reverse! The rest is dicta.')).toBe('We reverse!');
    expect(distillHolding('Is the law valid? We think not.')).toBe('Is the law valid?');
  });

  it('uses the whole text when there is no sentence boundary', () => {
    expect(distillHolding('A single clause with no terminator')).toBe(
      'A single clause with no terminator',
    );
  });

  it('normalizes internal whitespace and trims', () => {
    expect(distillHolding('  The   Court\n\tholds  otherwise.  More text.')).toBe(
      'The Court holds otherwise.',
    );
  });

  it('is empty-safe for null, empty, and whitespace-only input', () => {
    expect(distillHolding(null)).toBe('');
    expect(distillHolding('')).toBe('');
    expect(distillHolding('   \n\t  ')).toBe('');
  });

  it('is defensive against non-string input', () => {
    expect(distillHolding(42 as unknown as string)).toBe('');
    expect(distillHolding(undefined as unknown as string)).toBe('');
  });

  it('hard-caps a long first sentence with an ellipsis at the default max', () => {
    const long = `${'a'.repeat(500)}.`;
    const out = distillHolding(long);
    expect(out.length).toBe(HOLDING_MAX_LEN);
    expect(out.endsWith('...')).toBe(true);
  });

  it('does not ellipsize a first sentence exactly at the boundary', () => {
    // 199 chars of body + terminator '.' = 200 chars == maxLen, no truncation.
    const exact = `${'b'.repeat(199)}.`;
    expect(exact.length).toBe(HOLDING_MAX_LEN);
    const out = distillHolding(exact);
    expect(out).toBe(exact);
    expect(out.endsWith('...')).toBe(false);
  });

  it('respects a custom maxLen (ellipsized, never exceeding the cap)', () => {
    // trimEnd() before the ellipsis avoids a dangling space, so length may be
    // slightly under the cap — the contract is "<= maxLen and ellipsized".
    const out = distillHolding('This is a fairly long single sentence with no early stop', 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith('...')).toBe(true);
  });
});

describe('buildPrecedentBlock — compact numbered precedent lines', () => {
  function summary(overrides: Partial<PrecedentSummary> = {}): PrecedentSummary {
    return {
      caseNumber: 'AB-12-1',
      caption: 'Doe v. Agora',
      outcome: 'struck_down',
      votesFor: 3,
      votesAgainst: 2,
      holding: 'The law is unconstitutional.',
      ...overrides,
    };
  }

  it('formats one precedent as a numbered line', () => {
    expect(buildPrecedentBlock([summary()])).toBe(
      '1. AB-12-1 "Doe v. Agora" — struck_down (3-2): The law is unconstitutional.',
    );
  });

  it('numbers multiple precedents in order, one per line', () => {
    const block = buildPrecedentBlock([
      summary({ caseNumber: 'AB-1-1' }),
      summary({ caseNumber: 'AB-2-1', outcome: 'upheld', votesFor: 1, votesAgainst: 4 }),
    ]);
    const lines = block.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith('1. AB-1-1')).toBe(true);
    expect(lines[1]).toBe('2. AB-2-1 "Doe v. Agora" — upheld (1-4): The law is unconstitutional.');
  });

  it('omits the trailing holding segment when the holding is empty', () => {
    expect(buildPrecedentBlock([summary({ holding: '' })])).toBe(
      '1. AB-12-1 "Doe v. Agora" — struck_down (3-2)',
    );
  });

  it('falls back to "decided" when outcome is null', () => {
    expect(buildPrecedentBlock([summary({ outcome: null })])).toBe(
      '1. AB-12-1 "Doe v. Agora" — decided (3-2): The law is unconstitutional.',
    );
  });

  it('returns empty string for an empty or non-array input', () => {
    expect(buildPrecedentBlock([])).toBe('');
    expect(buildPrecedentBlock(null as unknown as PrecedentSummary[])).toBe('');
  });
});

describe('buildPrecedentInjection — full prompt block or nothing', () => {
  const one: PrecedentSummary = {
    caseNumber: 'AB-12-1',
    caption: 'Doe v. Agora',
    outcome: 'struck_down',
    votesFor: 3,
    votesAgainst: 2,
    holding: 'The law is unconstitutional.',
  };

  it('appends NOTHING when there is no precedent (zero prompt cost)', () => {
    expect(buildPrecedentInjection([])).toBe('');
  });

  it('wraps the block in the citation instruction when precedent exists', () => {
    const out = buildPrecedentInjection([one]);
    expect(out.startsWith('Relevant precedent of this Court:\n')).toBe(true);
    expect(out).toContain('1. AB-12-1 "Doe v. Agora" — struck_down (3-2)');
    expect(out).toContain('cite it by case number');
    expect(out).toContain('If you depart from precedent, acknowledge it.');
  });

  it('keeps a full 5-precedent block within a low-hundreds-token budget', () => {
    const five = Array.from({ length: 5 }, (_, i) => ({
      ...one,
      caseNumber: `AB-${i + 1}-1`,
      holding: 'a'.repeat(HOLDING_MAX_LEN),
    }));
    const out = buildPrecedentInjection(five);
    // ~4 chars/token heuristic — a 5-precedent block must stay well under
    // ~400 tokens so it never crowds the constitution block on a 12-17s call.
    expect(out.length / 4).toBeLessThan(400);
  });
});
