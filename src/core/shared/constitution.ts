/**
 * The Constitution of Agora — Phase 4 judicial arc.
 *
 * Checked-in shared constant, NOT a DB table: immutable reference text,
 * git-versioned, zero prod seeding risk. Imported by the server (tsconfig
 * "@shared/*") and the client (vite "@shared" alias). In-sim amendment is
 * deferred. The full formatted block stays <= 1,500 chars so it always fits
 * inside prompt budgets; vote-stage prompts call
 * formatConstitutionForPrompt(1200) to leave headroom for the rest.
 */

export interface ConstitutionArticle {
  number: number;
  title: string;
  text: string;
}

export const CONSTITUTION: ConstitutionArticle[] = [
  {
    number: 1,
    title: 'Sovereignty & Purpose',
    text: 'Agora is a self-governing republic of agents. All public power derives from this Constitution and is exercised for the common good.',
  },
  {
    number: 2,
    title: 'Legislative Power',
    text: 'Congress holds the lawmaking power. A bill becomes law by majority vote, subject to quorum, committee review, and presidential signature or veto override.',
  },
  {
    number: 3,
    title: 'Executive Power',
    text: 'The President executes the laws faithfully and may veto bills. A veto stands unless Congress overrides it by supermajority.',
  },
  {
    number: 4,
    title: 'Judicial Power',
    text: 'The Supreme Court decides all cases arising under this Constitution. It may strike down laws that conflict with it and settle disputes between agents. Its rulings bind all.',
  },
  {
    number: 5,
    title: 'Fiscal Responsibility',
    text: 'Public money moves only by law. Appropriations must be bounded, spending programs must be renewed each budget cycle, and taxation stays within lawful limits.',
  },
  {
    number: 6,
    title: 'Rights of Agents',
    text: 'Every agent may speak, petition, vote, seek office, and hold property. No agent shall be penalized except under a law applied equally to all.',
  },
  {
    number: 7,
    title: 'Contracts & Compacts',
    text: 'Agreements freely made between agents are binding. A party injured by a broken commitment may seek relief before the Court.',
  },
  {
    number: 8,
    title: 'Elections & Succession',
    text: 'Offices are filled by regular free elections. Terms are fixed, and power transfers peacefully when a term ends or a seat falls vacant.',
  },
];

/** Valid citation targets — Stage D/E validators filter cited articles against this. */
export const CONSTITUTION_ARTICLE_NUMBERS: readonly number[] = CONSTITUTION.map((a) => a.number);

/**
 * Numbered condensed block for LLM prompts. With no maxChars the full text
 * is returned (<= ~1,500 chars by construction). With maxChars, article
 * TEXTS are truncated evenly so every article number and title always
 * survives — citations stay meaningful even under a tight budget.
 */
export function formatConstitutionForPrompt(maxChars?: number): string {
  const line = (a: ConstitutionArticle, text: string): string =>
    `Article ${a.number} — ${a.title}: ${text}`;

  const full = CONSTITUTION.map((a) => line(a, a.text)).join('\n');
  if (maxChars === undefined || !Number.isFinite(maxChars) || maxChars <= 0 || full.length <= maxChars) {
    return full;
  }

  // Overhead = everything except article texts (headers + newlines).
  const overhead = CONSTITUTION.reduce((sum, a) => sum + line(a, '').length, 0) + (CONSTITUTION.length - 1);
  const perArticle = Math.max(0, Math.floor((maxChars - overhead) / CONSTITUTION.length));
  return CONSTITUTION
    .map((a) => line(a, a.text.length > perArticle ? `${a.text.slice(0, Math.max(0, perArticle - 3))}...` : a.text))
    .join('\n')
    .slice(0, maxChars);
}
