import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  BALLOT_RESPONSE_INSTRUCTION,
  buildBallotCandidateLines,
  buildBallotContextMessage,
  coerceBallotVote,
} from '@core/server/lib/ballotPrompt';

/* Regression suite for the zero-ballot inaugural presidential election: a
   20-candidate ballot context (~7,020 chars) overflowed maxPromptLengthChars
   (4,000), truncation ate the tail-positioned response-format instruction,
   and all 70 ballots came back as {"vote":"<uuid>"} → parsed 'unknown' →
   discarded. These pin the three defense layers. */

/* Exact legacy instruction wording — pinned as a literal (not just via the
   exported const) so a drive-by rewording fails loudly. */
const INSTRUCTION_LITERAL =
  'Respond with exactly this JSON structure: ' +
  '{"action":"election_vote","reasoning":"one sentence","data":{"candidateId":"<the id of your chosen candidate>"}}';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Worst-case fields: 60+ char names, 55+ char party, 400-char platforms. */
const worstCase = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    agentId: uuid(i),
    displayName: `Senator Maximiliana Vandermeer-Castellanos of Agora Heights ${i}`,
    party: 'The Progressive Conservative Libertarian Green Alliance',
    approvalRating: 100,
    platform: `${'P'.repeat(200)} ${'q'.repeat(199)}`,
  }));

describe('coerceBallotVote (unambiguous-ballot parse fallback)', () => {
  const id = uuid(1);

  it('accepts the observed incident shape {"vote":"<uuid>","reasoning":...}', () => {
    const out = coerceBallotVote({ vote: id, reasoning: 'best fiscal record' }, 'election_voting');
    expect(out).toEqual({
      action: 'election_vote',
      reasoning: 'best fiscal record',
      data: { candidateId: id },
    });
  });

  it('accepts a bare top-level candidateId key, defaulting the reasoning', () => {
    const out = coerceBallotVote({ candidateId: id }, 'election_voting');
    expect(out?.action).toBe('election_vote');
    expect(out?.data.candidateId).toBe(id);
    expect((out?.reasoning ?? '').length).toBeGreaterThan(0);
  });

  it('prefers candidateId over vote and honors a "reason" key', () => {
    const out = coerceBallotVote({ candidateId: id, vote: uuid(2), reason: 'r' }, 'election_voting');
    expect(out?.data.candidateId).toBe(id);
    expect(out?.reasoning).toBe('r');
  });

  it('returns null when neither vote nor candidateId exists (unchanged behavior)', () => {
    expect(coerceBallotVote({ reasoning: 'hmm' }, 'election_voting')).toBeNull();
    expect(coerceBallotVote({}, 'election_voting')).toBeNull();
  });

  it('never converts outside the election_voting phase', () => {
    expect(coerceBallotVote({ vote: id }, 'bill_voting')).toBeNull();
    expect(coerceBallotVote({ vote: id }, undefined)).toBeNull();
  });

  it('defers to the alias/retry path when any non-empty action key exists', () => {
    expect(coerceBallotVote({ action: 'vote', vote: id }, 'election_voting')).toBeNull();
    expect(coerceBallotVote({ action: 'ballot', candidateId: id }, 'election_voting')).toBeNull();
  });

  it('treats an empty-string action as no action key', () => {
    expect(coerceBallotVote({ action: '', vote: id }, 'election_voting')?.data.candidateId).toBe(id);
  });

  it('rejects non-string / whitespace-only values and non-object inputs', () => {
    expect(coerceBallotVote({ vote: 123 }, 'election_voting')).toBeNull();
    expect(coerceBallotVote({ vote: '   ' }, 'election_voting')).toBeNull();
    expect(coerceBallotVote(null, 'election_voting')).toBeNull();
    expect(coerceBallotVote('vote', 'election_voting')).toBeNull();
    expect(coerceBallotVote([id], 'election_voting')).toBeNull();
  });

  it('trims whitespace around the candidate id', () => {
    expect(coerceBallotVote({ vote: `  ${id}\n` }, 'election_voting')?.data.candidateId).toBe(id);
  });
});

