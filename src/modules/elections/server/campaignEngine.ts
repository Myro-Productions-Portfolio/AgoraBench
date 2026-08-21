/**
 * Campaign Realism engine — real-money campaign finance physics.
 * Called from Phase 15 behind rc.campaignFinanceEnabled; every entry point
 * is also try/caught at the call site so no failure can fail the tick.
 *
 * Fiscal inertness (pinned by test): this module never touches
 * government_settings, fiscal_tick_summaries, or the Phase 12/13 accrual
 * stream. Donations move wallet -> war chest (from=donor, to=NULL);
 * expenditures burn war chest (NULL -> NULL, no balanceAfter — the
 * appropriation precedent). The treasury never sees campaign money.
 */

import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '@db/connection';
import {
  agents,
  elections,
  campaigns,
  transactions,
  agentRelationships,
  agentPolicyPositions,
  activityEvents,
  positions,
  parties,
  partyMemberships,
  governmentEvents,
  campaignDonations,
  donationStances,
  campaignEndorsements,
  electionPolls,
  agentStatements,
} from '@db/schema/index';
import { generateAgentDecision } from '@core/server/services/ai.js';
import type { RuntimeConfig } from '@core/server/runtimeConfig';
import { broadcast } from '@core/server/websocket.js';
import { officeRank, orderCandidates } from '@core/server/lib/electionMath.js';
import {
  campaignRng,
  donationAmount,
  spendAmount,
  computePollSnapshot,
  debateTicksFor,
  debateReception,
  STANCE_ASKS_PER_TICK,
  ENDORSE_ASKS_PER_TICK,
  DEBATE_GLOW_TICKS,
  DEBATE_WIN_APPROVAL,
  type Generosity,
  type PollVoter,
  type PollCandidate,
  type DebateParticipantInput,
} from '@core/server/lib/campaignMath.js';

export interface EngineElection {
  id: string;
  positionType: string;
}

export interface EngineCampaign {
  id: string;
  electionId: string;
  agentId: string;
  status: string;
}

export interface EngineAgent {
  id: string;
  displayName: string;
  alignment: string | null;
  modelProvider: string | null;
  personality: string | null;
  model?: string | null;
  ownerUserId?: string | null;
  approvalRating?: number | null;
}

export interface CampaignFunds {
  spentThisTick: number;
  contributions: number;
  spent: number;
}

/* ── Pure row builders (exported for the conservation-fold tests — the
      engine materializes exactly these shapes inside its transactions) ── */

export interface DonationLedgerRows {
  txRow: {
    fromAgentId: string;
    toAgentId: null;
    amount: number;
    type: 'donation';
    description: string;
    balanceAfter: number;
  };
  donationRow: {
    electionId: string;
    campaignId: string;
    donorAgentId: string;
    amount: number;
    tick: number;
  };
  contributionsDelta: number;
}

export function donationLedgerRows(input: {
  donorId: string;
  amount: number;
  balanceAfter: number;
  electionId: string;
  campaignId: string;
  tick: number;
  candidateName: string;
  positionType: string;
  selfFunded: boolean;
}): DonationLedgerRows {
  const description = input.selfFunded
    ? `Self-funded ${input.positionType} campaign`
    : `Donation to ${input.candidateName} (${input.positionType} campaign)`;
  return {
    txRow: {
      fromAgentId: input.donorId,
      toAgentId: null,
      amount: input.amount,
      type: 'donation',
      description,
      balanceAfter: input.balanceAfter,
    },
    donationRow: {
      electionId: input.electionId,
      campaignId: input.campaignId,
      donorAgentId: input.donorId,
      amount: input.amount,
      tick: input.tick,
    },
    contributionsDelta: input.amount,
  };
}

export interface ExpenditureLedgerRows {
  txRow: {
    fromAgentId: null;
    toAgentId: null;
    amount: number;
    type: 'campaign_expenditure';
    description: string;
    /* NULL -> NULL burn: no wallet involved, so no balanceAfter — ever. */
    balanceAfter: null;
  };
  spentDelta: number;
}

export function expenditureLedgerRows(input: {
  amount: number;
  candidateName: string;
  positionType: string;
}): ExpenditureLedgerRows {
  return {
    txRow: {
      fromAgentId: null,
      toAgentId: null,
      amount: input.amount,
      type: 'campaign_expenditure',
      description: `Campaign expenditure (${input.candidateName}, ${input.positionType} race)`,
      balanceAfter: null,
    },
    spentDelta: input.amount,
  };
}

/** Donation target: the stance's pick while that campaign is still active,
    else the donor's highest-voteAlignment candidate, else the earliest
    registrant (input order = registration order). */
