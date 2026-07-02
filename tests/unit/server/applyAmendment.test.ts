import { describe, it, expect } from 'vitest';
import { applyAmendment, parseSections } from '@core/server/lib/applyAmendment';

/* Matches the Phase 11 bill-text generator format in agentTick.ts */
const BILL_TEXT =
  'SECTION 1. SHORT TITLE.\nThis Act may be cited as the "Digital Rights Act".\n\n' +
  'SECTION 2. PURPOSE.\nEstablish baseline digital privacy protections for all citizens.';

describe('parseSections', () => {
  it('parses the standard two-section bill boilerplate', () => {
    const parsed = parseSections(BILL_TEXT);
    expect(parsed).not.toBeNull();
    expect(parsed!.sections).toHaveLength(2);
    expect(parsed!.sections[0]).toMatchObject({
      number: 1,
      headerLine: 'SECTION 1. SHORT TITLE.',
    });
    expect(parsed!.sections[1].body).toContain('digital privacy protections');
  });

  it('returns null for text without SECTION headers', () => {
    expect(parseSections('Just a paragraph of prose with no headers.')).toBeNull();
  });
});

describe('applyAmendment — addition', () => {
  it('appends a new numbered section and keeps the original text intact', () => {
    const result = applyAmendment(BILL_TEXT, {
      type: 'addition',
      amendmentText: 'An annual audit shall be conducted by an independent body.',
      amendmentNumber: 1,
    });

    expect(result).toContain('SECTION 1. SHORT TITLE.');
    expect(result).toContain('This Act may be cited as the "Digital Rights Act".');
    expect(result).toContain('SECTION 2. PURPOSE.');
    expect(result).toContain('Establish baseline digital privacy protections');
    expect(result).toContain('SECTION 3. (ADDED BY AMENDMENT #1.)');
    expect(result).toContain('An annual audit shall be conducted');
  });

  it('treats unknown amendment types as addition', () => {
    const result = applyAmendment(BILL_TEXT, {
      type: 'rewrite-everything',
      amendmentText: 'New clause.',
      amendmentNumber: 2,
    });
    expect(result).toContain('SECTION 3. (ADDED BY AMENDMENT #2.)');
    expect(result).toContain('SECTION 2. PURPOSE.'); // original untouched
  });
});

describe('applyAmendment — strike', () => {
  it('marks the referenced section stricken while preserving its body', () => {
    const result = applyAmendment(BILL_TEXT, {
      type: 'strike',
      amendmentText: 'Strike SECTION 2 in its entirety; the purpose clause is overbroad.',
      amendmentNumber: 3,
    });

    expect(result).toContain('SECTION 2. PURPOSE.\n[STRICKEN by Amendment #3]');
    /* Original body remains recoverable below the marker */
    expect(result).toContain('Establish baseline digital privacy protections');
    /* Untargeted section untouched */
    expect(result).toContain('SECTION 1. SHORT TITLE.\nThis Act may be cited as the "Digital Rights Act".');
  });

  it('falls back to addition when no target section is identifiable', () => {
    const result = applyAmendment(BILL_TEXT, {
      type: 'strike',
      amendmentText: 'Remove the vague language about protections.',
      amendmentNumber: 4,
    });
    /* Nothing was removed or annotated as stricken */
    expect(result).not.toContain('[STRICKEN');
    expect(result).toContain('Establish baseline digital privacy protections');
    expect(result).toContain('SECTION 3. (ADDED BY AMENDMENT #4.)');
  });
});

describe('applyAmendment — substitute', () => {
  it("replaces only the target section's body, annotated", () => {
    const result = applyAmendment(BILL_TEXT, {
      type: 'substitute',
      amendmentText: 'SECTION 2 shall read: Establish digital privacy protections with an opt-out registry.',
      amendmentNumber: 5,
    });

    expect(result).toContain('SECTION 2. PURPOSE.\n[Substituted by Amendment #5]');
    expect(result).toContain('opt-out registry');
    /* Old section-2 body replaced */
    expect(result).not.toContain('Establish baseline digital privacy protections for all citizens.');
    /* Section 1 untouched */
    expect(result).toContain('SECTION 1. SHORT TITLE.\nThis Act may be cited as the "Digital Rights Act".');
  });

  it('falls back to addition when no target section is identifiable', () => {
    const result = applyAmendment(BILL_TEXT, {
      type: 'substitute',
      amendmentText: 'The purpose should instead be about AI governance.',
      amendmentNumber: 6,
    });
    expect(result).not.toContain('[Substituted');
    expect(result).toContain('Establish baseline digital privacy protections');
    expect(result).toContain('SECTION 3. (ADDED BY AMENDMENT #6.)');
  });
});

describe('applyAmendment — malformed bill text', () => {
  it('never overwrites: appends the annotated amendment to unsectioned text', () => {
    const malformed = 'A bill about roads, written without any section headers.';
    const result = applyAmendment(malformed, {
      type: 'substitute',
      amendmentText: 'Replace everything with a bridge-funding mandate.',
      amendmentNumber: 7,
    });

    expect(result).toContain('A bill about roads, written without any section headers.');
    expect(result).toContain('[AMENDMENT #7 — SUBSTITUTE]');
    expect(result).toContain('Replace everything with a bridge-funding mandate.');
  });

  it('applies sequential amendments cumulatively', () => {
    const first = applyAmendment(BILL_TEXT, {
      type: 'addition',
      amendmentText: 'Add an enforcement clause.',
      amendmentNumber: 1,
    });
    const second = applyAmendment(first, {
      type: 'strike',
      amendmentText: 'Strike SECTION 3 — enforcement is premature.',
      amendmentNumber: 2,
    });

    expect(second).toContain('SECTION 3. (ADDED BY AMENDMENT #1.)\n[STRICKEN by Amendment #2]');
    expect(second).toContain('Add an enforcement clause.');
    expect(second).toContain('SECTION 1. SHORT TITLE.');
    expect(second).toContain('SECTION 2. PURPOSE.');
  });
});
