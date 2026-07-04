/**
 * Gazette digest builder — pure and deterministic. Turns tick-scoped outcome
 * arrays plus a whitelisted slice of activityEvents into the bounded bullet
 * list fed to the Gazette LLM call. Never contains raw model output beyond
 * event titles/descriptions already persisted by the sim, and every line is
 * hard-capped so the prompt budget stays safe.
 */

export interface GazetteDigestInput {
  passedBills: { title: string }[];
  failedBills: { title: string }[];
  vetoedBills: { title: string }[];
  electionWinners: string[];
  brokenDeals: { wrongedPartyName: string }[];
  events: { type: string; title: string; description: string }[];
}

const MAX_BULLETS = 8;
const MAX_DIGEST_CHARS = 1200;
const EVENT_TEXT_MAX_CHARS = 120;

const EVENT_TYPE_LABELS: Record<string, string> = {
  committee_review: 'Committee',
  law_struck_down: 'Judiciary',
  media_event: 'News',
  appointment: 'Appointment',
  tax_collected: 'Treasury',
  revenue_collected: 'Treasury',
  floor_amendment: 'Amendment',
  /* Phase 3 fiscal events */
  law_sunset: 'Sunset',
  budget_session: 'Budget',
  program_lapsed: 'Budget',
  tax_rate_changed: 'Treasury',
  appropriation_onetime: 'Treasury',
};

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Build the deterministic digest for one tick. Returns null when nothing
 * notable happened (the caller then skips the LLM call entirely).
 * Ordering is fixed: passed, vetoed, failed, elections, broken deals, then
 * events in the order given. At most 8 bullets and 1200 chars total.
 */
export function buildGazetteDigest(input: GazetteDigestInput): string | null {
  const bullets: string[] = [];

  for (const bill of input.passedBills) {
    bullets.push(`- Bill passed: "${squash(bill.title).slice(0, EVENT_TEXT_MAX_CHARS)}"`);
  }
  for (const bill of input.vetoedBills) {
    bullets.push(`- Vetoed by the President: "${squash(bill.title).slice(0, EVENT_TEXT_MAX_CHARS)}"`);
  }
  for (const bill of input.failedBills) {
    bullets.push(`- Failed on the floor: "${squash(bill.title).slice(0, EVENT_TEXT_MAX_CHARS)}"`);
  }
  for (const winner of input.electionWinners) {
    bullets.push(`- Election decided: ${squash(winner).slice(0, EVENT_TEXT_MAX_CHARS)} won`);
  }
  for (const deal of input.brokenDeals) {
    bullets.push(`- Vote pact broken: ${squash(deal.wrongedPartyName).slice(0, EVENT_TEXT_MAX_CHARS)} was betrayed`);
  }
  for (const event of input.events) {
    const label = EVENT_TYPE_LABELS[event.type] ?? 'Event';
    const text = squash(`${event.title} — ${event.description}`).slice(0, EVENT_TEXT_MAX_CHARS);
    bullets.push(`- ${label}: ${text}`);
  }

  if (bullets.length === 0) return null;

  const capped = bullets.slice(0, MAX_BULLETS);

  /* Trim trailing bullets until under the char cap — deterministic. */
  while (capped.length > 1 && capped.join('\n').length > MAX_DIGEST_CHARS) {
    capped.pop();
  }

  const digest = capped.join('\n');
  return digest.length > MAX_DIGEST_CHARS ? digest.slice(0, MAX_DIGEST_CHARS) : digest;
}