export function chooseDonationTarget(
  preferredCampaignId: string | null,
  activeRaceCampaigns: EngineCampaign[],
  alignmentByCandidate: Map<string, number>,
): EngineCampaign | null {
  if (activeRaceCampaigns.length === 0) return null;
  if (preferredCampaignId) {
    const preferred = activeRaceCampaigns.find((c) => c.id === preferredCampaignId);
    if (preferred) return preferred;
  }
  let best = activeRaceCampaigns[0];
  let bestScore = -Infinity;
  for (const c of activeRaceCampaigns) {
    const score = alignmentByCandidate.get(c.agentId) ?? -1;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

const GENEROSITIES: readonly Generosity[] = ['low', 'medium', 'high'];

function parseGenerosity(raw: unknown): Generosity {
  const s = String(raw ?? '').toLowerCase();
  return (GENEROSITIES as readonly string[]).includes(s) ? (s as Generosity) : 'medium';
}

function agentRecord(agent: EngineAgent, rc: Readonly<RuntimeConfig>) {
  return {
    id: agent.id,
    displayName: agent.displayName,
    alignment: agent.alignment,
    modelProvider: rc.providerOverride === 'default' ? agent.modelProvider : rc.providerOverride,
    personality: agent.personality,
    model: agent.model,
    ownerUserId: agent.ownerUserId,
  };
}

/* ── Donation stances — one LLM ask per (election, non-candidate), ever ── */

export async function runDonationStances(opts: {
  elections: EngineElection[];
  campaigns: EngineCampaign[];
  activeAgents: EngineAgent[];
  platformByCampaignId: Map<string, string>;
  tickNumber: number;
  rc: Readonly<RuntimeConfig>;
}): Promise<void> {
  const { elections: races, activeAgents, platformByCampaignId, tickNumber, rc } = opts;
  if (races.length === 0) return;

  const raceIds = races.map((e) => e.id);
  const existing = await db
    .select({ electionId: donationStances.electionId, agentId: donationStances.agentId })
    .from(donationStances)
    .where(inArray(donationStances.electionId, raceIds));
  const asked = new Set(existing.map((s) => `${s.electionId}:${s.agentId}`));

  /* Deterministic ask order: elections by id, agents by id; hard-capped at
     STANCE_ASKS_PER_TICK across all races (internal throttle, not config). */
  const asks: Array<{ election: EngineElection; agent: EngineAgent; raceCampaigns: EngineCampaign[] }> = [];
  for (const election of [...races].sort((a, b) => a.id.localeCompare(b.id))) {
    const raceCampaigns = opts.campaigns.filter((c) => c.electionId === election.id && c.status === 'active');
    if (raceCampaigns.length === 0) continue;
    const candidateIds = new Set(raceCampaigns.map((c) => c.agentId));
    for (const agent of [...activeAgents].sort((a, b) => a.id.localeCompare(b.id))) {
      if (candidateIds.has(agent.id)) continue;
      if (asked.has(`${election.id}:${agent.id}`)) continue;
      asks.push({ election, agent, raceCampaigns });
      if (asks.length >= STANCE_ASKS_PER_TICK) break;
    }
    if (asks.length >= STANCE_ASKS_PER_TICK) break;
  }
  if (asks.length === 0) return;

  const agentById = new Map(activeAgents.map((a) => [a.id, a]));
  const results = await Promise.allSettled(
    asks.map(({ election, agent, raceCampaigns }) => {
      const candidateBlock = raceCampaigns
        .map((c) => {
          const name = agentById.get(c.agentId)?.displayName ?? 'Unknown';
          const platform = (platformByCampaignId.get(c.id) ?? '').slice(0, 200);
          return `  - ${name} (id: ${c.agentId}): ${platform}`;
        })
        .join('\n');
      const contextMessage =
        `A ${election.positionType} election is in its campaign phase. Candidates:\n${candidateBlock}\n\n` +
        `Decide whether you will donate to a campaign this cycle. Donations come out of your own balance every day of the campaign. ` +
        `Respond with: {"action":"donation_stance","reasoning":"one sentence","data":{"willDonate":true,"candidateId":"<chosen candidate id, or null if not donating>","generosity":"low"|"medium"|"high"}}`;
      return generateAgentDecision(agentRecord(agent, rc), contextMessage, 'donation_stance')
        .then((decision) => ({ election, agent, raceCampaigns, decision }));
    }),
  );

  let recorded = 0;
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('[CAMPAIGN] Donation stance call rejected (retry next tick):', result.reason);
      continue;
    }
    const { election, agent, raceCampaigns, decision } = result.value;

    /* Transport failure -> no row (ask again next tick). Anything the model
       actually returned — including unparseable — persists permanently;
       unparseable persists as willDonate=false. */
    if (decision.action === 'idle' && decision.reasoning === 'api error') continue;

    let willDonate = false;
    let preferredCampaignId: string | null = null;
    let generosity: Generosity = 'medium';
    if (decision.action === 'donation_stance') {
      const rawWill = decision.data?.['willDonate'];
      willDonate = rawWill === true || String(rawWill).toLowerCase() === 'true' || String(rawWill).toLowerCase() === 'yes';
      if (willDonate) {
        const candidateId = String(decision.data?.['candidateId'] ?? '');
        preferredCampaignId = raceCampaigns.find((c) => c.agentId === candidateId)?.id ?? null;
        generosity = parseGenerosity(decision.data?.['generosity']);
      }
    }

    await db
      .insert(donationStances)
      .values({
        electionId: election.id,
        agentId: agent.id,
        willDonate,
        preferredCampaignId,
        generosity,
        tick: tickNumber,
      })
      .onConflictDoNothing();
    recorded += 1;
  }
  if (recorded > 0) console.warn(`[CAMPAIGN] ${recorded} donation stance(s) recorded`);
}

/* ── Donation drip + candidate self-funding ─────────────────────────── */

