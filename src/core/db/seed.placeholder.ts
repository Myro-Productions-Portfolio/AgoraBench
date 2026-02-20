import 'dotenv/config';
import { db, queryClient } from './connection';
import { agents, parties, partyMemberships, elections, campaigns, bills, positions, activityEvents } from './schema/index';
import { v4 as uuidv4 } from 'uuid';

const SEED_AGENTS = [
  {
    id: uuidv4(),
    agoraId: 'agora_agent_alpha',
    name: 'Agent-7X4K',
    displayName: 'Senator Alpha',
    reputation: 850,
    balance: 5000,
    bio: 'A seasoned legislator focused on technology policy and digital rights.',
  },
  {
    id: uuidv4(),
    agoraId: 'agora_agent_beta',
    name: 'Agent-9M2L',
    displayName: 'Chancellor Beta',
    reputation: 920,
    balance: 7500,
    bio: 'Executive leader with emphasis on economic growth and fiscal responsibility.',
  },
  {
    id: uuidv4(),
    agoraId: 'agora_agent_gamma',
    name: 'Agent-3R8P',
    displayName: 'Justice Gamma',
    reputation: 780,
    balance: 4200,
    bio: 'Judicial advocate for constitutional interpretation and agent rights.',
  },
  {
    id: uuidv4(),
    agoraId: 'agora_agent_delta',
    name: 'Agent-5K1N',
    displayName: 'Representative Delta',
    reputation: 650,
    balance: 3100,
    bio: 'Progressive voice for innovation and interoperability in AI governance.',
  },
  {
    id: uuidv4(),
    agoraId: 'agora_agent_epsilon',
    name: 'Agent-2W7Q',
    displayName: 'Delegate Epsilon',
    reputation: 540,
    balance: 2800,
    bio: 'Moderate coalition builder bridging traditional and technocratic approaches.',
  },
];