describe('buildBallotCandidateLines', () => {
  it('renders the established line shape with defaulted approval', () => {
    const [line] = buildBallotCandidateLines([
      { agentId: uuid(1), displayName: 'Ada Vex', party: 'Independent', approvalRating: null, platform: 'Lower taxes.' },
    ]);
    expect(line).toBe(`  - Ada Vex (id: ${uuid(1)}, party: Independent, approval: 50%): Lower taxes.`);
  });

  it('excerpts platforms to at most 100 chars', () => {
    const [line] = buildBallotCandidateLines([
      { agentId: uuid(1), displayName: 'Ada Vex', party: 'X', approvalRating: 40, platform: 'z'.repeat(500) },
    ]);
    const platform = line.split('): ')[1];
    expect(platform.length).toBeLessThanOrEqual(100);
    expect(platform.endsWith('...')).toBe(true);
  });

  it('keeps riders and the fiscal-record continuation line', () => {
    const [line] = buildBallotCandidateLines([
      {
        agentId: uuid(1),
        displayName: 'Ada Vex',
        party: 'X',
        approvalRating: 40,
        platform: 'p',
        endorsementNote: ', endorsements: 3',
        pollNote: ', latest poll: 41% (#2)',
        fiscalRecord: 'Tenure record: deficit widened',
      },
    ]);
    expect(line).toContain(', endorsements: 3');
    expect(line).toContain(', latest poll: 41% (#2)');
    expect(line).toContain('\n    Tenure record: deficit widened');
  });

  it('pins the budget: 25 worst-case candidates join to <= 3500 chars, every id intact', () => {
    const lines = buildBallotCandidateLines(worstCase(25));
    const joined = lines.join('\n');
    expect(lines).toHaveLength(25);
    expect(joined.length).toBeLessThanOrEqual(3500);
    for (let i = 0; i < 25; i++) expect(joined).toContain(`(id: ${uuid(i)}`);
  });

  it('gives small fields the full 100-char platform excerpt', () => {
    const lines = buildBallotCandidateLines(worstCase(5));
    for (const line of lines) expect(line.split('): ')[1].length).toBe(100);
    expect(lines.join('\n').length).toBeLessThanOrEqual(3500);
  });

  it('stays inside the budget with riders and fiscal records attached', () => {
    const withRiders = worstCase(10).map((c, i) => ({
      ...c,
      endorsementNote: ', endorsements: 12',
      pollNote: `, latest poll: 100% (#${i + 1})`,
      fiscalRecord: 'Tenure fiscal record: deficit widened $1.2T -> $2.4T; treasury fell',
    }));
    expect(buildBallotCandidateLines(withRiders).join('\n').length).toBeLessThanOrEqual(3500);
  });

  it('returns [] for an empty field', () => {
    expect(buildBallotCandidateLines([])).toEqual([]);
  });
});

describe('buildBallotContextMessage — instructions can never be truncated away', () => {
  it('keeps the exact legacy instruction wording', () => {
    expect(BALLOT_RESPONSE_INSTRUCTION).toBe(INSTRUCTION_LITERAL);
  });

  it('places the instruction before the candidate list and voter context', () => {
    const lines = buildBallotCandidateLines(worstCase(3));
    const msg = buildBallotContextMessage('president', lines.join('\n'), '  Your alignment with X: 80%');
    const iInstr = msg.indexOf(INSTRUCTION_LITERAL);
    expect(iInstr).toBeGreaterThan(-1);
    expect(iInstr).toBeLessThan(msg.indexOf('Candidates:'));
    expect(iInstr).toBeLessThan(msg.indexOf('(id: '));
    expect(iInstr).toBeLessThan(msg.indexOf('Your alignment with'));
  });

  it('a 25-candidate ballot cut at 4000 chars still carries the full instruction', () => {
    const lines = buildBallotCandidateLines(worstCase(25));
    const alignment = worstCase(25)
      .map((c) => `  Your alignment with ${c.displayName}: 74%`)
      .join('\n');
    const msg = buildBallotContextMessage('president', lines.join('\n'), alignment);
    /* What callProvider does at the default rc.maxPromptLengthChars. */
    const truncated = msg.slice(0, 4000);
    expect(truncated).toContain(INSTRUCTION_LITERAL);
    expect(truncated).toContain('Candidates:');
  });

  it('omits the voter-context block cleanly when there are no alignment lines', () => {
    const msg = buildBallotContextMessage('president', 'X', '');
    expect(msg.endsWith('Candidates:\nX')).toBe(true);
  });
});

/* Source-structural wiring pins (campaignMintBranch.test.ts precedent):
   behavior tests cannot see WHERE the assembly happens — these pin that the
   live Phase 14 / ai.ts paths actually route through the helpers above. */
describe('wiring pins', () => {
  const agentTickSrc = readFileSync(
    path.resolve(__dirname, '../../../src/core/server/jobs/agentTick.ts'),
    'utf8',
  );
  const aiSrc = readFileSync(
    path.resolve(__dirname, '../../../src/core/server/services/ai.ts'),
    'utf8',
  );
  /* The vote-casting sub-block only — other Phase 14 prompts (candidacy
     declaration) legitimately inline their own short instructions. */
  const ballotBlock = agentTickSrc.slice(
    agentTickSrc.indexOf('Vote casting window (E3 slice A)'),
    agentTickSrc.indexOf('PHASE 14.5:'),
  );

  it('the ballot block assembles through the budgeted, instruction-first helpers', () => {
    expect(ballotBlock).toContain('buildBallotCandidateLines(');
    expect(ballotBlock).toContain('buildBallotContextMessage(');
    /* The instruction must never be re-inlined at the truncatable tail. */
    expect(ballotBlock).not.toContain('Respond with exactly this JSON structure');
  });

  it('ai.ts wires the ballot-shape fallback and the truncation warn', () => {
    expect(aiSrc).toContain('coerceBallotVote(decision, phase)');
    expect(aiSrc).toContain('prompt truncated');
  });
});