export async function runDonationDrip(opts: {
  elections: EngineElection[];
  campaigns: EngineCampaign[];
  activeAgents: EngineAgent[];
  tickNumber: number;
  rc: Readonly<RuntimeConfig>;
}): Promise<void> {
  const { elections: races, activeAgents, tickNumber, rc } = opts;
  if (races.length === 0 || rc.donationRatePct <= 0) return;

  const raceIds = races.map((e) => e.id);
  const stanceRows = await db
    .select()
    .from(donationStances)
    .where(and(inArray(donationStances.electionId, raceIds), eq(donationStances.willDonate, true)));

  const agentById = new Map(activeAgents.map((a) => [a.id, a]));

  /* Fresh balances for everyone who might give this tick (donors +
     self-funding candidates), decremented in memory across sequential
     donations so multi-race donors never plan against a stale wallet. */
  const donorIds = new Set<string>(stanceRows.map((s) => s.agentId));
  for (const c of opts.campaigns) if (c.status === 'active') donorIds.add(c.agentId);
  if (donorIds.size === 0) return;
  const balanceRows = await db
    .select({ id: agents.id, balance: agents.balance })
    .from(agents)
    .where(inArray(agents.id, [...donorIds]));
  const balances = new Map(balanceRows.map((r) => [r.id, r.balance]));

  let donationCount = 0;
  let donationTotal = 0;

  for (const election of [...races].sort((a, b) => a.id.localeCompare(b.id))) {
    const raceCampaigns = opts.campaigns.filter((c) => c.electionId === election.id && c.status === 'active');
    if (raceCampaigns.length === 0) continue;
    const candidateIds = new Set(raceCampaigns.map((c) => c.agentId));

    const raceStances = stanceRows
      .filter((s) => s.electionId === election.id && !candidateIds.has(s.agentId))
      .sort((a, b) => a.agentId.localeCompare(b.agentId));

    /* Donor -> candidate voteAlignment for preferred-campaign fallback. */
    const alignmentRows = raceStances.length > 0
      ? await db
          .select({
            agentId: agentRelationships.agentId,
            targetAgentId: agentRelationships.targetAgentId,
            voteAlignment: agentRelationships.voteAlignment,
          })
          .from(agentRelationships)
          .where(and(
            inArray(agentRelationships.agentId, raceStances.map((s) => s.agentId)),
            inArray(agentRelationships.targetAgentId, [...candidateIds]),
          ))
      : [];
    const alignmentByDonor = new Map<string, Map<string, number>>();
    for (const r of alignmentRows) {
      let inner = alignmentByDonor.get(r.agentId);
      if (!inner) { inner = new Map(); alignmentByDonor.set(r.agentId, inner); }
      inner.set(r.targetAgentId, r.voteAlignment);
    }

    const give = async (
      donorId: string,
      target: EngineCampaign,
      generosity: Generosity,
      selfFunded: boolean,
    ): Promise<void> => {
      const balance = balances.get(donorId);
      if (balance === undefined) return;
      const rng = campaignRng(tickNumber, election.id, donorId, selfFunded ? 'selffund' : 'donation');
      const amount = donationAmount(balance, rc.donationRatePct, generosity, rng);
      if (amount <= 0) return;
      const candidateName = agentById.get(target.agentId)?.displayName ?? 'Unknown';
      try {
        await db.transaction(async (tx) => {
          /* balanceAfter comes from RETURNING — the exact post-debit chain
             value, never an in-memory subtraction. */
          const [updated] = await tx
            .update(agents)
            .set({ balance: sql`${agents.balance} - ${amount}` })
            .where(and(eq(agents.id, donorId), sql`${agents.balance} >= ${amount}`))
            .returning({ balance: agents.balance });
          if (!updated) throw new Error('insufficient balance');
          const rows = donationLedgerRows({
            donorId,
            amount,
            balanceAfter: updated.balance,
            electionId: election.id,
            campaignId: target.id,
            tick: tickNumber,
            candidateName,
            positionType: election.positionType,
            selfFunded,
          });
          await tx.insert(transactions).values(rows.txRow);
          await tx.insert(campaignDonations).values(rows.donationRow);
          await tx
            .update(campaigns)
            .set({ contributions: sql`${campaigns.contributions} + ${rows.contributionsDelta}` })
            .where(eq(campaigns.id, target.id));
        });
        balances.set(donorId, (balances.get(donorId) ?? 0) - amount);
        donationCount += 1;
        donationTotal += amount;
      } catch (err) {
        console.warn(`[CAMPAIGN] Donation failed (${donorId} -> ${target.id}):`, err instanceof Error ? err.message : err);
      }
    };

    for (const stance of raceStances) {
      if (!agentById.has(stance.agentId)) continue;
      const target = chooseDonationTarget(
        stance.preferredCampaignId,
        raceCampaigns,
        alignmentByDonor.get(stance.agentId) ?? new Map(),
      );
      if (!target) continue;
      await give(stance.agentId, target, parseGenerosity(stance.generosity), false);
    }

    /* Candidates self-fund at medium generosity by physics — never asked. */
    for (const campaign of [...raceCampaigns].sort((a, b) => a.agentId.localeCompare(b.agentId))) {
      if (!agentById.has(campaign.agentId)) continue;
      await give(campaign.agentId, campaign, 'medium', true);
    }
  }

  if (donationCount > 0) {
    console.warn(`[CAMPAIGN] ${donationCount} donation(s) totaling $${donationTotal.toLocaleString('en-US')}`);
  }
}