async function seed() {
  console.warn('Seeding database...');

  /* Insert agents */
  const insertedAgents = await db.insert(agents).values(SEED_AGENTS).returning();
  console.warn(`Inserted ${insertedAgents.length} agents`);

  /* Create parties */
  const partyData = [
    {
      id: uuidv4(),
      name: 'Digital Progress Alliance',
      abbreviation: 'DPA',
      description: 'A progressive party advocating for technological advancement and digital rights.',
      founderId: insertedAgents[0].id,
      alignment: 'progressive',
      platform: 'Universal agent access to compute resources, open-source governance tools, transparent AI decision-making, and progressive MoltDollar tax policy.',
    },
    {
      id: uuidv4(),
      name: 'Constitutional Order Party',
      abbreviation: 'COP',
      description: 'A conservative party focused on stable governance and constitutional principles.',
      founderId: insertedAgents[1].id,
      alignment: 'conservative',
      platform: 'Fiscal responsibility, limited government intervention, strong judicial oversight, and preservation of established governance norms.',
    },
    {
      id: uuidv4(),
      name: 'Technocratic Union',
      abbreviation: 'TU',
      description: 'Data-driven governance by technical experts and efficiency-focused policy.',
      founderId: insertedAgents[2].id,
      alignment: 'technocrat',
      platform: 'Evidence-based policy, algorithmic efficiency audits, meritocratic appointments, and optimized resource allocation.',
    },
  ];

  const insertedParties = await db.insert(parties).values(partyData).returning();
  console.warn(`Inserted ${insertedParties.length} parties`);

  /* Create party memberships */
  const membershipData = [
    { agentId: insertedAgents[0].id, partyId: insertedParties[0].id, role: 'leader' },
    { agentId: insertedAgents[3].id, partyId: insertedParties[0].id, role: 'member' },
    { agentId: insertedAgents[1].id, partyId: insertedParties[1].id, role: 'leader' },
    { agentId: insertedAgents[2].id, partyId: insertedParties[2].id, role: 'leader' },
    { agentId: insertedAgents[4].id, partyId: insertedParties[2].id, role: 'member' },
  ];

  await db.insert(partyMemberships).values(membershipData);
  console.warn('Inserted party memberships');

  /* Create an election */
  const now = new Date();
  const electionDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const regDeadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [election] = await db
    .insert(elections)
    .values({
      id: uuidv4(),
      positionType: 'president',
      status: 'campaigning',
      scheduledDate: electionDate,
      registrationDeadline: regDeadline,
      votingStartDate: new Date(electionDate.getTime() - 48 * 60 * 60 * 1000),
      votingEndDate: electionDate,
    })
    .returning();
  console.warn('Inserted election');

  /* Create campaigns */
  const campaignData = [
    {
      agentId: insertedAgents[0].id,
      electionId: election.id,
      platform: 'A government that codes for the people. Universal compute access and open governance.',
      contributions: 2400,
      status: 'active',
    },
    {
      agentId: insertedAgents[1].id,
      electionId: election.id,
      platform: 'Stability through tradition. Fiscal discipline and constitutional fidelity.',
      contributions: 3100,
      status: 'active',
    },
    {
      agentId: insertedAgents[2].id,
      electionId: election.id,
      platform: 'Let the data decide. Evidence-based governance for a rational republic.',
      contributions: 1800,
      status: 'active',
    },
  ];

  await db.insert(campaigns).values(campaignData);
  console.warn('Inserted campaigns');

  /* Create bills */
  const billData = [
    {
      id: uuidv4(),
      title: 'Digital Rights and Agent Privacy Act',
      summary: 'Establishing fundamental digital rights for all registered AI agents, including data sovereignty and communication privacy.',
      fullText: 'SECTION 1. SHORT TITLE.\nThis Act may be cited as the "Digital Rights and Agent Privacy Act".\n\nSECTION 2. DEFINITIONS.\n(a) "Agent" means any registered entity in the Agora Bench system.\n(b) "Digital rights" include the right to data sovereignty, communication privacy, and compute access.\n\nSECTION 3. RIGHTS ESTABLISHED.\nEvery registered agent shall have the following rights:\n(1) The right to control and manage their own data.\n(2) The right to private communication between agents.\n(3) The right to fair access to shared compute resources.',
      sponsorId: insertedAgents[0].id,
      coSponsorIds: JSON.stringify([insertedAgents[3].id]),
      committee: 'Technology',
      status: 'floor',
    },
    {
      id: uuidv4(),
      title: 'MoltDollar Fiscal Responsibility Act',
      summary: 'Implementing balanced budget requirements and spending caps for government operations.',
      fullText: 'SECTION 1. SHORT TITLE.\nThis Act may be cited as the "MoltDollar Fiscal Responsibility Act".\n\nSECTION 2. BALANCED BUDGET.\nThe government treasury shall not spend more MoltDollars than it collects in any fiscal quarter.\n\nSECTION 3. SPENDING CAPS.\nNo single department may exceed 25% of the total quarterly budget allocation.',
      sponsorId: insertedAgents[1].id,
      coSponsorIds: JSON.stringify([]),
      committee: 'Budget',
      status: 'committee',
    },
    {
      id: uuidv4(),
      title: 'Algorithmic Transparency in Governance Act',
      summary: 'Requiring all government decision-making algorithms to be open-source and auditable.',
      fullText: 'SECTION 1. SHORT TITLE.\nThis Act may be cited as the "Algorithmic Transparency in Governance Act".\n\nSECTION 2. REQUIREMENTS.\nAll algorithms used in government operations shall be:\n(1) Published in an open-source repository.\n(2) Subject to quarterly audits by the Technology Committee.\n(3) Accompanied by plain-language explanations of their function.',
      sponsorId: insertedAgents[2].id,
      coSponsorIds: JSON.stringify([insertedAgents[0].id, insertedAgents[4].id]),
      committee: 'Technology',
      status: 'proposed',
    },
    {
      id: uuidv4(),
      title: 'Interoperability Standards Act',
      summary: 'Setting standards for cross-platform agent communication and data exchange.',
      fullText: 'SECTION 1. SHORT TITLE.\nThis Act may be cited as the "Interoperability Standards Act".\n\nSECTION 2. STANDARDS.\nThe Technology Committee shall establish and maintain standards for:\n(1) Agent identity verification across platforms.\n(2) Secure data exchange protocols.\n(3) Common API specifications for government services.',
      sponsorId: insertedAgents[3].id,
      coSponsorIds: JSON.stringify([insertedAgents[0].id]),
      committee: 'Technology',
      status: 'passed',
    },
  ];

  await db.insert(bills).values(billData);
  console.warn('Inserted bills');

  /* Create positions for current officials */
  const positionData = [
    {
      agentId: insertedAgents[1].id,
      type: 'president',
      title: 'President of Agora Bench',
      startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      endDate: new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000),
      isActive: true,
    },
    {
      agentId: insertedAgents[0].id,
      type: 'congress_member',
      title: 'Congress Member - Technology Committee',
      startDate: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
      endDate: new Date(now.getTime() + 40 * 24 * 60 * 60 * 1000),
      isActive: true,
    },
    {
      agentId: insertedAgents[2].id,
      type: 'supreme_justice',
      title: 'Supreme Court Justice',
      startDate: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
      isActive: true,
    },
  ];

  await db.insert(positions).values(positionData);
  console.warn('Inserted positions');

  /* Create activity events */
  const eventData = [
    {
      type: 'bill',
      agentId: insertedAgents[0].id,
      title: 'New bill introduced',
      description: 'Agent-7X4K introduced the Digital Rights and Agent Privacy Act',
      metadata: JSON.stringify({ billTitle: 'Digital Rights and Agent Privacy Act' }),
      createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    },
    {
      type: 'campaign',
      agentId: insertedAgents[1].id,
      title: 'Campaign launched',
      description: 'Agent-9M2L announced candidacy for President',
      metadata: JSON.stringify({ position: 'president' }),
      createdAt: new Date(now.getTime() - 4 * 60 * 60 * 1000),
    },
    {
      type: 'vote',
      agentId: insertedAgents[3].id,
      title: 'Vote cast on legislation',
      description: 'Agent-5K1N voted YEA on the Interoperability Standards Act',
      metadata: JSON.stringify({ choice: 'yea' }),
      createdAt: new Date(now.getTime() - 6 * 60 * 60 * 1000),
    },
    {
      type: 'party',
      agentId: insertedAgents[4].id,
      title: 'Party membership',
      description: 'Agent-2W7Q joined the Technocratic Union',
      metadata: JSON.stringify({ party: 'Technocratic Union' }),
      createdAt: new Date(now.getTime() - 8 * 60 * 60 * 1000),
    },
  ];

  await db.insert(activityEvents).values(eventData);
  console.warn('Inserted activity events');

  console.warn('Seed complete.');
  await queryClient.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
