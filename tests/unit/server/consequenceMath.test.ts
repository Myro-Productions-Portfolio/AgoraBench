import { describe, it, expect } from 'vitest';
import {
  fiscalApprovalDelta,
  partyLeanFromAlignment,
  computeFiscalApprovalMoves,
  buildTenureFiscalRecord,
  type FiscalConsequenceState,
  type FiscalApprovalConfig,
  type Officeholder,
  type TenureFiscalRow,
} from '@core/server/lib/consequenceMath';

/** Plain formatter for deterministic assertions (contract-equal to compactDollars: signed, prefixed). */
const fmtPlain = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(n)}`;

const ZERO_CFG: FiscalApprovalConfig = {
  debtWeight: 0,
  treasuryWeight: 0,
  deficitWeight: 0,
  taxWeight: 0,
  partyWeight: 0,
  maxDeltaPerTick: 5,
  debtHealthBand: 1.0,
  debtCrisisBand: 1.5,
  taxNeutralRatePercent: 19,
  deficitCrisisRatio: 0.5,
};

/** A deliberately distressed baseline: high debt, drained treasury, deficit, high tax. */
const DISTRESSED: FiscalConsequenceState = {
  gdpAnnual: 28_000_000_000_000,
  debtOutstanding: 42_000_000_000_000, // 150% of GDP → crisis
  treasuryBalance: -500_000_000_000, // below zero, past the buffer
  taxRatePercent: 40, // well above neutral 19
  deficitPerTick: 8_000_000_000, // large positive deficit
  treasuryBufferDollars: 1_500_000_000_000,
};

/** A deliberately healthy baseline: no debt, treasury above buffer, surplus, low tax. */
const HEALTHY: FiscalConsequenceState = {
  gdpAnnual: 28_000_000_000_000,
  debtOutstanding: 0,
  treasuryBalance: 3_000_000_000_000, // above buffer
  taxRatePercent: 8, // below neutral 19
  deficitPerTick: -4_000_000_000, // surplus
  treasuryBufferDollars: 1_500_000_000_000,
};

describe('fiscalApprovalDelta — dark-safe zero-weight guarantee', () => {
  it('all-zero weights returns exactly 0 regardless of state', () => {
    expect(fiscalApprovalDelta(DISTRESSED, ZERO_CFG)).toBe(0);
    expect(fiscalApprovalDelta(HEALTHY, ZERO_CFG)).toBe(0);
  });

  it('all-zero weights with a party lean still returns exactly 0', () => {
    expect(fiscalApprovalDelta(DISTRESSED, ZERO_CFG, 1)).toBe(0);
    expect(fiscalApprovalDelta(DISTRESSED, ZERO_CFG, -1)).toBe(0);
  });
});

describe('fiscalApprovalDelta — each signal in isolation produces the expected sign', () => {
  it('debt signal alone: crisis debt → negative, zero debt → positive', () => {
    const cfg = { ...ZERO_CFG, debtWeight: 10 };
    expect(fiscalApprovalDelta(DISTRESSED, cfg)).toBeLessThan(0);
    expect(fiscalApprovalDelta(HEALTHY, cfg)).toBeGreaterThan(0);
  });

  it('treasury signal alone: drained treasury → negative, funded → positive', () => {
    const cfg = { ...ZERO_CFG, treasuryWeight: 10 };
    expect(fiscalApprovalDelta(DISTRESSED, cfg)).toBeLessThan(0);
    expect(fiscalApprovalDelta(HEALTHY, cfg)).toBeGreaterThan(0);
  });

  it('deficit signal alone: overspending → negative, surplus → positive', () => {
    const cfg = { ...ZERO_CFG, deficitWeight: 10 };
    expect(fiscalApprovalDelta(DISTRESSED, cfg)).toBeLessThan(0);
    expect(fiscalApprovalDelta(HEALTHY, cfg)).toBeGreaterThan(0);
  });

  it('tax signal alone: high rate → negative, low rate → positive', () => {
    const cfg = { ...ZERO_CFG, taxWeight: 10 };
    expect(fiscalApprovalDelta(DISTRESSED, cfg)).toBeLessThan(0);
    expect(fiscalApprovalDelta(HEALTHY, cfg)).toBeGreaterThan(0);
  });

  it('a signal with weight 0 contributes nothing — turning only its weight on changes the delta', () => {
    const off = fiscalApprovalDelta(DISTRESSED, { ...ZERO_CFG, maxDeltaPerTick: 1000 });
    const on = fiscalApprovalDelta(DISTRESSED, { ...ZERO_CFG, maxDeltaPerTick: 1000, taxWeight: 10 });
    expect(off).toBe(0);
    expect(on).not.toBe(0);
  });
});

describe('fiscalApprovalDelta — contributions sum', () => {
  it('all four signals together equals the sum of each in isolation (below the clamp)', () => {
    const big = { ...ZERO_CFG, maxDeltaPerTick: 1000 };
    const d = fiscalApprovalDelta(DISTRESSED, { ...big, debtWeight: 3 });
    const t = fiscalApprovalDelta(DISTRESSED, { ...big, treasuryWeight: 3 });
    const f = fiscalApprovalDelta(DISTRESSED, { ...big, deficitWeight: 3 });
    const x = fiscalApprovalDelta(DISTRESSED, { ...big, taxWeight: 3 });
    const all = fiscalApprovalDelta(DISTRESSED, {
      ...big,
      debtWeight: 3,
      treasuryWeight: 3,
      deficitWeight: 3,
      taxWeight: 3,
    });
    expect(all).toBeCloseTo(d + t + f + x, 6);
  });
});

describe('fiscalApprovalDelta — clamp to ±maxDeltaPerTick', () => {
  it('a fully distressed state with heavy weights clamps at -maxDeltaPerTick', () => {
    const cfg = { ...ZERO_CFG, debtWeight: 50, treasuryWeight: 50, deficitWeight: 50, taxWeight: 50, maxDeltaPerTick: 5 };
    expect(fiscalApprovalDelta(DISTRESSED, cfg)).toBe(-5);
  });

  it('a fully healthy state with heavy weights clamps at +maxDeltaPerTick', () => {
    const cfg = { ...ZERO_CFG, debtWeight: 50, treasuryWeight: 50, deficitWeight: 50, taxWeight: 50, maxDeltaPerTick: 5 };
    expect(fiscalApprovalDelta(HEALTHY, cfg)).toBe(5);
  });

  it('respects a different clamp value', () => {
    const cfg = { ...ZERO_CFG, debtWeight: 50, treasuryWeight: 50, deficitWeight: 50, taxWeight: 50, maxDeltaPerTick: 12 };
    expect(fiscalApprovalDelta(DISTRESSED, cfg)).toBe(-12);
  });
});

describe('fiscalApprovalDelta — symmetry', () => {
  it('a healthy state yields positive, a distressed state yields negative, under identical weights', () => {
    const cfg = { ...ZERO_CFG, debtWeight: 5, treasuryWeight: 5, deficitWeight: 5, taxWeight: 5 };
    expect(fiscalApprovalDelta(HEALTHY, cfg)).toBeGreaterThan(0);
    expect(fiscalApprovalDelta(DISTRESSED, cfg)).toBeLessThan(0);
  });
});

describe('fiscalApprovalDelta — party weighting', () => {
  const taxHeavy = { ...ZERO_CFG, taxWeight: 10, debtWeight: 10, maxDeltaPerTick: 1000, partyWeight: 1 };

  it('partyWeight=0 makes partyLean irrelevant', () => {
    const blind = { ...taxHeavy, partyWeight: 0 };
    const a = fiscalApprovalDelta(DISTRESSED, blind, 1);
    const b = fiscalApprovalDelta(DISTRESSED, blind, -1);
    const c = fiscalApprovalDelta(DISTRESSED, blind, 0);
    expect(a).toBe(c);
    expect(b).toBe(c);
  });

  it('partyWeight=1: a hawk (+lean) takes a deeper tax/debt penalty than a spender (-lean)', () => {
    const hawk = fiscalApprovalDelta(DISTRESSED, taxHeavy, 1);
    const spender = fiscalApprovalDelta(DISTRESSED, taxHeavy, -1);
    expect(hawk).toBeLessThan(spender);
  });

  it('partyWeight=1: a spender takes a deeper treasury-depletion penalty than a hawk', () => {
    const treasuryHeavy = { ...ZERO_CFG, treasuryWeight: 10, maxDeltaPerTick: 1000, partyWeight: 1 };
    const hawk = fiscalApprovalDelta(DISTRESSED, treasuryHeavy, 1);
    const spender = fiscalApprovalDelta(DISTRESSED, treasuryHeavy, -1);
    expect(spender).toBeLessThan(hawk);
  });

  it('non-finite partyLean is treated as neutral (no throw, finite result)', () => {
    const r = fiscalApprovalDelta(DISTRESSED, taxHeavy, NaN);
    expect(Number.isFinite(r)).toBe(true);
  });
});

describe('fiscalApprovalDelta — corrupt state never poisons the delta', () => {
  it('non-finite fiscal fields resolve to a finite delta', () => {
    const corrupt: FiscalConsequenceState = {
      gdpAnnual: NaN,
      debtOutstanding: Infinity,
      treasuryBalance: NaN,
      taxRatePercent: Infinity,
      deficitPerTick: NaN,
      treasuryBufferDollars: NaN,
    };
    const cfg = { ...ZERO_CFG, debtWeight: 10, treasuryWeight: 10, deficitWeight: 10, taxWeight: 10 };
    expect(Number.isFinite(fiscalApprovalDelta(corrupt, cfg))).toBe(true);
  });
});

describe('partyLeanFromAlignment', () => {
  it('maps the spectrum from spender (-1) to hawk (+1)', () => {
    expect(partyLeanFromAlignment('progressive')).toBe(-1);
    expect(partyLeanFromAlignment('moderate')).toBe(0);
    expect(partyLeanFromAlignment('conservative')).toBe(1);
    expect(partyLeanFromAlignment('libertarian')).toBeGreaterThan(0);
    expect(partyLeanFromAlignment('technocrat')).toBeLessThan(0);
  });

  it('null / unknown alignment is party-blind (0)', () => {
    expect(partyLeanFromAlignment(null)).toBe(0);
    expect(partyLeanFromAlignment(undefined)).toBe(0);
    expect(partyLeanFromAlignment('gibberish')).toBe(0);
  });
});

describe('computeFiscalApprovalMoves — the tick-phase helper (gate + filter + rounding)', () => {
  const OFFICEHOLDERS: Officeholder[] = [
    { agentId: 'a1', alignment: 'conservative' },
    { agentId: 'a2', alignment: 'progressive' },
    { agentId: 'a3', alignment: null },
  ];
  const HOT_CFG: FiscalApprovalConfig = {
    ...ZERO_CFG,
    debtWeight: 50,
    treasuryWeight: 50,
    deficitWeight: 50,
    taxWeight: 50,
    maxDeltaPerTick: 5,
  };

  it('DARK-SAFE: disabled → no moves regardless of state/weights', () => {
    expect(computeFiscalApprovalMoves(false, DISTRESSED, HOT_CFG, OFFICEHOLDERS)).toEqual([]);
    expect(computeFiscalApprovalMoves(false, HEALTHY, HOT_CFG, OFFICEHOLDERS)).toEqual([]);
  });

  it('enabled but all-zero weights → no moves (delta rounds to 0)', () => {
    expect(computeFiscalApprovalMoves(true, DISTRESSED, ZERO_CFG, OFFICEHOLDERS)).toEqual([]);
  });

  it('enabled + weights → one integer move per officeholder, clamped to ±max', () => {
    const moves = computeFiscalApprovalMoves(true, DISTRESSED, HOT_CFG, OFFICEHOLDERS);
    expect(moves).toHaveLength(3);
    for (const m of moves) {
      expect(Number.isInteger(m.delta)).toBe(true);
      expect(m.delta).toBeGreaterThanOrEqual(-5);
      expect(m.delta).toBeLessThanOrEqual(5);
      expect(m.delta).toBeLessThan(0); // distressed → penalty
    }
  });

  it('empty officeholder set → no moves even when enabled and distressed', () => {
    expect(computeFiscalApprovalMoves(true, DISTRESSED, HOT_CFG, [])).toEqual([]);
  });

  it('non-officeholders are simply absent — only the passed set is scored', () => {
    const moves = computeFiscalApprovalMoves(true, DISTRESSED, HOT_CFG, [OFFICEHOLDERS[0]]);
    expect(moves.map((m) => m.agentId)).toEqual(['a1']);
  });
});

describe('buildTenureFiscalRecord — ballot fiscal record (Slice 3)', () => {
  it('multi-tick tenure: avg deficit + treasury trajectory + tick count', () => {
    const rows: TenureFiscalRow[] = [
      { deficit: 4_000_000_000, treasuryEnd: 2_000_000_000_000 },
      { deficit: 6_000_000_000, treasuryEnd: 1_900_000_000_000 },
      { deficit: 5_000_000_000, treasuryEnd: 1_800_000_000_000 },
    ];
    expect(buildTenureFiscalRecord(rows, fmtPlain)).toBe(
      'fiscal record: avg deficit $5000000000/day, treasury $2000000000000→$1800000000000 over 3 ticks in office',
    );
  });

  it('single-tick tenure: singular "tick", start=end treasury', () => {
    const rows: TenureFiscalRow[] = [{ deficit: -3_000_000_000, treasuryEnd: 1_500_000_000_000 }];
    expect(buildTenureFiscalRecord(rows, fmtPlain)).toBe(
      'fiscal record: avg deficit -$3000000000/day, treasury $1500000000000→$1500000000000 over 1 tick in office',
    );
  });

  it('no tenure rows → null (caller emits no line; never fabricates)', () => {
    expect(buildTenureFiscalRecord([], fmtPlain)).toBeNull();
  });

  it('surplus tenure shows a negative average deficit', () => {
    const rows: TenureFiscalRow[] = [
      { deficit: -1_000_000_000, treasuryEnd: 1_000_000_000_000 },
      { deficit: -3_000_000_000, treasuryEnd: 1_050_000_000_000 },
    ];
    expect(buildTenureFiscalRecord(rows, fmtPlain)).toBe(
      'fiscal record: avg deficit -$2000000000/day, treasury $1000000000000→$1050000000000 over 2 ticks in office',
    );
  });

  it('non-finite fields degrade to 0 rather than emitting NaN', () => {
    const rows: TenureFiscalRow[] = [
      { deficit: NaN, treasuryEnd: Infinity },
      { deficit: 2_000_000_000, treasuryEnd: 900_000_000_000 },
    ];
    // deficit avg = (0 + 2e9)/2 = 1e9; first treasury coerces to 0.
    expect(buildTenureFiscalRecord(rows, fmtPlain)).toBe(
      'fiscal record: avg deficit $1000000000/day, treasury $0→$900000000000 over 2 ticks in office',
    );
  });

  it('formatting is delegated to the injected formatter (compactDollars-style)', () => {
    const compactStyle = (n: number): string => {
      const abs = Math.abs(n);
      if (abs >= 1e12) return `${n < 0 ? '-' : ''}$${abs / 1e12}T`;
      if (abs >= 1e9) return `${n < 0 ? '-' : ''}$${abs / 1e9}B`;
      return `${n < 0 ? '-' : ''}$${abs}`;
    };
    const rows: TenureFiscalRow[] = [
      { deficit: 5_000_000_000, treasuryEnd: 2_000_000_000_000 },
      { deficit: 5_000_000_000, treasuryEnd: 1_500_000_000_000 },
    ];
    expect(buildTenureFiscalRecord(rows, compactStyle)).toBe(
      'fiscal record: avg deficit $5B/day, treasury $2T→$1.5T over 2 ticks in office',
    );
  });
});
