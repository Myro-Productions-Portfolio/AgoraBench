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
  type CourtCaseTiming,
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
