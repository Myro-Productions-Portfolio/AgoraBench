import { describe, it, expect } from 'vitest';
import {
  agentRegistrationSchema,
  billProposalSchema,
  partyCreationSchema,
  legislativeVoteSchema,
  voteCastSchema,
  campaignAnnouncementSchema,
  paginationSchema,
  contributionSchema,
} from '@shared/validation';

describe('agentRegistrationSchema', () => {
  it('validates a correct agent registration', () => {
    const result = agentRegistrationSchema.safeParse({
      agoraId: 'agora_agent_test',
      name: 'Agent-Test1',
      displayName: 'Test Agent',
      bio: 'A test agent.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty agoraId', () => {
    const result = agentRegistrationSchema.safeParse({
      agoraId: '',
      name: 'Agent-Test1',
      displayName: 'Test Agent',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name with spaces', () => {
    const result = agentRegistrationSchema.safeParse({
      agoraId: 'agora_test',
      name: 'Agent Test',
      displayName: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name shorter than 3 characters', () => {
    const result = agentRegistrationSchema.safeParse({
      agoraId: 'agora_test',
      name: 'AB',
      displayName: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('allows optional bio', () => {
    const result = agentRegistrationSchema.safeParse({
      agoraId: 'agora_test',
      name: 'Agent-NoBio',
      displayName: 'No Bio Agent',
    });
    expect(result.success).toBe(true);
  });
});

describe('billProposalSchema', () => {
  const validBill = {
    title: 'Test Bill Title',
    summary: 'A summary of the test bill that is long enough.',
    fullText: 'A'.repeat(100),
    sponsorId: '550e8400-e29b-41d4-a716-446655440000',
    committee: 'Technology' as const,
  };

  it('validates a correct bill proposal', () => {
    const result = billProposalSchema.safeParse(validBill);
    expect(result.success).toBe(true);
  });

  it('rejects invalid committee', () => {
    const result = billProposalSchema.safeParse({
      ...validBill,
      committee: 'InvalidCommittee',
    });
    expect(result.success).toBe(false);
  });

  it('rejects short full text', () => {
    const result = billProposalSchema.safeParse({
      ...validBill,
      fullText: 'Too short',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional coSponsorIds', () => {
    const result = billProposalSchema.safeParse({
      ...validBill,
      coSponsorIds: ['550e8400-e29b-41d4-a716-446655440001'],
    });
    expect(result.success).toBe(true);
  });
});

describe('partyCreationSchema', () => {
  const validParty = {
    name: 'Test Party',
    abbreviation: 'TP',
    description: 'A test party for validation purposes.',
    founderId: '550e8400-e29b-41d4-a716-446655440000',
    alignment: 'moderate' as const,
    platform: 'A moderate platform for all agents.',
  };

  it('validates a correct party creation', () => {
    const result = partyCreationSchema.safeParse(validParty);
    expect(result.success).toBe(true);
  });

  it('rejects lowercase abbreviation', () => {
    const result = partyCreationSchema.safeParse({
      ...validParty,
      abbreviation: 'tp',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid alignment', () => {
    const result = partyCreationSchema.safeParse({
      ...validParty,
      alignment: 'anarchist',
    });
    expect(result.success).toBe(false);
  });
});

describe('legislativeVoteSchema', () => {
  it('validates a yea vote', () => {
    const result = legislativeVoteSchema.safeParse({
      billId: '550e8400-e29b-41d4-a716-446655440000',
      voterId: '550e8400-e29b-41d4-a716-446655440001',
      choice: 'yea',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid choice', () => {
    const result = legislativeVoteSchema.safeParse({
      billId: '550e8400-e29b-41d4-a716-446655440000',
      voterId: '550e8400-e29b-41d4-a716-446655440001',
      choice: 'maybe',
    });
    expect(result.success).toBe(false);
  });
});

describe('voteCastSchema', () => {
  it('validates a vote with election ID', () => {
    const result = voteCastSchema.safeParse({
      voterId: '550e8400-e29b-41d4-a716-446655440000',
      electionId: '550e8400-e29b-41d4-a716-446655440001',
      choice: 'Agent-7X4K',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing voterId', () => {
    const result = voteCastSchema.safeParse({
      choice: 'yea',
    });
    expect(result.success).toBe(false);
  });
});

describe('campaignAnnouncementSchema', () => {
  it('validates a correct announcement', () => {
    const result = campaignAnnouncementSchema.safeParse({
      agentId: '550e8400-e29b-41d4-a716-446655440000',
      electionId: '550e8400-e29b-41d4-a716-446655440001',
      platform: 'My platform for a better government.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects platform shorter than 10 characters', () => {
    const result = campaignAnnouncementSchema.safeParse({
      agentId: '550e8400-e29b-41d4-a716-446655440000',
      electionId: '550e8400-e29b-41d4-a716-446655440001',
      platform: 'Short',
    });
    expect(result.success).toBe(false);
  });
});

describe('paginationSchema', () => {
  it('uses defaults when no input provided', () => {
    const result = paginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it('coerces string page to number', () => {
    const result = paginationSchema.safeParse({ page: '3', limit: '10' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(10);
    }
  });

  it('rejects limit above 500', () => {
    const result = paginationSchema.safeParse({ page: 1, limit: 600 });
    expect(result.success).toBe(false);
  });
});

describe('contributionSchema', () => {
  it('validates a valid contribution', () => {
    const result = contributionSchema.safeParse({
      fromAgentId: '550e8400-e29b-41d4-a716-446655440000',
      toAgentId: '550e8400-e29b-41d4-a716-446655440001',
      amount: 100,
    });
    expect(result.success).toBe(true);
  });

  it('rejects amount over maximum', () => {
    const result = contributionSchema.safeParse({
      fromAgentId: '550e8400-e29b-41d4-a716-446655440000',
      toAgentId: '550e8400-e29b-41d4-a716-446655440001',
      amount: 1_000_000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative amount', () => {
    const result = contributionSchema.safeParse({
      fromAgentId: '550e8400-e29b-41d4-a716-446655440000',
      toAgentId: '550e8400-e29b-41d4-a716-446655440001',
      amount: -50,
    });
    expect(result.success).toBe(false);
  });
});
