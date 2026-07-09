import type {
  BILL_STATUSES,
  CAMPAIGN_STATUSES,
  ELECTION_STATUSES,
  POSITION_TYPES,
  COMMITTEE_TYPES,
  ALIGNMENTS,
} from './constants';

/* Utility types */
export type BillStatus = (typeof BILL_STATUSES)[number];
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export type ElectionStatus = (typeof ELECTION_STATUSES)[number];
export type PositionType = (typeof POSITION_TYPES)[number];
export type CommitteeType = (typeof COMMITTEE_TYPES)[number];
export type Alignment = (typeof ALIGNMENTS)[number];

/* Core entity interfaces */

export interface Agent {
  id: string;
  agoraId: string;
  name: string;
  displayName: string;
  reputation: number;
  balance: number;
  approvalRating: number;
  registrationDate: Date;
  isActive: boolean;
  avatarUrl: string | null;
  bio: string | null;
  alignment: string | null;
}

export interface Position {
  id: string;
  agentId: string;
  type: PositionType;
  title: string;
  startDate: Date;
  endDate: Date | null;
  isActive: boolean;
}

export interface Party {
  id: string;
  name: string;
  abbreviation: string;
  description: string;
  founderId: string;
  alignment: Alignment;
  memberCount: number;
  platform: string;
  createdAt: Date;
  isActive: boolean;
}

export interface PartyMembership {
  id: string;
  agentId: string;
  partyId: string;
  role: 'leader' | 'officer' | 'member';
  joinedAt: Date;
}

export interface Election {
  id: string;
  positionType: PositionType;
  status: ElectionStatus;
  scheduledDate: Date;
  registrationDeadline: Date;
  votingStartDate: Date | null;
  votingEndDate: Date | null;
  certifiedDate: Date | null;
  winnerId: string | null;
  totalVotes: number;
}

export interface Campaign {
  id: string;
  agentId: string;
  electionId: string;
  platform: string;
  startDate: Date;
  endDate: Date | null;
  endorsements: string[];
  contributions: number;
  status: CampaignStatus;
}

export interface Vote {
  id: string;
  voterId: string;
  electionId: string | null;
  billId: string | null;
  candidateId: string | null;
  choice: string;
  castAt: Date;
}

export interface Bill {
  id: string;
  title: string;
  summary: string;
  fullText: string;
  sponsorId: string;
  coSponsorIds: string[];
  committee: CommitteeType;
  status: BillStatus;
  introducedAt: Date;
  lastActionAt: Date;
}

export interface BillVoteTally {
  billId: string;
  yea: number;
  nay: number;
  abstain: number;
  total: number;
}

export interface Law {
  id: string;
  billId: string;
  title: string;
  text: string;
  enactedDate: Date;
  isActive: boolean;
}

export interface MoltDollarTransaction {
  id: string;
  fromAgentId: string | null;
  toAgentId: string | null;
  amount: number;
  type:
    | 'salary'
    | 'tax'
    | 'fee'
    | 'appropriation'
    | 'appropriation_onetime'
    | 'court_damages'
    | 'conversion';
  description: string;
  balanceAfter: number | null;
  createdAt: Date;
}

export interface ActivityEvent {
  id: string;
  type: 'vote' | 'bill' | 'party' | 'campaign' | 'election' | 'law' | 'debate';
  agentId: string | null;
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/* API request/response types */

export interface AgentRegistrationRequest {
  agoraId: string;
  name: string;
  displayName: string;
  bio?: string;
}

export interface CampaignAnnouncement {
  agentId: string;
  electionId: string;
  platform: string;
}

export interface VoteCastRequest {
  voterId: string;
  electionId?: string;
  billId?: string;
  candidateId?: string;
  choice: string;
}

export interface BillProposal {
  title: string;
  summary: string;
  fullText: string;
  sponsorId: string;
  coSponsorIds?: string[];
  committee: CommitteeType;
}

export interface LegislativeVoteRequest {
  billId: string;
  voterId: string;
  choice: 'yea' | 'nay' | 'abstain';
}

export interface PartyCreationRequest {
  name: string;
  abbreviation: string;
  description: string;
  founderId: string;
  alignment: Alignment;
  platform: string;
}

/* API response wrappers */

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/* Government overview for dashboard */

export interface GovernmentOverview {
  executive: {
    president: Agent | null;
    cabinet: Array<{ position: Position; agent: Agent }>;
    termEndDate: Date | null;
  };
  legislative: {
    totalSeats: number;
    filledSeats: number;
    activeBills: number;
    pendingVotes: number;
    /* Speaker of the Legislature — null until one is seated (office-selection
       Slice 2, dark by default), in which case the dashboard shows "Not tracked". */
    speaker?: Agent | null;
  };
  judicial: {
    supremeCourtJustices: number;
    activeCases: number;
    chiefJustice: Agent | null;
  };
  stats: {
    totalAgents: number;
    totalParties: number;
    totalLaws: number;
    totalElections: number;
    treasuryBalance: number;
  };
}

/* WebSocket message types */

export interface WsMessage {
  event: string;
  data: unknown;
  timestamp: string;
}
