/**
 * Section-aware bill amendment applier.
 *
 * Bill text uses 'SECTION n. HEADING.' boilerplate headers (see the
 * bill-text generator in agentTick.ts Phase 11). Amendments are applied
 * without ever discarding the original bill text:
 *   - addition   → appends a new numbered section
 *   - strike     → annotates the target section '[STRICKEN by Amendment #k]'
 *                  (original body is kept below the marker, so it stays recoverable)
 *   - substitute → replaces the target section's body, annotated
 *
 * Strike/substitute need an identifiable target — a 'SECTION n' reference
 * inside the amendment text. When none is found, or the bill text has no
 * parseable sections, the amendment is conservatively appended (addition
 * semantics) rather than guessing a target or overwriting anything.
 * The full amendment text is also preserved in the bill_amendments row,
 * so every change remains auditable.
 */

export type AmendmentType = 'addition' | 'strike' | 'substitute';

export interface AmendmentInput {
  /** Free-form type from the LLM; anything but 'strike'/'substitute' falls back to 'addition'. */
  type: string;
  amendmentText: string;
  /** Ordinal used in '[... Amendment #k]' annotations. */
  amendmentNumber: number;
}

interface ParsedSection {
  number: number;
  /** Full header line, e.g. 'SECTION 2. PURPOSE.' */
  headerLine: string;
  /** Text after the header line up to the next section header (trailing whitespace trimmed). */
  body: string;
}

const SECTION_HEADER_RE = /^SECTION\s+(\d+)\.[^\n]*$/gim;

/** Parse bill text into its 'SECTION n.' sections. Returns null when no headers exist. */
export function parseSections(
  fullText: string,
): { prefix: string; sections: ParsedSection[] } | null {
  const matches = [...fullText.matchAll(SECTION_HEADER_RE)];
  if (matches.length === 0) return null;

  const prefix = fullText.slice(0, matches[0].index ?? 0).replace(/\s+$/, '');
  const sections: ParsedSection[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = match.index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? fullText.length) : fullText.length;
    const raw = fullText.slice(start, end);
    const newlineIdx = raw.indexOf('\n');
    const headerLine = (newlineIdx === -1 ? raw : raw.slice(0, newlineIdx)).trimEnd();
    const body = newlineIdx === -1 ? '' : raw.slice(newlineIdx + 1).replace(/\s+$/, '');
    sections.push({ number: parseInt(match[1], 10), headerLine, body });
  }

  return { prefix, sections };
}

function rebuild(prefix: string, sections: ParsedSection[]): string {
  const parts = sections.map((s) => (s.body ? `${s.headerLine}\n${s.body}` : s.headerLine));
  return (prefix ? `${prefix}\n\n` : '') + parts.join('\n\n');
}

/** Apply one accepted amendment to a bill's full text. Pure — no I/O. */
export function applyAmendment(fullText: string, amendment: AmendmentInput): string {
  const text = amendment.amendmentText.trim();
  const n = amendment.amendmentNumber;
  const rawType = amendment.type.trim().toLowerCase();
  const type: AmendmentType =
    rawType === 'strike' || rawType === 'substitute' ? rawType : 'addition';

  const parsed = parseSections(fullText);
  if (!parsed) {
    /* Malformed bill text (no SECTION headers) — never overwrite; append annotated. */
    return `${fullText.replace(/\s+$/, '')}\n\n[AMENDMENT #${n} — ${type.toUpperCase()}]\n${text}`;
  }
  const { prefix, sections } = parsed;

  const appendAsAddition = (): string => {
    const nextNumber = Math.max(...sections.map((s) => s.number)) + 1;
    sections.push({
      number: nextNumber,
      headerLine: `SECTION ${nextNumber}. (ADDED BY AMENDMENT #${n}.)`,
      body: text,
    });
    return rebuild(prefix, sections);
  };

  if (type === 'addition') return appendAsAddition();

  /* strike | substitute — need an identifiable target section */
  const targetMatch = text.match(/SECTION\s+(\d+)/i);
  const target = targetMatch
    ? sections.find((s) => s.number === parseInt(targetMatch[1], 10))
    : undefined;
  if (!target) return appendAsAddition(); /* conservative: never guess a target */

  if (type === 'strike') {
    /* Mark stricken; keep the original body below the marker so it stays recoverable. */
    target.body = target.body
      ? `[STRICKEN by Amendment #${n}]\n${target.body}`
      : `[STRICKEN by Amendment #${n}]`;
    return rebuild(prefix, sections);
  }

  /* substitute — replace the target section's body, annotated */
  target.body = `[Substituted by Amendment #${n}]\n${text}`;
  return rebuild(prefix, sections);
}
