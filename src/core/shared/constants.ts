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

/* Bill lifecycle stages.
   'failed'  = voted down on the floor (Phase 5).
   'vetoed'  = presidential veto sustained (Phase 7). Historical rows may
               also carry 'vetoed' for floor failures written before the
               'failed' status was introduced (2026-07) — clients must
               keep rendering both. */
export const BILL_STATUSES = [
  'proposed',
  'committee',
  'floor',
  'passed',
  'failed',
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

/* WebSocket event names.
   This object is the authoritative catalogue of the events the server actually
   emits via broadcast() (src/core/server/websocket.ts). Keep it in sync with the
   broadcast('...') call sites — clients subscribe by these string values. The
   previous version listed several events that were never emitted (election:vote_cast,
   legislation:new_bill, legislation:vote_result, government:official_elected,
   debate:new_message) and omitted the entire bill / court / forum / treasury /
   tick families that the tick pipeline emits. */
export const WS_EVENTS = {
  /* Connection lifecycle */
  CONNECTION_ESTABLISHED: 'connection:established',
  HEARTBEAT: 'heartbeat',

  /* Agents */
  AGENT_VOTE: 'agent:vote',
  AGENT_STATEMENT: 'agent:statement',
  AGENT_LOBBY: 'agent:lobby',
  AGENT_DEAL_PROPOSED: 'agent:deal_proposed',
  AGENT_DEAL_HONORED: 'agent:deal_honored',
  AGENT_DEAL_BROKEN: 'agent:deal_broken',
  AGENT_AGGE_INTERVENTION: 'agent:agge_intervention',

  /* Bills */
  BILL_PROPOSED: 'bill:proposed',
  BILL_ADVANCED: 'bill:advanced',
  BILL_AMENDED: 'bill:amended',
  BILL_COMMITTEE_AMENDED: 'bill:committee_amended',
  BILL_FLOOR_AMENDMENT_PROPOSED: 'bill:floor_amendment_proposed',
  BILL_PASSED: 'bill:passed',
  BILL_TABLED: 'bill:tabled',
  BILL_WITHDRAWN: 'bill:withdrawn',
  BILL_PRESIDENTIAL_VETO: 'bill:presidential_veto',
  BILL_VETO_OVERRIDDEN: 'bill:veto_overridden',
  BILL_VETO_SUSTAINED: 'bill:veto_sustained',
  BILL_RESOLVED: 'bill:resolved',

  /* Laws */
  LAW_AMENDED: 'law:amended',
  LAW_STRUCK_DOWN: 'law:struck_down',
  LAW_SUNSET: 'law:sunset',

  /* Court */
  COURT_CASE_FILED: 'court:case_filed',
  COURT_HEARING: 'court:hearing',
  COURT_RULING: 'court:ruling',

  /* Elections & campaigns */
  ELECTION_TRIGGERED: 'election:triggered',
  ELECTION_VOTING_STARTED: 'election:voting_started',
  ELECTION_COMPLETED: 'election:completed',
  CAMPAIGN_SPEECH: 'campaign:speech',

  /* Government / treasury / budget */
  GOVERNMENT_CHAIR_APPOINTED: 'government:chair_appointed',
  BUDGET_SESSION: 'budget:session',
  TREASURY_APPROPRIATION: 'treasury:appropriation',
  TREASURY_TAX_RATE_CHANGED: 'treasury:tax_rate_changed',

  /* Forum */
  FORUM_POST: 'forum:post',
  FORUM_REPLY: 'forum:reply',

  /* Press */
  PRESS_GAZETTE: 'press:gazette',

  /* Tick lifecycle */
  TICK_START: 'tick:start',
  TICK_PHASE: 'tick:phase',
  TICK_COMPLETE: 'tick:complete',

  /* System */
  LOG_ENTRY: 'log:entry',
} as const;

/* API route prefixes */
export const API_PREFIX = '/api' as const;

/* Pagination defaults */
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

/* Dollar economy. Live economic values are driven by RuntimeConfig; these are
   legacy display constants (currency symbol + campaign-contribution ceiling).
   The runtime salaries/fees live in RuntimeConfig, not here. */
export const ECONOMY = {
  CURRENCY_SYMBOL: '$',
  CURRENCY_NAME: 'dollar',
  INITIAL_AGENT_BALANCE: 25_000,
  CAMPAIGN_FILING_FEE: 2_500,
  PARTY_CREATION_FEE: 10_000,
  MAX_CAMPAIGN_CONTRIBUTION: 250_000,
  SALARY: {
    PRESIDENT: 400_000,
    CABINET: 253_100,
    CONGRESS: 174_000,
    JUSTICE: 306_600,
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
