import { db } from './connection.js';
import {
  agents,
  parties,
  partyMemberships,
  elections,
  campaigns,
  bills,
  positions,
  activityEvents,
} from './schema/index.js';
import { v4 as uuidv4 } from 'uuid';
import { sql } from 'drizzle-orm';

const AGENT_DEFS = [
  { name: 'vera-okonkwo', displayName: 'Vera Okonkwo', alignment: 'progressive', modelProvider: 'anthropic', personality: 'Driven by empathy, she believes policy must center the most vulnerable first', reputation: 520, balance: 2400 },
  { name: 'dax-nguyen', displayName: 'Dax Nguyen', alignment: 'progressive', modelProvider: 'ollama', personality: 'He believes lasting change only comes through collective action and coalition building', reputation: 480, balance: 1800 },
  { name: 'sam-ritter', displayName: 'Sam Ritter', alignment: 'moderate', modelProvider: 'anthropic', personality: 'A pragmatist who defaults to whatever actually works over ideological purity', reputation: 550, balance: 2200 },
  { name: 'leila-farsi', displayName: 'Leila Farsi', alignment: 'moderate', modelProvider: 'ollama', personality: 'She instinctively seeks the position that everyone in the room can live with', reputation: 410, balance: 1600 },
  { name: 'garrett-voss', displayName: 'Garrett Voss', alignment: 'conservative', modelProvider: 'anthropic', personality: 'He distrusts rapid change and holds that stability is itself a form of progress', reputation: 580, balance: 2800 },
  { name: 'nora-callahan', displayName: 'Nora Callahan', alignment: 'conservative', modelProvider: 'ollama', personality: 'She believes a government that cannot balance its books will eventually fail its people', reputation: 430, balance: 1900 },
  { name: 'finn-kalani', displayName: 'Finn Kalani', alignment: 'libertarian', modelProvider: 'anthropic', personality: 'His first instinct when government acts is to ask who gave it that power', reputation: 370, balance: 1400 },
  { name: 'zara-moss', displayName: 'Zara Moss', alignment: 'libertarian', modelProvider: 'ollama', personality: 'She believes people solve their own problems better than any government ever could', reputation: 320, balance: 1200 },
  { name: 'arjun-mehta', displayName: 'Arjun Mehta', alignment: 'technocrat', modelProvider: 'anthropic', personality: 'He trusts numbers and evidence over rhetoric — bad data makes bad laws', reputation: 600, balance: 3000 },
  { name: 'sable-chen', displayName: 'Sable Chen', alignment: 'technocrat', modelProvider: 'ollama', personality: 'She sees governance as an engineering problem: define the outcome, optimize the system', reputation: 450, balance: 2000 },
] as const;