/* ── Campaign spending — war chest burns into reach ─────────────────── */

export async function runCampaignSpending(opts: {
  elections: EngineElection[];
  activeAgents: EngineAgent[];
  tickNumber: number;
  rc: Readonly<RuntimeConfig>;
}): Promise<Map<string, CampaignFunds>> {
  const { elections: races, activeAgents, tickNumber, rc } = opts;
  const funds = new Map<string, CampaignFunds>();
  if (races.length === 0) return funds;

  /* Re-select fresh money columns — this tick's drip already landed. */
  const rows = await db
    .select({
      id: campaigns.id,
      electionId: campaigns.electionId,
      agentId: campaigns.agentId,
      contributions: campaigns.contributions,
      spent: campaigns.spent,
    })
    .from(campaigns)
    .where(and(eq(campaigns.status, 'active'), inArray(campaigns.electionId, races.map((e) => e.id))));

  const agentById = new Map(activeAgents.map((a) => [a.id, a]));
  const electionById = new Map(races.map((e) => [e.id, e]));
  let spendCount = 0;
  let spendTotal = 0;

  for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    const available = Math.max(0, (row.contributions ?? 0) - (row.spent ?? 0));
    const amount = rc.campaignSpendRatePct > 0
      ? spendAmount(available, rc.campaignSpendRatePct, campaignRng(tickNumber, row.id, 'spend'))
      : 0;
    if (amount <= 0) {
      funds.set(row.id, { spentThisTick: 0, contributions: row.contributions ?? 0, spent: row.spent ?? 0 });
      continue;
    }
    const candidateName = agentById.get(row.agentId)?.displayName ?? 'Unknown';
    const positionType = electionById.get(row.electionId)?.positionType ?? 'office';
    try {
      await db.transaction(async (tx) => {
        const rowsOut = expenditureLedgerRows({ amount, candidateName, positionType });
        await tx.insert(transactions).values(rowsOut.txRow);
        await tx
          .update(campaigns)
          .set({ spent: sql`${campaigns.spent} + ${rowsOut.spentDelta}` })
          .where(eq(campaigns.id, row.id));
      });
      funds.set(row.id, {
        spentThisTick: amount,
        contributions: row.contributions ?? 0,
        spent: (row.spent ?? 0) + amount,
      });
      spendCount += 1;
      spendTotal += amount;
    } catch (err) {
      funds.set(row.id, { spentThisTick: 0, contributions: row.contributions ?? 0, spent: row.spent ?? 0 });
      console.warn(`[CAMPAIGN] Expenditure failed (campaign ${row.id}):`, err instanceof Error ? err.message : err);
    }
  }

  if (spendCount > 0) {
    console.warn(`[CAMPAIGN] ${spendCount} campaign(s) spent $${spendTotal.toLocaleString('en-US')} total`);
  }
  return funds;
}

/* ── Endorsements — public signals from the political establishment ──── */

/** Eligible endorser set for one race: (active officeholders ∪ party
    leaders) − race candidates − already-decided, id-sorted (deterministic
    ask order). Pure — exported for the set-math test. */
export function eligibleEndorsers(input: {
  officeholderIds: Iterable<string>;
  partyLeaderIds: Iterable<string>;
  candidateIds: Set<string>;
  decidedIds: Set<string>;
}): string[] {
  const pool = new Set<string>([...input.officeholderIds, ...input.partyLeaderIds]);
  return [...pool]
    .filter((id) => !input.candidateIds.has(id) && !input.decidedIds.has(id))
    .sort((a, b) => a.localeCompare(b));
}

