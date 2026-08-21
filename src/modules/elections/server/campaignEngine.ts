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
  campaigns,
  transactions,
  agentRelationships,
  campaignDonations,
  donationStances,
} from '@db/schema/index';
import { generateAgentDecision } from '@core/server/services/ai.js';
import type { RuntimeConfig } from '@core/server/runtimeConfig';
import {
  campaignRng,
  donationAmount,
  spendAmount,
  STANCE_ASKS_PER_TICK,
  type Generosity,
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
