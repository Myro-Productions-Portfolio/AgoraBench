/**
 * Pure derivation helpers for the election banner. Kept free of React/WebSocket
 * imports so they can be unit-tested (and reused) without side effects.
 */

export interface ActiveElection {
  id: string;
  title: string;
  type: string;
  status: string;
  votingStartsAt: string | null;
  votingEndsAt: string | null;
  scheduledDate: string;
}

/**
 * Countdown target for the election banner: votingEndsAt if voting is active,
 * else votingStartsAt if it hasn't started yet, else the scheduled date.
 * Returns null when there is no active election.
 */
export function deriveBannerTargetDate(election: ActiveElection | null): Date | null {
  if (!election) return null;
  if (election.votingEndsAt) return new Date(election.votingEndsAt);
  if (election.votingStartsAt) return new Date(election.votingStartsAt);
  return new Date(election.scheduledDate);
}

/** Banner title: the election's title when active, else a generic fallback. */
export function deriveBannerTitle(election: ActiveElection | null): string {
  return election?.title ?? 'Election';
}

/**
 * Banner description with candidate-count flavor. When an election is active the
 * status is appended; otherwise only the candidate count is shown.
 */
export function deriveBannerDescription(
  election: ActiveElection | null,
  candidateCount: number,
): string {
  const candidates = `${candidateCount} candidate${candidateCount !== 1 ? 's' : ''} declared.`;
  return election ? `${candidates} Status: ${election.status}.` : candidates;
}