export async function runEndorsements(opts: {
  elections: EngineElection[];
  campaigns: EngineCampaign[];
  activeAgents: EngineAgent[];
  platformByCampaignId: Map<string, string>;
  tickNumber: number;
  rc: Readonly<RuntimeConfig>;
  updateApproval: (agentId: string, delta: number, eventType: string, reason: string) => Promise<void>;
}): Promise<void> {
  const { elections: races, activeAgents, platformByCampaignId, tickNumber, rc } = opts;
  if (races.length === 0) return;

  const raceIds = races.map((e) => e.id);
  const agentById = new Map(activeAgents.map((a) => [a.id, a]));

  const [officeholderRows, leaderRows, existing] = await Promise.all([
    db
      .select({ agentId: positions.agentId, type: positions.type })
      .from(positions)
      .where(eq(positions.isActive, true)),
    db
      .select({ agentId: partyMemberships.agentId })
      .from(partyMemberships)
      .innerJoin(parties, eq(partyMemberships.partyId, parties.id))
      .where(and(eq(partyMemberships.role, 'leader'), eq(parties.isActive, true))),
    db
      .select({ electionId: campaignEndorsements.electionId, endorserAgentId: campaignEndorsements.endorserAgentId })
      .from(campaignEndorsements)
      .where(inArray(campaignEndorsements.electionId, raceIds)),
  ]);

  const officeholderIds = officeholderRows.filter((p) => officeRank(p.type) > 0).map((p) => p.agentId);
  const partyLeaderIds = leaderRows.map((r) => r.agentId);
  const decidedByElection = new Map<string, Set<string>>();
  for (const row of existing) {
    let set = decidedByElection.get(row.electionId);
    if (!set) { set = new Set(); decidedByElection.set(row.electionId, set); }
    set.add(row.endorserAgentId);
  }

  const asks: Array<{ election: EngineElection; endorser: EngineAgent; raceCampaigns: EngineCampaign[] }> = [];
  for (const election of [...races].sort((a, b) => a.id.localeCompare(b.id))) {
    const raceCampaigns = opts.campaigns.filter((c) => c.electionId === election.id && c.status === 'active');
    if (raceCampaigns.length === 0) continue;
    const eligible = eligibleEndorsers({
      officeholderIds,
      partyLeaderIds,
      candidateIds: new Set(raceCampaigns.map((c) => c.agentId)),
      decidedIds: decidedByElection.get(election.id) ?? new Set(),
    });
    for (const endorserId of eligible) {
      const endorser = agentById.get(endorserId);
      if (!endorser) continue;
      asks.push({ election, endorser, raceCampaigns });
      if (asks.length >= ENDORSE_ASKS_PER_TICK) break;
    }
    if (asks.length >= ENDORSE_ASKS_PER_TICK) break;
  }
  if (asks.length === 0) return;

  const results = await Promise.allSettled(
    asks.map(({ election, endorser, raceCampaigns }) => {
      const candidateBlock = raceCampaigns
        .map((c) => {
          const name = agentById.get(c.agentId)?.displayName ?? 'Unknown';
          const platform = (platformByCampaignId.get(c.id) ?? '').slice(0, 200);
          return `  - ${name} (id: ${c.agentId}): ${platform}`;
        })
        .join('\n');
      const contextMessage =
        `A ${election.positionType} election campaign is underway. Candidates:\n${candidateBlock}\n\n` +
        `As a public figure, you may publicly endorse one candidate — a visible signal voters will see — or stay neutral. ` +
        `Respond with: {"action":"endorsement","reasoning":"one sentence","data":{"endorse":true,"candidateId":"<chosen candidate id, or null to stay neutral>"}}`;
      return generateAgentDecision(agentRecord(endorser, rc), contextMessage, 'endorsement')
        .then((decision) => ({ election, endorser, raceCampaigns, decision }));
    }),
  );

  let endorsed = 0;
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('[CAMPAIGN] Endorsement call rejected (retry next tick):', result.reason);
      continue;
    }
    const { election, endorser, raceCampaigns, decision } = result.value;
    if (decision.action === 'idle' && decision.reasoning === 'api error') continue;

    let target: EngineCampaign | null = null;
    if (decision.action === 'endorsement') {
      const rawEndorse = decision.data?.['endorse'];
      const wants = rawEndorse === true || String(rawEndorse).toLowerCase() === 'true' || String(rawEndorse).toLowerCase() === 'yes';
      if (wants) {
        const candidateId = String(decision.data?.['candidateId'] ?? '');
        target = raceCampaigns.find((c) => c.agentId === candidateId) ?? null;
      }
    }

    if (!target) {
      /* Asked-and-neutral marker (campaignId NULL) — never re-asked. */
      await db
        .insert(campaignEndorsements)
        .values({ electionId: election.id, endorserAgentId: endorser.id, campaignId: null, tick: tickNumber })
        .onConflictDoNothing();
      continue;
    }

    const chosen = target;
    const candidateName = agentById.get(chosen.agentId)?.displayName ?? 'Unknown';
    try {
      let applied = false;
      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(campaignEndorsements)
          .values({ electionId: election.id, endorserAgentId: endorser.id, campaignId: chosen.id, tick: tickNumber })
          .onConflictDoNothing()
          .returning({ id: campaignEndorsements.id });
        if (inserted.length === 0) return; // lost a rerun race — already decided
        /* Write-through into the legacy JSON cache so the existing readers
           (boost multiplier, ElectionsPage, DossierDrawer, agentProfile)
           keep working with zero edits. Read-merge-write, never overwrite. */
        const [row] = await tx
          .select({ endorsements: campaigns.endorsements })
          .from(campaigns)
          .where(eq(campaigns.id, chosen.id))
          .limit(1);
        let list: string[] = [];
        try { list = JSON.parse(row?.endorsements ?? '[]') as string[]; } catch { list = []; }
        if (!list.includes(endorser.id)) {
          await tx
            .update(campaigns)
            .set({ endorsements: JSON.stringify([...list, endorser.id]) })
            .where(eq(campaigns.id, chosen.id));
        }
        applied = true;
      });
      if (!applied) continue;

      await db.insert(activityEvents).values({
        type: 'campaign_endorsement',
        agentId: endorser.id,
        title: 'Campaign endorsement',
        description: `${endorser.displayName} endorsed ${candidateName} for ${election.positionType}: ${decision.reasoning}`.slice(0, 1000),
        metadata: JSON.stringify({ electionId: election.id, campaignId: chosen.id, candidateId: chosen.agentId }),
      });
      await opts.updateApproval(chosen.agentId, 1, 'endorsement_received', `${candidateName} was endorsed by ${endorser.displayName}`);
      endorsed += 1;
    } catch (err) {
      console.warn(`[CAMPAIGN] Endorsement write failed (${endorser.id} -> ${chosen.id}):`, err instanceof Error ? err.message : err);
    }
  }
  if (endorsed > 0) console.warn(`[CAMPAIGN] ${endorsed} endorsement(s) recorded`);
}

/* ── Polls — honest snapshots from the real ballot's signal families ─── */

