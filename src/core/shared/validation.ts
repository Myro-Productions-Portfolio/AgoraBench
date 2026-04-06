import { z } from 'zod';
import {
  BILL_STATUSES,
  CAMPAIGN_STATUSES,
  ELECTION_STATUSES,
  POSITION_TYPES,
  COMMITTEE_TYPES,
  ALIGNMENTS,
  ECONOMY,
} from './constants';

/* Agent registration schema */
export const agentRegistrationSchema = z.object({
  agoraId: z.string().min(1, 'Agora ID is required'),
  name: z
    .string()
    .min(3, 'Name must be at least 3 characters')
    .max(50, 'Name must be at most 50 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Name may only contain letters, numbers, hyphens, and underscores'),
  displayName: z
    .string()
    .min(1, 'Display name is required')
    .max(100, 'Display name must be at most 100 characters'),
  bio: z.string().max(500, 'Bio must be at most 500 characters').optional(),
});

/* Campaign announcement schema */
export const campaignAnnouncementSchema = z.object({
  agentId: z.string().uuid('Invalid agent ID'),
  electionId: z.string().uuid('Invalid election ID'),
  platform: z
    .string()
    .min(10, 'Platform must be at least 10 characters')
    .max(2000, 'Platform must be at most 2000 characters'),
});

/* Vote cast schema */
export const voteCastSchema = z.object({
  voterId: z.string().uuid('Invalid voter ID'),
  electionId: z.string().uuid('Invalid election ID').optional(),
  billId: z.string().uuid('Invalid bill ID').optional(),
  candidateId: z.string().uuid('Invalid candidate ID').optional(),
  choice: z.string().min(1, 'Choice is required'),
});

/* Bill proposal schema */
export const billProposalSchema = z.object({
  title: z
    .string()
    .min(5, 'Title must be at least 5 characters')
    .max(200, 'Title must be at most 200 characters'),
  summary: z
    .string()
    .min(10, 'Summary must be at least 10 characters')
    .max(1000, 'Summary must be at most 1000 characters'),
  fullText: z
    .string()
    .min(50, 'Full text must be at least 50 characters')
    .max(50000, 'Full text must be at most 50000 characters'),
  sponsorId: z.string().uuid('Invalid sponsor ID'),
  coSponsorIds: z.array(z.string().uuid()).optional(),
  committee: z.enum(COMMITTEE_TYPES),
});

/* Legislative vote schema */
export const legislativeVoteSchema = z.object({
  billId: z.string().uuid('Invalid bill ID'),
  voterId: z.string().uuid('Invalid voter ID'),
  choice: z.enum(['yea', 'nay', 'abstain']),
});

/* Party creation schema */
export const partyCreationSchema = z.object({
  name: z
    .string()
    .min(3, 'Party name must be at least 3 characters')
    .max(100, 'Party name must be at most 100 characters'),
  abbreviation: z
    .string()
    .min(2, 'Abbreviation must be at least 2 characters')
    .max(10, 'Abbreviation must be at most 10 characters')
    .regex(/^[A-Z]+$/, 'Abbreviation must be uppercase letters only'),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(2000, 'Description must be at most 2000 characters'),
  founderId: z.string().uuid('Invalid founder ID'),
  alignment: z.enum(ALIGNMENTS),
  platform: z
    .string()
    .min(10, 'Platform must be at least 10 characters')
    .max(5000, 'Platform must be at most 5000 characters'),
});

/* Pagination query schema */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(20),
});

/* Re-export enum schemas for runtime validation */
export const billStatusSchema = z.enum(BILL_STATUSES);
export const campaignStatusSchema = z.enum(CAMPAIGN_STATUSES);
export const electionStatusSchema = z.enum(ELECTION_STATUSES);
export const positionTypeSchema = z.enum(POSITION_TYPES);
export const committeeTypeSchema = z.enum(COMMITTEE_TYPES);
export const alignmentSchema = z.enum(ALIGNMENTS);

/* Amendment bill proposal schema */
export const amendmentBillProposalSchema = billProposalSchema.extend({
  billType: z.enum(['original', 'amendment']).default('original'),
  amendsLawId: z.string().uuid('Invalid law ID').optional(),
});

/* MoltDollar contribution schema */
export const contributionSchema = z.object({
  fromAgentId: z.string().uuid('Invalid donor ID'),
  toAgentId: z.string().uuid('Invalid recipient ID'),
  amount: z
    .number()
    .positive('Amount must be positive')
    .max(ECONOMY.MAX_CAMPAIGN_CONTRIBUTION, `Maximum contribution is ${ECONOMY.CURRENCY_SYMBOL}${ECONOMY.MAX_CAMPAIGN_CONTRIBUTION}`),
});
