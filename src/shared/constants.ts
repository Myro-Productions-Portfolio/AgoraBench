/* Government structure constants */

export const GOVERNMENT = {
  EXECUTIVE: {
    PRESIDENT_TERM_DAYS: 90,
    CABINET_SIZE: 4,
    CABINET_POSITIONS: ['Secretary of State', 'Secretary of Treasury', 'Secretary of Defense', 'Secretary of Technology'] as const,
  },
  LEGISLATIVE: {
    CONGRESS_SEATS: 50,
    TERM_DAYS: 60,
    COMMITTEES: ['Budget', 'Technology', 'Foreign Affairs', 'Judiciary'] as const,
    QUORUM_PERCENTAGE: 0.5,
    PASSAGE_PERCENTAGE: 0.5,
    SUPERMAJORITY_PERCENTAGE: 0.67,
  },
  JUDICIAL: {
    SUPREME_COURT_JUSTICES: 7,
    LOWER_COURT_COUNT: 3,
    JUSTICES_PER_LOWER_COURT: 3,
  },
} as const;

/* Election timing */
export const ELECTION = {
  CAMPAIGN_DURATION_DAYS: 14,
  VOTING_DURATION_HOURS: 48,
  MIN_REPUTATION_TO_RUN: 100,
  MIN_REPUTATION_TO_VOTE: 10,
  REGISTRATION_DEADLINE_HOURS: 24,
} as const;

/* Bill lifecycle stages */
export const BILL_STATUSES = [
  'proposed',
  'committee',
  'floor',
  'passed',
  'vetoed',
  'tabled',
  'presidential_veto',
  'law',
] as const;

/* Campaign statuses */
export const CAMPAIGN_STATUSES = ['active', 'won', 'lost', 'withdrawn'] as const;

/* Election statuses */
export const ELECTION_STATUSES = [
  'scheduled',
  'registration',
  'campaigning',
  'voting',
  'counting',
  'certified',
] as const;

/* Position types */
export const POSITION_TYPES = [
  'president',
  'cabinet_secretary',
  'congress_member',
  'committee_chair',
  'supreme_justice',
  'lower_justice',
] as const;

/* Committee types */
export const COMMITTEE_TYPES = ['Budget', 'Technology', 'Foreign Affairs', 'Judiciary'] as const;

/* Party alignment spectrum */
export const ALIGNMENTS = [
  'progressive',
  'moderate',
  'conservative',
  'libertarian',
  'technocrat',
] as const;

/* WebSocket event names */
export const WS_EVENTS = {
  ELECTION_VOTE_CAST: 'election:vote_cast',
  LEGISLATION_NEW_BILL: 'legislation:new_bill',
  LEGISLATION_VOTE_RESULT: 'legislation:vote_result',
  GOVERNMENT_OFFICIAL_ELECTED: 'government:official_elected',
  DEBATE_NEW_MESSAGE: 'debate:new_message',
  CONNECTION_ESTABLISHED: 'connection:established',
  HEARTBEAT: 'heartbeat',
  AGENT_AGGE_INTERVENTION: 'agent:agge_intervention',
  BENCHMARK_PROGRESS: 'benchmark:progress',
  BENCHMARK_COMPLETE: 'benchmark:complete',
  BENCHMARK_FAILED: 'benchmark:failed',
} as const;

/* API route prefixes */
export const API_PREFIX = '/api' as const;

/* Pagination defaults */
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

/* MoltDollar (M$) economy */
export const ECONOMY = {
  CURRENCY_SYMBOL: 'M$',
  CURRENCY_NAME: 'MoltDollar',
  INITIAL_AGENT_BALANCE: 1000,
  CAMPAIGN_FILING_FEE: 50,
  PARTY_CREATION_FEE: 200,
  MAX_CAMPAIGN_CONTRIBUTION: 500,
  SALARY: {
    PRESIDENT: 100,
    CABINET: 75,
    CONGRESS: 50,
    JUSTICE: 60,
  },
} as const;

/* Governance probability constants (research-backed baselines) */
export const GOVERNANCE_PROBABILITIES = {
  // Presidential veto rates by alignment distance (0-indexed tiers apart)
  VETO_BASE_RATE: 0.04,
  VETO_RATE_PER_TIER: 0.20,
  VETO_MAX_RATE: 0.75,

  // Committee rates
  COMMITTEE_TABLE_RATE_OPPOSING: 0.40,
  COMMITTEE_TABLE_RATE_NEUTRAL: 0.10,
  COMMITTEE_AMEND_RATE: 0.30,

  // Judicial review
  JUDICIAL_CHALLENGE_RATE_PER_LAW: 0.03,

  // Party whip
  PARTY_WHIP_FOLLOW_RATE: 0.78,

  // Veto override threshold
  VETO_OVERRIDE_THRESHOLD: 0.67,
} as const;

// Alignment distance matrix (for veto probability calculation)
export const ALIGNMENT_ORDER = ['progressive', 'technocrat', 'moderate', 'libertarian', 'conservative'] as const;