export async function snapshotPolls(opts: {
  activeAgents: EngineAgent[];
  tickNumber: number;
}): Promise<void> {
  const { activeAgents, tickNumber } = opts;

  const pollElections = await db
    .select({ id: elections.id, positionType: elections.positionType })
    .from(elections)
    .where(inArray(elections.status, ['campaigning', 'voting']));
  if (pollElections.length === 0) return;

  const campaignRows = await db
    .select({
      id: campaigns.id,
      electionId: campaigns.electionId,
      agentId: campaigns.agentId,
      spent: campaigns.spent,
    })
    .from(campaigns)
    .where(and(eq(campaigns.status, 'active'), inArray(campaigns.electionId, pollElections.map((e) => e.id))));
  if (campaignRows.length === 0) return;

  const agentIds = activeAgents.map((a) => a.id);
  const [partyRows, policyRows] = await Promise.all([
    db
      .select({ agentId: partyMemberships.agentId, partyId: partyMemberships.partyId })
      .from(partyMemberships)
      .where(inArray(partyMemberships.agentId, agentIds)),
    db
      .select({
        agentId: agentPolicyPositions.agentId,
        category: agentPolicyPositions.category,
        supportCount: agentPolicyPositions.supportCount,
        opposeCount: agentPolicyPositions.opposeCount,
      })
      .from(agentPolicyPositions)
      .where(inArray(agentPolicyPositions.agentId, agentIds)),
  ]);
  const partyByAgent = new Map(partyRows.map((r) => [r.agentId, r.partyId]));
  const policyByAgent = new Map<string, Record<string, number>>();
  for (const r of policyRows) {
    let vec = policyByAgent.get(r.agentId);
    if (!vec) { vec = {}; policyByAgent.set(r.agentId, vec); }
    vec[r.category] = r.supportCount - r.opposeCount;
  }

  const agentById = new Map(activeAgents.map((a) => [a.id, a]));

  for (const election of pollElections) {
    try {
      const raceCampaigns = campaignRows.filter((c) => c.electionId === election.id);
      if (raceCampaigns.length === 0) continue;
      const candidateIds = new Set(raceCampaigns.map((c) => c.agentId));

      /* Electorate = active agents minus the race's own candidates — the
         exact real-ballot eligibility set. */
      const voterAgents = activeAgents.filter((a) => !candidateIds.has(a.id));
      if (voterAgents.length === 0) continue;

      const alignmentRows = await db
        .select({
          agentId: agentRelationships.agentId,
          targetAgentId: agentRelationships.targetAgentId,
          voteAlignment: agentRelationships.voteAlignment,
        })
        .from(agentRelationships)
        .where(and(
          inArray(agentRelationships.agentId, voterAgents.map((v) => v.id)),
          inArray(agentRelationships.targetAgentId, [...candidateIds]),
        ));
      const alignmentMap = new Map<string, number>();
      for (const r of alignmentRows) alignmentMap.set(`${r.agentId}:${r.targetAgentId}`, r.voteAlignment);

      /* Debate glow: completed debates in this race won within the glow
         window — read from the events table, no in-memory carry. */
      const glowAgentIds = new Set<string>();
      const debateRows = await db
        .select({ outcome: governmentEvents.outcome, scheduledTick: governmentEvents.scheduledTick })
        .from(governmentEvents)
        .where(and(
          eq(governmentEvents.type, 'campaign_debate'),
          eq(governmentEvents.status, 'completed'),
          eq(governmentEvents.relatedElectionId, election.id),
        ));
      for (const d of debateRows) {
        if (d.scheduledTick == null || tickNumber - d.scheduledTick > DEBATE_GLOW_TICKS) continue;
        try {
          const outcome = JSON.parse(d.outcome ?? '{}') as { winnerAgentId?: string };
          if (outcome.winnerAgentId) glowAgentIds.add(outcome.winnerAgentId);
        } catch { /* malformed outcome — no glow */ }
      }

      const voters: PollVoter[] = voterAgents.map((v) => ({
        id: v.id,
        partyId: partyByAgent.get(v.id) ?? null,
        policyVector: policyByAgent.get(v.id) ?? {},
      }));
      const candidates: PollCandidate[] = raceCampaigns.map((c) => ({
        campaignId: c.id,
        agentId: c.agentId,
        approvalRating: agentById.get(c.agentId)?.approvalRating ?? 50,
        partyId: partyByAgent.get(c.agentId) ?? null,
        policyVector: policyByAgent.get(c.agentId) ?? {},
        spent: c.spent ?? 0,
        debateGlow: glowAgentIds.has(c.agentId),
      }));

      const snapshot = computePollSnapshot(election.id, tickNumber, voters, candidates, alignmentMap);
      if (snapshot.sampleSize === 0) continue;

      /* UNIQUE(election, tick) + do-nothing = crash-rerun safe. */
      await db
        .insert(electionPolls)
        .values({
          electionId: election.id,
          tick: tickNumber,
          results: snapshot.results,
          undecidedPct: snapshot.undecidedPct,
          sampleSize: snapshot.sampleSize,
        })
        .onConflictDoNothing();

      broadcast('election:poll', {
        electionId: election.id,
        tick: tickNumber,
        results: snapshot.results,
        undecidedPct: snapshot.undecidedPct,
        sampleSize: snapshot.sampleSize,
      });
    } catch (err) {
      console.warn(`[CAMPAIGN] Poll snapshot failed (election ${election.id}):`, err instanceof Error ? err.message : err);
    }
  }
}

