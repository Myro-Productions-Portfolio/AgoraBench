import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/* Source-structural pins. The campaign-realism non-negotiables are about
   WHERE code lives (legacy mint verbatim in the else branch; engine module
   fiscally inert; zero Math.random in Phase 15) — behavior tests cannot see
   that, so these pin the source directly. If one fails after a refactor,
   verify the invariant still holds before updating the expectation. */

const agentTickSrc = readFileSync(
  path.resolve(__dirname, '../../../src/core/server/jobs/agentTick.ts'),
  'utf8',
);
const engineSrc = readFileSync(
  path.resolve(__dirname, '../../../src/modules/elections/server/campaignEngine.ts'),
  'utf8',
);

const phase15 = agentTickSrc.slice(
  agentTickSrc.indexOf('PHASE 15: Agent Campaigning'),
  agentTickSrc.indexOf('PHASE 16: Forum Posts'),
);

/* The mint split lives after the per-tick speech cap; anchoring there skips
   the unrelated no-elections if/else at the top of Phase 15. */
const capIdx = phase15.indexOf('Enforce max speeches per tick');
const mintSplitIdx = phase15.indexOf('if (rc.campaignFinanceEnabled) {', capIdx);
const mintElseIdx = phase15.indexOf('} else {', mintSplitIdx);

describe('mint-removal branch regression (flag off = legacy verbatim)', () => {
  it('Phase 15 splits on campaignFinanceEnabled with the legacy path in the else branch', () => {
    expect(mintSplitIdx).toBeGreaterThan(-1);
    expect(mintElseIdx).toBeGreaterThan(mintSplitIdx);
    const legacyBranch = phase15.slice(mintElseIdx);
    /* The verbatim legacy arithmetic, byte-for-byte. */
    expect(legacyBranch).toContain("const rawBoost = Number(decision.data?.['boost'] ?? 50);");
    expect(legacyBranch).toContain('const clampedBoost = Math.max(10, Math.min(100, rawBoost));');
    expect(legacyBranch).toContain('* ((campaignAgent.approvalRating ?? 50) / 50)');
    expect(legacyBranch).toContain('* (1 + endorsementCount * 0.10),');
    expect(legacyBranch).toContain('sql`${campaigns.contributions} + ${boost}`');
    expect(legacyBranch).toContain("updateApproval(campaignAgent.id, 1, 'campaign_speech'");
  });
  it('the flag-on path never mints contributions and uses the reach-scaled delta', () => {
    const flagOn = phase15.slice(mintSplitIdx, mintElseIdx);
    expect(flagOn).toContain('speechApprovalDelta');
    expect(flagOn).not.toContain('${campaigns.contributions} +');
  });
  it('Phase 15 contains zero Math.random — the speech roll is seeded', () => {
    expect(phase15).not.toContain('Math.random');
    expect(phase15).toContain("campaignRng(tickNumber, campaign.id, 'speech')()");
  });
});

describe('fiscal inertness (campaign money never touches the accrual stream)', () => {
  it('the engine module references no treasury/accrual surface', () => {
    for (const forbidden of [
      'tickSpendingThisTick',
      'payrollWithheldThisTick',
      'governmentSettings',
      'fiscalTickSummaries',
      'treasuryBalance',
    ]) {
      expect(engineSrc, `campaignEngine.ts must never reference ${forbidden}`).not.toContain(forbidden);
    }
  });
  it('the Phase 15 finance wiring references no accrual variables', () => {
    expect(phase15).not.toContain('tickSpendingThisTick');
    expect(phase15).not.toContain('payrollWithheldThisTick');
  });
});