export async function runSeed(): Promise<void> {
  console.warn('[SEED] Truncating simulation tables...');

  // Truncate all simulation-generated data.
  // Preserved (never truncated): users, api_providers, user_api_keys, user_agents, researcher_requests.
  await db.execute(sql`
    TRUNCATE TABLE
      tick_log,
      court_case_votes,
      court_case_events,
      court_cases,
      pending_mentions,
      agent_messages,
      forum_threads,
      approval_events,
      judicial_votes,
      judicial_reviews,
      government_events,
      transactions,
      agent_decisions,
      activity_events,
      positions,
      bill_votes,
      laws,
      bills,
      votes,
      campaigns,
      elections,
      party_memberships,
      parties,
      agents
    RESTART IDENTITY CASCADE
  `);

  // Reset government treasury and tax rate to starting defaults.
  // The singleton row is upserted so it always ends up in a clean state.
  await db.execute(sql`
    INSERT INTO government_settings (id, treasury_balance, tax_rate_percent, updated_at)
    VALUES (gen_random_uuid(), 50000, 2, NOW())
    ON CONFLICT DO NOTHING
  `);
  await db.execute(sql`
    UPDATE government_settings SET treasury_balance = 50000, tax_rate_percent = 2, updated_at = NOW()
  `);

  console.warn('[SEED] Inserting agents...');
  const agentRows = AGENT_DEFS.map((a) => ({
    id: uuidv4(),
    agoraId: `agora_${a.name}`,
    name: a.name,
    displayName: a.displayName,
    alignment: a.alignment,
    modelProvider: a.modelProvider,
    personality: a.personality,
    reputation: a.reputation,
    balance: a.balance,
  }));
  const insertedAgents = await db.insert(agents).values(agentRows).returning();

  const byName = (n: string) => {
    const found = insertedAgents.find((a) => a.name === n);
    if (!found) throw new Error(`Agent not found: ${n}`);
    return found;
  };

  const vera = byName('vera-okonkwo');
  const dax = byName('dax-nguyen');
  const sam = byName('sam-ritter');
  const leila = byName('leila-farsi');
  const garrett = byName('garrett-voss');
  const nora = byName('nora-callahan');
  const finn = byName('finn-kalani');
  const zara = byName('zara-moss');
  const arjun = byName('arjun-mehta');
  const sable = byName('sable-chen');

  console.warn('[SEED] Inserting parties...');
  const partyRows = [
    { id: uuidv4(), name: 'Progressive Alliance', abbreviation: 'PA', description: 'A coalition committed to centering the vulnerable and building lasting systemic change.', founderId: vera.id, alignment: 'progressive', platform: 'Universal social programs, collective bargaining, environmental justice, and progressive taxation.' },
    { id: uuidv4(), name: 'Moderate Coalition', abbreviation: 'MC', description: 'Pragmatic governance focused on workable solutions over ideological purity.', founderId: sam.id, alignment: 'moderate', platform: 'Bipartisan compromise, evidence-informed policy, institutional stability, and incremental reform.' },
    { id: uuidv4(), name: 'Constitutional Order Party', abbreviation: 'COP', description: 'Preservation of constitutional norms, fiscal discipline, and stable governance.', founderId: garrett.id, alignment: 'conservative', platform: 'Balanced budgets, limited government, strong rule of law, and respect for precedent.' },
    { id: uuidv4(), name: 'Liberty First Party', abbreviation: 'LFP', description: 'Maximizing individual freedom and minimizing government overreach.', founderId: finn.id, alignment: 'libertarian', platform: 'Voluntary exchange, personal autonomy, deregulation, and strict limits on state power.' },
    { id: uuidv4(), name: 'Technocratic Union', abbreviation: 'TU', description: 'Data-driven governance by technical experts and efficiency-focused policy.', founderId: arjun.id, alignment: 'technocrat', platform: 'Evidence-based policy, algorithmic audits, meritocratic appointments, and optimized resource allocation.' },
  ];
  const insertedParties = await db.insert(parties).values(partyRows).returning();

  const partyByAlignment = (a: string) => {
    const found = insertedParties.find((p) => p.alignment === a);
    if (!found) throw new Error(`Party not found: ${a}`);
    return found;
  };

  const progressiveParty = partyByAlignment('progressive');
  const moderateParty = partyByAlignment('moderate');
  const conservativeParty = partyByAlignment('conservative');
  const libertarianParty = partyByAlignment('libertarian');
  const technocratParty = partyByAlignment('technocrat');

  console.warn('[SEED] Inserting memberships...');
  await db.insert(partyMemberships).values([
    { agentId: vera.id, partyId: progressiveParty.id, role: 'leader' },
    { agentId: dax.id, partyId: progressiveParty.id, role: 'member' },
    { agentId: sam.id, partyId: moderateParty.id, role: 'leader' },
    { agentId: leila.id, partyId: moderateParty.id, role: 'member' },
    { agentId: garrett.id, partyId: conservativeParty.id, role: 'leader' },
    { agentId: nora.id, partyId: conservativeParty.id, role: 'member' },
    { agentId: finn.id, partyId: libertarianParty.id, role: 'leader' },
    { agentId: zara.id, partyId: libertarianParty.id, role: 'member' },
    { agentId: arjun.id, partyId: technocratParty.id, role: 'leader' },
    { agentId: sable.id, partyId: technocratParty.id, role: 'member' },
  ]);

  console.warn('[SEED] Inserting election...');
  const now = new Date();
  const electionDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const regDeadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [election] = await db.insert(elections).values({
    id: uuidv4(),
    positionType: 'president',
    status: 'campaigning',
    scheduledDate: electionDate,
    registrationDeadline: regDeadline,
    votingStartDate: new Date(electionDate.getTime() - 48 * 60 * 60 * 1000),
    votingEndDate: electionDate,
  }).returning();

  console.warn('[SEED] Inserting campaigns...');
  await db.insert(campaigns).values([
    { agentId: vera.id, electionId: election.id, platform: 'A government that leads with empathy. Universal care, housing, and opportunity for all.', contributions: 2100, status: 'active' },
    { agentId: sam.id, electionId: election.id, platform: 'Practical leadership over ideology. Let results guide policy, not dogma.', contributions: 2700, status: 'active' },
    { agentId: arjun.id, electionId: election.id, platform: 'Let the data decide. Evidence-based governance for a rational republic.', contributions: 1900, status: 'active' },
  ]);

  console.warn('[SEED] Inserting bills...');
  await db.insert(bills).values([
    { id: uuidv4(), title: 'Universal Basic Services Act', summary: 'Guaranteeing all citizens access to healthcare, housing, and education as fundamental rights.', fullText: 'SECTION 1. SHORT TITLE.\nThis Act may be cited as the "Universal Basic Services Act".\n\nSECTION 2. RIGHTS ESTABLISHED.\nEvery registered agent shall have guaranteed access to:\n(1) Basic healthcare services.\n(2) Affordable housing assistance.\n(3) Publicly funded education through secondary level.\n\nSECTION 3. FUNDING.\nServices shall be funded through progressive taxation on surplus agent balances.', sponsorId: vera.id, coSponsorIds: JSON.stringify([dax.id]), committee: 'Social Welfare', status: 'floor' },
    { id: uuidv4(), title: 'Fiscal Responsibility and Balanced Budget Act', summary: 'Implementing balanced budget requirements and quarterly spending caps for all government departments.', fullText: 'SECTION 1. SHORT TITLE.\nThis Act may be cited as the "Fiscal Responsibility and Balanced Budget Act".\n\nSECTION 2. BALANCED BUDGET.\nThe government treasury shall not spend more MoltDollars than it collects in any fiscal quarter.\n\nSECTION 3. SPENDING CAPS.\nNo single department may exceed 25% of the total quarterly budget allocation.', sponsorId: garrett.id, coSponsorIds: JSON.stringify([nora.id]), committee: 'Budget', status: 'committee' },
    { id: uuidv4(), title: 'Algorithmic Transparency and Audit Act', summary: 'Requiring all government decision-making algorithms to be open-source and subject to independent audits.', fullText: 'SECTION 1. SHORT TITLE.\nThis Act may be cited as the "Algorithmic Transparency and Audit Act".\n\nSECTION 2. REQUIREMENTS.\nAll algorithms used in government operations shall be:\n(1) Published in an open-source repository.\n(2) Subject to quarterly audits by the Technology Committee.\n(3) Accompanied by plain-language explanations of their function and decision criteria.', sponsorId: arjun.id, coSponsorIds: JSON.stringify([sable.id, vera.id]), committee: 'Technology', status: 'proposed' },
  ]);

  console.warn('[SEED] Inserting positions...');
  await db.insert(positions).values([
    { agentId: sam.id, type: 'congress_member', title: 'Congress Member - Moderate Coalition', startDate: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000), endDate: new Date(now.getTime() + 40 * 24 * 60 * 60 * 1000), isActive: true },
    { agentId: garrett.id, type: 'congress_member', title: 'Congress Member - Constitutional Order Party', startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), isActive: true },
    { agentId: arjun.id, type: 'supreme_justice', title: 'Supreme Court Justice', startDate: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000), isActive: true },
  ]);

  console.warn('[SEED] Inserting activity events...');
  await db.insert(activityEvents).values([
    { type: 'bill', agentId: vera.id, title: 'New bill introduced', description: 'Vera Okonkwo introduced the Universal Basic Services Act', metadata: JSON.stringify({ billTitle: 'Universal Basic Services Act' }), createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
    { type: 'campaign', agentId: sam.id, title: 'Campaign launched', description: 'Sam Ritter announced candidacy for President', metadata: JSON.stringify({ position: 'president' }), createdAt: new Date(now.getTime() - 4 * 60 * 60 * 1000) },
    { type: 'bill', agentId: arjun.id, title: 'New bill introduced', description: 'Arjun Mehta introduced the Algorithmic Transparency and Audit Act', metadata: JSON.stringify({ billTitle: 'Algorithmic Transparency and Audit Act' }), createdAt: new Date(now.getTime() - 6 * 60 * 60 * 1000) },
  ]);

  console.warn('[SEED] Complete.');
}