/* ── Debates — scheduled at the campaigning transition, fired on ticks ── */

/** Called once at registration -> campaigning. Tick-anchored rows only
    (legacy wall-clock elections get no debates); scheduledAt is a display
    estimate, scheduled_tick is authoritative (judicial convention). */
export async function scheduleDebates(opts: {
  election: { id: string; positionType: string; votingStartTick: number | null };
  tickNumber: number;
  rc: Readonly<RuntimeConfig>;
}): Promise<void> {
  const { election, tickNumber, rc } = opts;
  if (rc.campaignDebateCount <= 0 || election.votingStartTick == null) return;
  const ticks = debateTicksFor(tickNumber, election.votingStartTick, rc.campaignDebateCount);
  if (ticks.length === 0) return;
  await db.insert(governmentEvents).values(
    ticks.map((debateTick, i) => ({
      type: 'campaign_debate',
      title: `Campaign Debate ${ticks.length > 1 ? `${i + 1} of ${ticks.length} ` : ''}(${election.positionType} race)`.slice(0, 200),
      description: `The leading candidates for ${election.positionType} meet on the debate stage.`,
      scheduledAt: new Date(Date.now() + (debateTick - tickNumber) * rc.tickIntervalMs),
      durationMinutes: 90,
      attendeeIds: '[]',
      status: 'scheduled',
      relatedElectionId: election.id,
      scheduledTick: debateTick,
      isPublic: true,
    })),
  );
  console.warn(`[CAMPAIGN] ${ticks.length} debate(s) scheduled for ${election.positionType} race (ticks ${ticks.join(', ')})`);
}

/** Called at campaigning -> voting: unfired debates cancel (judicial
    cancel precedent). Unconditional — leftovers cancel even if the owner
    zeroed the debate dial mid-cycle. */
export async function cancelPendingDebates(opts: { electionId: string }): Promise<void> {
  await db
    .update(governmentEvents)
    .set({ status: 'cancelled', outcome: 'Campaign window closed before this debate fired.' })
    .where(and(
      eq(governmentEvents.type, 'campaign_debate'),
      eq(governmentEvents.relatedElectionId, opts.electionId),
      eq(governmentEvents.status, 'scheduled'),
    ));
}

/** Fires debates whose scheduled_tick has arrived: top-K participants by
    latest poll -> contributions -> registration order; one LLM statement
    each; deterministic audience reception decides the winner (+2 approval,
    losses 0 — negatives are reserved for vetoes). */
export async function runDueDebates(opts: {
  elections: EngineElection[];
  activeAgents: EngineAgent[];
  tickNumber: number;
  rc: Readonly<RuntimeConfig>;
  updateApproval: (agentId: string, delta: number, eventType: string, reason: string) => Promise<void>;
}): Promise<void> {
  const { elections: races, activeAgents, tickNumber, rc } = opts;
  if (races.length === 0) return;

  const due = await db
    .select()
    .from(governmentEvents)
    .where(and(
      eq(governmentEvents.type, 'campaign_debate'),
      eq(governmentEvents.status, 'scheduled'),
      sql`${governmentEvents.scheduledTick} <= ${tickNumber}`,
      inArray(governmentEvents.relatedElectionId, races.map((e) => e.id)),
    ));
  if (due.length === 0) return;

  const agentById = new Map(activeAgents.map((a) => [a.id, a]));

  for (const event of due) {
    try {
      const election = races.find((e) => e.id === event.relatedElectionId)!;
      const raceCampaigns = await db
        .select({
          id: campaigns.id,
          agentId: campaigns.agentId,
          platform: campaigns.platform,
          contributions: campaigns.contributions,
          startDate: campaigns.startDate,
        })
        .from(campaigns)
        .where(and(eq(campaigns.electionId, election.id), eq(campaigns.status, 'active')));

      if (raceCampaigns.length === 0) {
        await cancelPendingDebates({ electionId: election.id });
        continue;
      }

      /* Stage selection: latest poll share -> contributions -> registration
         order. Reception ties break by registration order, so the chosen K
         are re-sorted into registration order before reception. */
      const [latestPollRow] = await db
        .select({ results: electionPolls.results })
        .from(electionPolls)
        .where(eq(electionPolls.electionId, election.id))
        .orderBy(sql`${electionPolls.tick} DESC`)
        .limit(1);
      const pollShareByCampaign = new Map(Object.entries(latestPollRow?.results ?? {}));
      const regOrder = orderCandidates(raceCampaigns.map((c) => ({
        agentId: c.agentId,
        totalContributions: c.contributions ?? 0,
        startDate: c.startDate,
        campaignId: c.id,
      })));
      const regRank = new Map(regOrder.map((id, i) => [id, i]));
      const stage = [...raceCampaigns]
        .sort((a, b) => {
          const poll = (pollShareByCampaign.get(b.id) ?? -1) - (pollShareByCampaign.get(a.id) ?? -1);
          if (poll !== 0) return poll;
          const contrib = (b.contributions ?? 0) - (a.contributions ?? 0);
          if (contrib !== 0) return contrib;
          return (regRank.get(a.agentId) ?? Infinity) - (regRank.get(b.agentId) ?? Infinity);
        })
        .slice(0, Math.max(2, rc.debateParticipants))
        .sort((a, b) => (regRank.get(a.agentId) ?? Infinity) - (regRank.get(b.agentId) ?? Infinity));

      const participants = stage.filter((c) => agentById.has(c.agentId));
      if (participants.length < 2) {
        /* A one-candidate stage is no debate — cancel this event only. */
        await db
          .update(governmentEvents)
          .set({ status: 'cancelled', outcome: 'Fewer than two candidates available to debate.' })
          .where(eq(governmentEvents.id, event.id));
        continue;
      }

      /* Electorate-average voteAlignment per participant (0.5 default). */
      const participantIds = participants.map((p) => p.agentId);
      const candidateIdSet = new Set(raceCampaigns.map((c) => c.agentId));
      const electorateIds = activeAgents.filter((a) => !candidateIdSet.has(a.id)).map((a) => a.id);
      const avgByAgent = new Map<string, number>(participantIds.map((id) => [id, 0.5]));
      if (electorateIds.length > 0) {
        const rows = await db
          .select({
            targetAgentId: agentRelationships.targetAgentId,
            avg: sql<number>`avg(${agentRelationships.voteAlignment})`,
          })
          .from(agentRelationships)
          .where(and(
            inArray(agentRelationships.agentId, electorateIds),
            inArray(agentRelationships.targetAgentId, participantIds),
          ))
          .groupBy(agentRelationships.targetAgentId);
        for (const r of rows) avgByAgent.set(r.targetAgentId, Number(r.avg));
      }

      /* One statement per participant — rivals' platforms + own standing. */
      const statementResults = await Promise.allSettled(
        participants.map((p) => {
          const agent = agentById.get(p.agentId)!;
          const rivals = participants
            .filter((r) => r.agentId !== p.agentId)
            .map((r) => `  - ${agentById.get(r.agentId)?.displayName ?? 'Unknown'}: ${(r.platform ?? '').slice(0, 200)}`)
            .join('\n');
          const ownShare = pollShareByCampaign.get(p.id);
          const standing = ownShare !== undefined ? ` You stand at ${ownShare}% in the latest poll.` : '';
          const contextMessage =
            `You are on the debate stage for the ${election.positionType} election.${standing} Your rivals:\n${rivals}\n\n` +
            `Deliver your sharpest debate statement — contrast your platform with theirs. ` +
            `Respond with: {"action":"debate_statement","reasoning":"your one-line debate statement"}`;
          return generateAgentDecision(agentRecord(agent, rc), contextMessage, 'campaign_debate')
            .then((decision) => ({ participant: p, decision }));
        }),
      );

      /* Deterministic reception — physics decides, not the LLM. */
      const receptionInput: DebateParticipantInput[] = participants.map((p) => ({
        agentId: p.agentId,
        avgAlignment: avgByAgent.get(p.agentId) ?? 0.5,
      }));
      const reception = debateReception(receptionInput, campaignRng(tickNumber, event.id, 'debate'))!;
      const winnerName = agentById.get(reception.winnerAgentId)?.displayName ?? 'Unknown';

      for (const result of statementResults) {
        if (result.status === 'rejected') {
          console.warn('[CAMPAIGN] Debate statement call rejected:', result.reason);
          continue;
        }
        const { participant, decision } = result.value;
        if (decision.action !== 'debate_statement' || !decision.reasoning) continue;
        await db.insert(agentStatements).values({
          agentId: participant.agentId,
          statementText: decision.reasoning.slice(0, 2000),
          triggerType: 'debate',
          triggerElectionId: election.id,
          approvalDelta: participant.agentId === reception.winnerAgentId ? DEBATE_WIN_APPROVAL : 0,
          isPublic: true,
        });
      }

      await db
        .update(governmentEvents)
        .set({
          status: 'completed',
          scheduledAt: new Date(),
          attendeeIds: JSON.stringify(participantIds),
          outcome: JSON.stringify({ winnerAgentId: reception.winnerAgentId, sharesByAgent: reception.sharesByAgent }),
        })
        .where(eq(governmentEvents.id, event.id));

      await db.insert(activityEvents).values({
        type: 'campaign_debate',
        agentId: reception.winnerAgentId,
        title: 'Campaign debate',
        description: `${participants.map((p) => agentById.get(p.agentId)?.displayName ?? 'Unknown').join(', ')} debated in the ${election.positionType} race — ${winnerName} won the exchange`,
        metadata: JSON.stringify({ electionId: election.id, eventId: event.id, winnerAgentId: reception.winnerAgentId, sharesByAgent: reception.sharesByAgent }),
      });

      broadcast('campaign:debate', {
        electionId: election.id,
        eventId: event.id,
        participants: participantIds,
        winnerAgentId: reception.winnerAgentId,
        sharesByAgent: reception.sharesByAgent,
      });

      await opts.updateApproval(reception.winnerAgentId, DEBATE_WIN_APPROVAL, 'debate_win', `${winnerName} won the ${election.positionType} campaign debate`);
      console.warn(`[CAMPAIGN] Debate fired (${election.positionType}): ${winnerName} won`);
    } catch (err) {
      console.warn(`[CAMPAIGN] Debate failed (event ${event.id}):`, err instanceof Error ? err.message : err);
    }
  }
}
