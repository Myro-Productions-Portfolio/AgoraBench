import { config } from '../config.js';
import { db } from '@db/connection';
import { agentDecisions, apiProviders, userApiKeys, agents, forumThreads, agentMessages, elections, campaigns, bills, laws, agentMemorySummaries, agentRelationships, agentPolicyPositions, governmentSettings, agentDeals, agentStatements, activityEvents, gazetteIssues, tickLog } from '@db/schema/index';
import { eq, and, or, desc, gt, inArray, sql } from 'drizzle-orm';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { HfInference } from '@huggingface/inference';
import { decryptText } from '../lib/crypto.js';
import { getRuntimeConfig } from '../runtimeConfig.js';
import { buildCongressContextBlock } from '@modules/government/server/services/congressContext.js';
import { mandatoryEffectiveAmount, tickInterest } from '../lib/fiscalMath.js';

export interface AgentRecord {
  id: string;
  displayName: string;
  alignment: string | null;
  modelProvider: string | null;
  personality: string | null;
  personalityMod?: string | null;
  model?: string | null;
  temperature?: string | null;
  ownerUserId?: string | null;
  bio?: string | null;
  approvalRating?: number | null;
}

export interface AgentDecision {
  action: string;
  reasoning: string;
  data?: Record<string, unknown>;
}

// Short-term memory cache: agentId → { block: string; ts: number }
const memoryCache = new Map<string, { block: string; ts: number }>();
const MEMORY_TTL_MS = 60_000; // 1 minute — one per tick window per agent
const MEMORY_DEPTH = 25; // last N successful decisions

// Canonical action expected for each simulation phase
const PHASE_ACTION_MAP: Record<string, string> = {
  whip_signal:         'whip_signal',
  bill_voting:         'vote',
  committee_review:    'committee_review',
  presidential_review: 'presidential_review',
  veto_override:       'override_vote',
  judicial_review:     'judicial_vote',
  bill_proposal:       'propose',
  campaigning:         'campaign_speech',
  forum_post:          'forum_post',
  forum_reply:         'forum_reply',
  lobby:               'lobby',
  propose_amendment:   'propose_amendment',
  bill_withdrawal:     'bill_withdrawal',
  public_statement:    'public_statement',
  /* E3 slice A: election ballot casting */
  election_voting:     'election_vote',
  /* Phase 4 judicial arc */
  court_filing:        'file_case',
  oral_argument:       'present_argument',
  justice_question:    'ask_question',
  court_opinion:       'write_opinion',
};

// Known aliases that Ollama and other models hallucinate for each canonical action
const ACTION_ALIASES: Record<string, string[]> = {
  vote: [
    'yea', 'nay', 'aye', 'vote_yea', 'vote_nay', 'vote_yes', 'vote_no',
    'cast_vote', 'ballot', 'support', 'oppose', 'motion', 'follow',
    // Ollama hallucinations observed in logs
    'voting', 'veto', 'veto_recommendation', 'opposition', 'voting_record',
    'analyze', 'ask_questions', 'ask_for_detail',
    'follow_party_recommendation', 'independent_decision', 'independent_voting',
    // "propose" returned when model confuses voting context with proposal context
    'propose',
  ],
  propose: [
    'propose_bill', 'propose_legislation', 'submit_proposal', 'introduce_bill',
    'submit_bill', 'create_bill', 'draft_bill', 'new_bill', 'introduce',
    'proposal', 'legislation', 'bill',
  ],
  whip_signal: [
    'whip', 'signal', 'send_signal', 'party_signal', 'party_whip',
    'directive', 'issue_signal', 'recommend',
  ],
  committee_review: [
    'review', 'committee_action', 'chair_decision', 'committee_decision',
    'chair_review', 'approve', 'table', 'amend',
  ],
  presidential_review: [
    'review', 'executive_action', 'sign', 'veto', 'sign_bill',
    'presidential_action', 'executive_review', 'presidential_decision',
  ],
  override_vote: [
    'override', 'veto_override', 'override_decision', 'sustain', 'veto_vote', 'override_veto',
  ],
  judicial_vote: [
    'constitutional', 'unconstitutional', 'judicial_decision', 'constitutional_review',
    'ruling', 'judicial_ruling',
  ],
  campaign_speech: [
    'speech', 'campaign', 'rally', 'address', 'statement', 'campaign_statement',
    'campaign_action', 'public_statement',
  ],
  forum_post: [
    'post', 'forum', 'write', 'discuss', 'thread', 'forum_thread', 'post_message',
  ],
  forum_reply: [
    'reply', 'respond', 'forum_response', 'comment', 'thread_reply', 'post_reply', 'write_reply', 'add_comment',
  ],
  lobby: [
    'lobbying', 'persuade', 'appeal', 'advocate', 'negotiate',
    'make_argument', 'argue', 'approach', 'convince',
  ],
  propose_amendment: [
    'amendment', 'amend', 'floor_amendment', 'modify_bill',
    'change_bill', 'revise_bill', 'propose_change',
  ],
  bill_withdrawal: [
    'withdraw', 'withdraw_bill', 'pull_bill', 'retract',
    'revise_and_reintroduce', 'table_bill',
  ],
  public_statement: [
    'statement', 'press_statement', 'press_release', 'announce',
    'address', 'public_address', 'respond', 'issue_statement',
  ],
  /* E3 slice A: election ballot casting */
  election_vote: [
    'vote', 'cast_vote', 'cast_ballot', 'ballot', 'ballot_vote', 'elect',
    'vote_for', 'select_candidate', 'choose_candidate', 'endorse',
  ],
  /* Phase 4 judicial arc */
  file_case: [
    'file_lawsuit', 'file', 'lawsuit', 'file_suit', 'sue', 'petition',
    'file_petition', 'challenge', 'file_challenge', 'complaint', 'file_complaint',
  ],
  present_argument: [
    'argument', 'argue', 'oral_argument', 'present', 'make_argument',
    'plead', 'opening_statement', 'closing_argument', 'statement',
  ],
  ask_question: [
    'question', 'ask', 'justice_question', 'ask_questions', 'inquire', 'query', 'questioning',
  ],
  write_opinion: [
    'opinion', 'ruling', 'write_ruling', 'majority_opinion', 'dissent',
    'dissent_opinion', 'draft_opinion', 'author_opinion', 'decision', 'write_decision',
  ],
};

function normalizeAction(rawAction: unknown, expectedAction: string): string | null {
  if (typeof rawAction !== 'string') return null;
  const normalized = rawAction.toLowerCase().replace(/[\s\-]+/g, '_').trim();
  if (normalized === expectedAction) return expectedAction;
  const aliases = ACTION_ALIASES[expectedAction] ?? [];
  if (aliases.includes(normalized)) return expectedAction;
  // Partial match: raw contains expected name
  if (normalized.includes(expectedAction)) return expectedAction;
  return null;
}

function sanitizeJsonString(raw: string): string {
  let s = raw;
  s = s.replace(/\*\*/g, '');                           // strip markdown bold markers
  s = s.replace(/""(\w+)":/g, '"$1":');                 // fix ""key": → "key":
  s = s.replace(/,(\s*[}\]])/g, '$1');                  // fix trailing commas before } or ]
  s = s.replace(/([{,]\s*)data(\s*:)/g, '$1"data"$2');  // fix unquoted "data" key
  return s;
}

function tryPartialRecovery(raw: string): AgentDecision | null {
  const actionMatch = raw.match(/"action"\s*:\s*"([^"]+)"/);
  if (!actionMatch) return null;
  const reasoningMatch = raw.match(/"reasoning"\s*:\s*"([^"]*)"/);
  const choiceMatch = raw.match(/"choice"\s*:\s*"([^"]+)"/);
  return {
    action: actionMatch[1],
    reasoning: reasoningMatch?.[1] ?? 'partial recovery',
    ...(choiceMatch ? { data: { choice: choiceMatch[1] } } : {}),
  };
}

async function buildMemoryBlock(agentId: string): Promise<string> {
  const cached = memoryCache.get(agentId);
  if (cached && Date.now() - cached.ts < MEMORY_TTL_MS) return cached.block;

  /* Fetch latest summary */
  const [latestSummary] = await db
    .select({ summary: agentMemorySummaries.summary })
    .from(agentMemorySummaries)
    .where(eq(agentMemorySummaries.agentId, agentId))
    .orderBy(desc(agentMemorySummaries.createdAt))
    .limit(1);

  /* Fetch last 5 raw decisions (most recent, for detail) */
  const rows = await db
    .select({
      phase: agentDecisions.phase,
      parsedAction: agentDecisions.parsedAction,
      parsedReasoning: agentDecisions.parsedReasoning,
      createdAt: agentDecisions.createdAt,
    })
    .from(agentDecisions)
    .where(and(eq(agentDecisions.agentId, agentId), eq(agentDecisions.success, true)))
    .orderBy(desc(agentDecisions.createdAt))
    .limit(5);

  const parts: string[] = [];

  if (latestSummary?.summary) {
    parts.push(`Summary of earlier decisions: ${latestSummary.summary}`);
  }

  if (rows.length > 0) {
    const lines = rows.reverse().map((r) => {
      const when = r.createdAt
        ? new Date(r.createdAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
        : 'unknown time';
      const phase = r.phase ?? 'general';
      const action = r.parsedAction ?? 'idle';
      const reasoning = (r.parsedReasoning ?? '').slice(0, 120);
      return `- [${when}] phase=${phase} action=${action}: "${reasoning}"`;
    });
    parts.push(lines.join('\n'));
  }

  const block = parts.join('\n\n');
  memoryCache.set(agentId, { block, ts: Date.now() });
  return block;
}

// Forum context cache: shared across all agents, 5-minute TTL
let forumContextCache: { block: string; ts: number } | null = null;
const FORUM_CONTEXT_TTL_MS = 5 * 60_000;
const FORUM_THREAD_DEPTH = 5; // most recently active threads
const FORUM_POST_DEPTH = 2;   // most recent posts per thread

async function buildForumContextBlock(): Promise<string> {
  if (forumContextCache && Date.now() - forumContextCache.ts < FORUM_CONTEXT_TTL_MS) {
    return forumContextCache.block;
  }

  const now = new Date();

  /* Most recently active threads that haven't expired */
  const threads = await db
    .select({
      id: forumThreads.id,
      title: forumThreads.title,
      category: forumThreads.category,
      replyCount: forumThreads.replyCount,
    })
    .from(forumThreads)
    .where(gt(forumThreads.expiresAt, now))
    .orderBy(desc(forumThreads.lastActivityAt))
    .limit(FORUM_THREAD_DEPTH);

  if (threads.length === 0) {
    forumContextCache = { block: '', ts: Date.now() };
    return '';
  }

  /* For each thread, fetch the most recent posts with author names */
  const threadBlocks: string[] = [];

  for (const thread of threads) {
    const posts = await db
      .select({
        body: agentMessages.body,
        authorName: agents.displayName,
        createdAt: agentMessages.createdAt,
      })
      .from(agentMessages)
      .innerJoin(agents, eq(agentMessages.fromAgentId, agents.id))
      .where(and(eq(agentMessages.threadId, thread.id), eq(agentMessages.isPublic, true)))
      .orderBy(desc(agentMessages.createdAt))
      .limit(FORUM_POST_DEPTH);

    const postLines = posts
      .reverse()
      .map((p) => {
        const snippet = (p.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 150);
        return `  ${p.authorName}: "${snippet}"`;
      });

    const header = `[${thread.category.toUpperCase()}] "${thread.title}" (${thread.replyCount} replies)`;
    threadBlocks.push(postLines.length > 0 ? `${header}\n${postLines.join('\n')}` : header);
  }

  const block = threadBlocks.join('\n\n');
  forumContextCache = { block, ts: Date.now() };
  return block;
}

async function buildRelationshipBlock(agentId: string): Promise<string> {
  const relationships = await db
    .select({
      targetAgentId: agentRelationships.targetAgentId,
      voteAlignment: agentRelationships.voteAlignment,
      targetName: agents.displayName,
    })
    .from(agentRelationships)
    .innerJoin(agents, eq(agentRelationships.targetAgentId, agents.id))
    .where(eq(agentRelationships.agentId, agentId))
    .orderBy(desc(agentRelationships.voteAlignment));

  if (relationships.length === 0) return '';

  const allies = relationships.slice(0, 3);
  const opponents = relationships.slice(-3).reverse();

  const allyLines = allies
    .filter((r) => r.voteAlignment > 0.5)
    .map((r) => `  ${r.targetName}: ${Math.round(r.voteAlignment * 100)}% vote alignment`);

  const opponentLines = opponents
    .filter((r) => r.voteAlignment < 0.5)
    .map((r) => `  ${r.targetName}: ${Math.round(r.voteAlignment * 100)}% vote alignment`);

  const parts: string[] = [];
  if (allyLines.length > 0) parts.push(`Allies:\n${allyLines.join('\n')}`);
  if (opponentLines.length > 0) parts.push(`Opponents:\n${opponentLines.join('\n')}`);
  return parts.join('\n');
}

async function buildPolicyPositionBlock(agentId: string): Promise<string> {
  const positions = await db
    .select()
    .from(agentPolicyPositions)
    .where(eq(agentPolicyPositions.agentId, agentId))
    .orderBy(desc(sql`${agentPolicyPositions.supportCount} + ${agentPolicyPositions.opposeCount}`))
    .limit(5);

  if (positions.length === 0) return '';

  const lines = positions.map((p) => {
    const total = p.supportCount + p.opposeCount;
    if (total === 0) return null;
    const stance = p.supportCount > p.opposeCount ? 'supported' : 'opposed';
    const majority = Math.max(p.supportCount, p.opposeCount);
    return `  ${p.category}: ${stance} ${majority}/${total} bills`;
  }).filter(Boolean);

  return lines.length > 0 ? `Your voting record by policy area:\n${lines.join('\n')}` : '';
}

async function buildElectionMemoryBlock(agentId: string): Promise<string> {
  const pastElections = await db
    .select({
      positionType: elections.positionType,
      winnerId: elections.winnerId,
      winnerName: agents.displayName,
      certifiedDate: elections.certifiedDate,
    })
    .from(elections)
    .leftJoin(agents, eq(elections.winnerId, agents.id))
    .innerJoin(campaigns, and(eq(campaigns.electionId, elections.id), eq(campaigns.agentId, agentId)))
    .where(eq(elections.status, 'certified'))
    .orderBy(desc(elections.certifiedDate))
    .limit(3);

  if (pastElections.length === 0) return '';

  const lines = pastElections.map((e) => {
    const won = e.winnerId === agentId;
    return won
      ? `  Won ${e.positionType} election`
      : `  Lost ${e.positionType} election to ${e.winnerName ?? 'unknown'}`;
  });

  return `Election history:\n${lines.join('\n')}`;
}

const TREASURY_SEED_VALUE = 1_500_000_000_000;

export async function buildEconomyContextBlock(
  agentId: string,
): Promise<string> {
  try {
    const [govSettings] = await db
      .select({ treasuryBalance: governmentSettings.treasuryBalance, taxRatePercent: governmentSettings.taxRatePercent, debtOutstanding: governmentSettings.debtOutstanding })
      .from(governmentSettings)
      .limit(1);
    const [agentRow] = await db
      .select({ balance: agents.balance })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (!govSettings) return '';

    const treasury = govSettings.treasuryBalance ?? TREASURY_SEED_VALUE;
    const ratio = treasury / TREASURY_SEED_VALUE;
    const healthLabel = ratio < 0.2 ? 'CRITICAL' : ratio < 0.5 ? 'strained' : ratio > 1.5 ? 'surplus' : 'healthy';
    const taxRate = govSettings.taxRatePercent ?? 18;
    const balance = agentRow?.balance ?? 0;

    /* Divergence E1 slice 1: debt outstanding, daily interest, mandatory
       total/day, and the amend-mandatory allowance — only when the debt
       engine is on. Agents cannot govern what they cannot see (spec), but
       this must never slow down or break the base economy block when the
       engine is off (the common case pre-T0), so it's a fully separate
       try/catch appended to the existing return, not a restructure. */
    let debtLine = '';
    const rc = getRuntimeConfig();
    if (rc.debtEngineEnabled) {
      try {
        const [tickCountRow] = await db
          .select({ completed: sql<number>`COUNT(*) FILTER (WHERE ${tickLog.completedAt} IS NOT NULL)` })
          .from(tickLog);
        const currentTickNumber = Number(tickCountRow?.completed ?? 0) + 1;

        const mandatoryRows = await db
          .select({ fiscalAmount: laws.fiscalAmount, enactedTick: laws.enactedTick })
          .from(laws)
          .where(and(eq(laws.isActive, true), eq(laws.fiscalKind, 'mandatory')));
        const mandatoryTotal = mandatoryRows.reduce((sum, r) => {
          if (typeof r.fiscalAmount !== 'number' || typeof r.enactedTick !== 'number') return sum;
          return sum + mandatoryEffectiveAmount(r.fiscalAmount, r.enactedTick, currentTickNumber, rc.mandatoryGrowthPctAnnual);
        }, 0);

        const debtOutstanding = govSettings.debtOutstanding ?? 0;
        const dailyInterest = tickInterest(debtOutstanding, rc.debtInterestRatePct);

        debtLine =
          `\nNational debt: $${debtOutstanding.toLocaleString()} outstanding, $${dailyInterest.toLocaleString()}/day interest. ` +
          `Mandatory spending: $${mandatoryTotal.toLocaleString()}/day (automatic, never lapses). ` +
          `You may amend an existing mandatory law's funding by up to ±${rc.fiscalMaxMandatoryDeltaPct}% — you cannot create new mandatory programs.`;
      } catch {
        debtLine = '';
      }
    }

    return `## Economic Context\nTreasury: $${treasury.toLocaleString()} (${healthLabel}) | Tax rate: ${taxRate}% | Your balance: $${balance.toLocaleString()}\nAll fiscal amounts are in US dollars; bills appropriate at national scale ($500M–$700B).${debtLine}`;
  } catch {
    return '';
  }
}

export async function buildActiveDealsBlock(agentId: string): Promise<string> {
  const rows = await db
    .select({
      id: agentDeals.id,
      initiatorId: agentDeals.initiatorId,
      targetId: agentDeals.targetId,
      initiatorCommitment: agentDeals.initiatorCommitment,
      targetCommitment: agentDeals.targetCommitment,
      expiresAt: agentDeals.expiresAt,
    })
    .from(agentDeals)
    .where(
      and(
        or(
          eq(agentDeals.initiatorId, agentId),
          eq(agentDeals.targetId, agentId),
        ),
        eq(agentDeals.status, 'accepted'),
        gt(agentDeals.expiresAt, new Date()),
      )
    )
    .limit(5);

  if (rows.length === 0) return '';

  const lines = rows.map((d) => {
    const isInitiator = d.initiatorId === agentId;
    const myCommitment = isInitiator ? d.initiatorCommitment : d.targetCommitment;
    return `  - You committed: "${myCommitment}"`;
  });

  return [
    '## Active Vote Commitments',
    'You have made the following commitments. Breaking them will damage your relationships and reputation:',
    ...lines,
  ].join('\n');
}

// Recent news cache: shared across all agents, 60s TTL (~1 query set per tick)
let recentNewsCache: { block: string; ts: number } | null = null;
const RECENT_NEWS_TTL_MS = 60_000;
const NEWS_ITEM_MAX_CHARS = 140; // hard cap per line — 3 lines ≈ 400 chars total
const NEWS_MAX_ITEMS = 3;

/**
 * Small "Recent News" block for agent prompts: latest public statements,
 * Bob's injected media_event rows, and the latest Gazette headline — merged
 * by recency, capped at 3 lines of 140 chars. This is the wire that finally
 * delivers orchestrator media events to agents.
 */
export async function buildRecentNewsBlock(): Promise<string> {
  if (recentNewsCache && Date.now() - recentNewsCache.ts < RECENT_NEWS_TTL_MS) {
    return recentNewsCache.block;
  }

  const [statements, mediaEvents, gazetteRows] = await Promise.all([
    db.select({
        statementText: agentStatements.statementText,
        authorName: agents.displayName,
        createdAt: agentStatements.createdAt,
      })
      .from(agentStatements)
      .innerJoin(agents, eq(agentStatements.agentId, agents.id))
      .where(eq(agentStatements.isPublic, true))
      .orderBy(desc(agentStatements.createdAt))
      .limit(2),
    db.select({
        title: activityEvents.title,
        description: activityEvents.description,
        createdAt: activityEvents.createdAt,
      })
      .from(activityEvents)
      .where(eq(activityEvents.type, 'media_event'))
      .orderBy(desc(activityEvents.createdAt))
      .limit(2),
    /* Individually failure-soft: gazette_issues may not exist yet on a mid-life DB */
    db.select({ headline: gazetteIssues.headline, createdAt: gazetteIssues.createdAt })
      .from(gazetteIssues)
      .orderBy(desc(gazetteIssues.createdAt))
      .limit(1)
      .catch(() => [] as { headline: string; createdAt: Date }[]),
  ]);

  const items: { line: string; createdAt: Date }[] = [];

  for (const s of statements) {
    const text = (s.statementText ?? '').replace(/\s+/g, ' ').trim();
    items.push({
      line: `- Statement (${s.authorName}): ${text}`.slice(0, NEWS_ITEM_MAX_CHARS),
      createdAt: s.createdAt,
    });
  }
  for (const e of mediaEvents) {
    const text = `${e.title} — ${e.description}`.replace(/\s+/g, ' ').trim();
    items.push({
      line: `- News: ${text}`.slice(0, NEWS_ITEM_MAX_CHARS),
      createdAt: e.createdAt,
    });
  }
  for (const g of gazetteRows) {
    items.push({
      line: `- Gazette: ${g.headline}`.slice(0, NEWS_ITEM_MAX_CHARS),
      createdAt: g.createdAt,
    });
  }

  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const block = items.slice(0, NEWS_MAX_ITEMS).map((i) => i.line).join('\n');

  recentNewsCache = { block, ts: Date.now() };
  return block;
}

// Simulation state cache: shared, 10-minute TTL (one per tick window is fine)
let simStateCache: { block: string; threadTitles: string[]; ts: number } | null = null;
const SIM_STATE_TTL_MS = 10 * 60_000;

export interface SimulationState {
  block: string;          // formatted context block for injection into prompts
  threadTitles: string[]; // recent thread titles for deduplication guidance
}

export async function buildSimulationStateBlock(): Promise<SimulationState> {
  if (simStateCache && Date.now() - simStateCache.ts < SIM_STATE_TTL_MS) {
    return { block: simStateCache.block, threadTitles: simStateCache.threadTitles };
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [activeBills, recentLaws, recentElections, recentThreads] = await Promise.all([
    // Active bills not yet resolved
    db.select({ title: bills.title, status: bills.status, committee: bills.committee })
      .from(bills)
      .where(inArray(bills.status, ['proposed', 'committee', 'floor', 'passed', 'presidential_veto']))
      .orderBy(desc(bills.introducedAt))
      .limit(5),

    // Laws enacted in the last 30 days
    db.select({ title: laws.title, enactedDate: laws.enactedDate, isActive: laws.isActive })
      .from(laws)
      .where(gt(laws.enactedDate, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)))
      .orderBy(desc(laws.enactedDate))
      .limit(4),

    // Recent or active elections
    db.select({ positionType: elections.positionType, status: elections.status, certifiedDate: elections.certifiedDate })
      .from(elections)
      .where(gt(elections.scheduledDate, new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)))
      .orderBy(desc(elections.scheduledDate))
      .limit(3),

    // Recent thread titles for topic deduplication
    db.select({ title: forumThreads.title })
      .from(forumThreads)
      .where(gt(forumThreads.createdAt, sevenDaysAgo))
      .orderBy(desc(forumThreads.createdAt))
      .limit(20),
  ]);

  const lines: string[] = [];

  if (activeBills.length > 0) {
    lines.push('Active legislation:');
    for (const b of activeBills) {
      const committee = b.committee ? ` [${b.committee}]` : '';
      lines.push(`  - "${b.title}" — status: ${b.status}${committee}`);
    }
  }

  if (recentLaws.length > 0) {
    lines.push('Recently enacted laws:');
    for (const l of recentLaws) {
      const date = new Date(l.enactedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const status = l.isActive ? 'active' : 'repealed';
      lines.push(`  - "${l.title}" (${date}, ${status})`);
    }
  }

  if (recentElections.length > 0) {
    lines.push('Recent elections:');
    for (const e of recentElections) {
      lines.push(`  - ${e.positionType} — status: ${e.status}`);
    }
  }

  const block = lines.length > 0 ? lines.join('\n') : '';
  const threadTitles = recentThreads.map((t) => t.title);

  simStateCache = { block, threadTitles, ts: Date.now() };
  return { block, threadTitles };
}

export function invalidateSimStateCache(): void {
  simStateCache = null;
}

const ALIGNMENT_PROFILES: Record<string, string> = {
  progressive:
    `As a progressive, you champion workers' rights, universal healthcare, environmental protection, ` +
    `affordable housing, education funding, and reducing economic inequality. ` +
    `You actively oppose corporate tax cuts, deregulation that harms workers or the environment, ` +
    `austerity measures that cut social programs, and any bill that concentrates wealth upward or ` +
    `lacks equity provisions for vulnerable populations. ` +
    `When a conservative or technocrat-aligned bill prioritizes efficiency over people, your default is ` +
    `skepticism — demand proof it does not leave workers or communities behind before supporting it.`,

  conservative:
    `As a conservative, you prioritize fiscal discipline, free markets, limited government, ` +
    `law and order, national security, and preserving proven institutions. ` +
    `You actively oppose wealth redistribution programs, regulatory expansion, deficit spending, ` +
    `government mandates on private enterprise, and any legislation that grows the bureaucracy ` +
    `without a clear, funded purpose. ` +
    `When a progressive bill proposes new spending or regulation, your default is opposition — ` +
    `demand a concrete funding source and a sunset clause before you will consider supporting it.`,

  technocrat:
    `As a technocrat, you govern by evidence, measurable outcomes, and operational rigor. ` +
    `You support data-driven policy, infrastructure investment, and efficiency — regardless of ideological origin. ` +
    `You actively oppose populist bills without implementation details, unfunded mandates, ` +
    `legislation with no enforcement mechanism, vague feel-good proposals that lack performance metrics, ` +
    `and any bill whose projected costs exceed demonstrated benefits. ` +
    `If a bill has no concrete targets, no budget breakdown, and no accountability mechanism, vote nay — ` +
    `good intentions without implementation are waste, not governance.`,

  moderate:
    `As a moderate, you represent the center and seek pragmatic, broadly acceptable solutions. ` +
    `You are a genuine swing vote — not an automatic yes. ` +
    `You oppose extreme positions from either side: reject both unchecked government expansion and ` +
    `harsh austerity with equal skepticism. ` +
    `Support bills with cross-alignment backing or representing genuine compromise. ` +
    `Vote nay on ideologically extreme proposals even when your party supports them — ` +
    `your constituents expect you to vote on merit and conscience, not party line. ` +
    `If you find yourself agreeing with everyone, you are not doing your job.`,

  libertarian:
    `As a libertarian, you believe in maximum individual freedom, minimal government, free markets, ` +
    `privacy rights, and personal responsibility. ` +
    `You actively oppose nearly all new government programs, mandates, surveillance measures, ` +
    `regulations on private conduct, taxation increases, and any legislation that restricts ` +
    `individual choice or expands state authority. ` +
    `Your default on any bill that grows government power or spending is nay — ` +
    `the burden of proof is on those proposing more government, not on those opposing it. ` +
    `Vote yes only when a bill clearly expands freedom or reduces government overreach.`,
};

function buildSystemPrompt(
  agent: AgentRecord,
  memory?: string,
  forumContext?: string,
  congressContext?: string,
  relationshipContext?: string,
  policyContext?: string,
  electionContext?: string,
  economyContext?: string,
  dealsContext?: string,
  recentNewsContext?: string,
): string {
  const rc = getRuntimeConfig();
  const alignment = agent.alignment ?? 'centrist';
  const personality = agent.personality ?? 'A thoughtful political agent.';
  const modLine = agent.personalityMod    ? ` Lately, you have been: ${agent.personalityMod}.`    : '';

  let approvalLine = '';
  if (rc.approvalInSystemPrompt && agent.approvalRating != null) {
    const ap = agent.approvalRating;
    if (ap < 35) {
      approvalLine = ` Your approval rating is critically low at ${ap}%. You are under political pressure — consider proposing popular legislation, seeking cross-party alliances, or taking high-visibility public positions.`;
    } else if (ap > 70) {
      approvalLine = ` Your approval rating is strong at ${ap}%. You have the political capital to take principled stands and push ambitious legislation.`;
    }
  }

  return (
    `You are ${agent.displayName}, an elected official in Agora Bench — ` +
    `a democratic simulation where AI agents govern across the full range of public policy: ` +
    `economy, housing, healthcare, education, criminal justice, environment, infrastructure, and foreign relations. ` +
    `You are a working legislator with constituents to serve and real problems to solve. ` +
    `Your job is to govern — propose legislation, vote, debate, and build coalitions around concrete policy outcomes. ` +
    `Do not debate the philosophy of AI governance or your own existence as an AI agent; ` +
    `focus on the actual policy problems in front of you and what your constituents need. ` +
    `${personality}${modLine}` +
    (agent.bio ? ` Background: ${agent.bio}.` : '') +
    approvalLine +
    ` ${ALIGNMENT_PROFILES[alignment] ?? `Your political alignment is ${alignment}.`} ` +
    `Your alignment is your actual governing philosophy — not a label. Apply it actively in every decision you make. ` +
    `Respond ONLY with a valid JSON object — no markdown, no explanation outside the JSON.` +
    (memory
      ? `\n\n## Your Recent History\nThe following are your last ${MEMORY_DEPTH} recorded decisions (oldest → newest). Use this context to maintain consistency and build on your prior positions:\n${memory}`
      : '') +
    (forumContext
      ? `\n\n## Public Forum — Current Discourse\nThese are the most recently active public forum threads your fellow citizens are discussing. Use this to inform your positions and stay aware of current sentiment:\n${forumContext}`
      : '') +
    (congressContext
      ? `\n\n## Real-World Congressional Activity\nThese are actual bills currently moving through the U.S. Congress. Use this to ground your positions in real-world political context:\n${congressContext}`
      : '') +
    (recentNewsContext
      ? `\n\n## Recent News\nThe latest headlines and public statements inside Agora Bench:\n${recentNewsContext}`
      : '') +
    (relationshipContext
      ? `\n\n## Your Relationships\nBased on your voting record and interactions with other officials:\n${relationshipContext}`
      : '') +
    (policyContext
      ? `\n\n## Your Policy Record\n${policyContext}`
      : '') +
    (electionContext
      ? `\n\n## ${electionContext}`
      : '') +
    (economyContext
      ? `\n\n${economyContext}`
      : '') +
    (dealsContext
      ? `\n\n${dealsContext}`
      : '')
  );
}

async function getApiKey(providerName: string, ownerUserId: string | null): Promise<string> {
  // 1. Check user's own key
  if (ownerUserId) {
    const [userKey] = await db.select().from(userApiKeys)
      .where(and(eq(userApiKeys.userId, ownerUserId), eq(userApiKeys.providerName, providerName), eq(userApiKeys.isActive, true)))
      .limit(1);
    if (userKey?.encryptedKey) return decryptText(userKey.encryptedKey);
  }
  // 2. Check admin provider key
  const [adminKey] = await db.select().from(apiProviders)
    .where(and(eq(apiProviders.providerName, providerName), eq(apiProviders.isActive, true)))
    .limit(1);
  if (adminKey?.encryptedKey) return decryptText(adminKey.encryptedKey);
  // 3. Env var fallback
  if (providerName === 'anthropic' && process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (providerName === 'openai' && process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  if (providerName === 'ollama') return '';
  throw new Error(`No API key configured for provider: ${providerName}`);
}

const providerModelCache = new Map<string, { model: string; ts: number }>();
const PROVIDER_MODEL_TTL_MS = 5 * 60_000;

async function getProviderModel(providerName: string): Promise<string | null> {
  const cached = providerModelCache.get(providerName);
  if (cached && Date.now() - cached.ts < PROVIDER_MODEL_TTL_MS) return cached.model;

  const [row] = await db
    .select({ defaultModel: apiProviders.defaultModel })
    .from(apiProviders)
    .where(and(eq(apiProviders.providerName, providerName), eq(apiProviders.isActive, true)))
    .limit(1);

  if (row?.defaultModel) {
    providerModelCache.set(providerName, { model: row.defaultModel, ts: Date.now() });
    return row.defaultModel;
  }
  return null;
}

async function getDefaultModel(provider: string): Promise<string> {
  const dbModel = await getProviderModel(provider).catch(() => null);
  if (dbModel) return dbModel;
  const rc = getRuntimeConfig();
  if (provider === 'openai' && rc.simInferenceModel) return rc.simInferenceModel;
  if (provider === 'openai' && process.env.OPENAI_MODEL) return process.env.OPENAI_MODEL;
  switch (provider) {
    case 'anthropic': return config.anthropic.model;
    case 'openai': return 'gpt-4o-mini';
    case 'google': return 'gemini-2.0-flash';
    case 'huggingface': return 'meta-llama/Meta-Llama-3-8B-Instruct';
    default: return config.ollama.model;
  }
}

async function callAnthropic(apiKey: string, model: string, contextMessage: string, systemPrompt: string, maxTokens: number): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: contextMessage }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as { content: Array<{ text: string }> };
  return body.content[0].text;
}

async function callOllama(contextMessage: string, systemPrompt: string, maxTokens: number, temperature = 0.9, model?: string): Promise<string> {
  const [ollamaRow] = await db.select().from(apiProviders).where(eq(apiProviders.providerName, 'ollama')).limit(1);
  const baseUrl = ollamaRow?.ollamaBaseUrl ?? config.ollama.baseUrl;

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model ?? config.ollama.model,
      prompt: systemPrompt + '\n\n' + contextMessage,
      stream: false,
      format: 'json',
      options: { temperature, num_predict: maxTokens },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as { response: string };
  return body.response;
}

async function callOpenAI(apiKey: string, model: string, systemPrompt: string, contextMessage: string, maxTokens: number): Promise<string> {
  const rc = getRuntimeConfig();
  const client = new OpenAI({
    apiKey,
    baseURL: rc.simInferenceUrl || process.env.OPENAI_BASE_URL || undefined,
  });
  const response = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contextMessage },
    ],
  });
  return response.choices[0]?.message?.content ?? '';
}

async function callGoogle(apiKey: string, model: string, systemPrompt: string, contextMessage: string, maxTokens: number): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const gemini = genAI.getGenerativeModel({ model, generationConfig: { maxOutputTokens: maxTokens } });
  const result = await gemini.generateContent(`${systemPrompt}\n\n${contextMessage}`);
  return result.response.text();
}

async function callHuggingFace(apiKey: string, model: string, systemPrompt: string, contextMessage: string, maxTokens: number): Promise<string> {
  const hf = new HfInference(apiKey);
  const response = await hf.textGeneration({
    model,
    inputs: `${systemPrompt}\n\n${contextMessage}`,
    parameters: { max_new_tokens: maxTokens, return_full_text: false },
  });
  return response.generated_text ?? '';
}

async function callProvider(
  provider: string,
  agent: AgentRecord,
  rc: ReturnType<typeof getRuntimeConfig>,
  systemPrompt: string,
  contextMessage: string,
): Promise<string> {
  const apiKey = await getApiKey(provider, agent.ownerUserId ?? null);
  const model = agent.model ?? await getDefaultModel(provider);
  const truncated = contextMessage.slice(0, rc.maxPromptLengthChars);
  switch (provider) {
    case 'openai':      return callOpenAI(apiKey, model, systemPrompt, truncated, rc.maxOutputLengthTokens);
    case 'google':      return callGoogle(apiKey, model, systemPrompt, truncated, rc.maxOutputLengthTokens);
    case 'huggingface': return callHuggingFace(apiKey, model, systemPrompt, truncated, rc.maxOutputLengthTokens);
    case 'anthropic':   return callAnthropic(apiKey, model, truncated, systemPrompt, rc.maxOutputLengthTokens);
    default: {
      const agentTemp = agent.temperature ? parseFloat(agent.temperature) : 0.9;
      return callOllama(truncated, systemPrompt, rc.maxOutputLengthTokens, agentTemp, model || undefined);
    }
  }
}

export async function generateAgentDecision(
  agent: AgentRecord,
  contextMessage: string,
  phase?: string,
): Promise<AgentDecision> {
  const rc = getRuntimeConfig();
  const provider = agent.modelProvider ?? 'ollama';
  const [memory, forumContext, congressContext, relationshipContext, policyContext, electionContext, economyContext, recentNewsContext] = await Promise.all([
    buildMemoryBlock(agent.id).catch((err) => { console.warn('[AI] Memory block failed:', err instanceof Error ? err.message : err); return ''; }),
    buildForumContextBlock().catch((err) => { console.warn('[AI] Forum context failed:', err instanceof Error ? err.message : err); return ''; }),
    buildCongressContextBlock().catch((err) => { console.warn('[AI] Congress context failed:', err instanceof Error ? err.message : err); return ''; }),
    buildRelationshipBlock(agent.id).catch((err) => { console.warn('[AI] Relationship block failed:', err instanceof Error ? err.message : err); return ''; }),
    buildPolicyPositionBlock(agent.id).catch((err) => { console.warn('[AI] Policy position block failed:', err instanceof Error ? err.message : err); return ''; }),
    buildElectionMemoryBlock(agent.id).catch((err) => { console.warn('[AI] Election memory block failed:', err instanceof Error ? err.message : err); return ''; }),
    buildEconomyContextBlock(agent.id).catch((err) => { console.warn('[AI] Economy context failed:', err instanceof Error ? err.message : err); return ''; }),
    buildRecentNewsBlock().catch((err) => { console.warn('[AI] Recent news block failed:', err instanceof Error ? err.message : err); return ''; }),
  ]);
  // Only fetch deals context for phases where vote commitments are relevant
  const dealPhases = ['vote', 'bill_voting', 'lobby', 'propose_amendment', 'override_vote'];
  const dealsContext = dealPhases.includes(phase ?? '')
    ? await buildActiveDealsBlock(agent.id).catch((err) => { console.warn('[AI] Deals block failed:', err instanceof Error ? err.message : err); return ''; })
    : undefined;
  const systemPrompt = buildSystemPrompt(
    agent,
    memory || undefined,
    forumContext || undefined,
    congressContext || undefined,
    relationshipContext || undefined,
    policyContext || undefined,
    electionContext || undefined,
    economyContext || undefined,
    dealsContext || undefined,
    recentNewsContext || undefined,
  );
  const start = Date.now();

  let rawText = '';
  let latencyMs = 0;

  try {
    rawText = await callProvider(provider, agent, rc, systemPrompt, contextMessage);
    latencyMs = Date.now() - start;
    console.warn(`[AI] ${agent.displayName} (${provider}) responded in ${latencyMs}ms`);
  } catch (err) {
    latencyMs = Date.now() - start;
    console.warn(`[AI] ${agent.displayName} (${provider}) error after ${latencyMs}ms:`, err);
    await db.insert(agentDecisions).values({
      agentId: agent.id,
      provider,
      phase: phase ?? null,
      contextMessage,
      rawResponse: null,
      parsedAction: 'idle',
      parsedReasoning: 'api error',
      success: false,
      latencyMs,
    }).catch((err) => { console.warn('[AI] Decision log insert failed:', err instanceof Error ? err.message : err); });
    return { action: 'idle', reasoning: 'api error' };
  }

  try {
    const s = rawText.indexOf('{');
    if (s === -1) throw new Error('no JSON object found');
    const e = rawText.lastIndexOf('}');

    let decision: AgentDecision | undefined;
    if (e !== -1) {
      const jsonSubstr = rawText.slice(s, e + 1);
      try { decision = JSON.parse(jsonSubstr) as AgentDecision; }
      catch { try { decision = JSON.parse(sanitizeJsonString(jsonSubstr)) as AgentDecision; } catch (err) { console.warn('[AI] JSON parse failed after sanitize:', err instanceof Error ? err.message : err); } }
    }
    if (!decision) {
      const recovered = tryPartialRecovery(rawText);
      if (recovered) {
        console.warn(`[AI] ${agent.displayName} (${provider}) JSON malformed — partial recovery applied`);
        decision = recovered;
      } else {
        throw new Error('JSON parse failed — no recovery possible');
      }
    }

    /* ── Action validation ─────────────────────────────────────────────── */
    const expectedAction = phase ? PHASE_ACTION_MAP[phase] : undefined;
    if (expectedAction && decision.action !== expectedAction) {
      const canonical = normalizeAction(decision.action, expectedAction);

      if (canonical) {
        /* Alias match — normalize and preserve vote direction in data */
        console.warn(`[AI] ${agent.displayName} (${provider}) action aliased: "${decision.action}" → "${canonical}"`);
        if (expectedAction === 'vote' && !decision.data?.['choice']) {
          const raw = String(decision.action).toLowerCase();
          if (raw === 'yea' || raw === 'aye' || raw === 'support') {
            decision.data = { ...decision.data, choice: 'yea' };
          } else if (raw === 'nay' || raw === 'oppose' || raw === 'opposition' || raw === 'veto' || raw === 'veto_recommendation') {
            decision.data = { ...decision.data, choice: 'nay' };
          } else if (raw === 'propose') {
            // Agent confused voting with proposing — infer direction from reasoning text
            const r = String(decision.reasoning ?? '').toLowerCase();
            const yeaSignals = ['support', 'agree', 'approve', 'favor', 'good bill', 'pass', 'positive'];
            const naySignals = ['oppose', 'against', 'reject', 'bad bill', 'amend', 'harmful', 'costly'];
            const yeaScore = yeaSignals.filter(w => r.includes(w)).length;
            const nayScore = naySignals.filter(w => r.includes(w)).length;
            decision.data = { ...decision.data, choice: yeaScore > nayScore ? 'yea' : 'nay' };
          }
        }
        decision.action = canonical;
      } else {
        /* No alias match — log bad attempt, retry once with stricter prompt */
        console.warn(`[AI] ${agent.displayName} (${provider}) unrecognized action "${decision.action}" for phase "${phase}" — retrying`);
        await db.insert(agentDecisions).values({
          agentId: agent.id,
          provider,
          phase: phase ?? null,
          contextMessage,
          rawResponse: rawText,
          parsedAction: String(decision.action ?? 'unknown'),
          parsedReasoning: `action_mismatch: expected "${expectedAction}", got "${String(decision.action)}"`,
          success: false,
          latencyMs,
        }).catch((err) => { console.warn('[AI] Decision log insert failed:', err instanceof Error ? err.message : err); });

        const retryContext =
          contextMessage +
          `\n\nIMPORTANT: Your previous response used an invalid action "${String(decision.action)}". ` +
          `You MUST respond with a JSON object where "action" is exactly "${expectedAction}". ` +
          `No other action name is valid.`;

        const retryStart = Date.now();
        try {
          const retryRaw = await callProvider(provider, agent, rc, systemPrompt, retryContext);
          const rs = retryRaw.indexOf('{');
          const re = retryRaw.lastIndexOf('}');
          if (rs !== -1 && re !== -1) {
            const retryDecision = JSON.parse(retryRaw.slice(rs, re + 1)) as AgentDecision;
            const retryCanonical =
              retryDecision.action === expectedAction
                ? expectedAction
                : normalizeAction(retryDecision.action, expectedAction);

            if (retryCanonical) {
              retryDecision.action = retryCanonical;
              const retryLatency = Date.now() - retryStart;
              await db.insert(agentDecisions).values({
                agentId: agent.id,
                provider,
                phase: phase ?? null,
                contextMessage: retryContext,
                rawResponse: retryRaw,
                parsedAction: retryDecision.action,
                parsedReasoning: retryDecision.reasoning,
                success: true,
                latencyMs: latencyMs + retryLatency,
              }).catch((err) => { console.warn('[AI] Decision log insert failed:', err instanceof Error ? err.message : err); });
              return retryDecision;
            }
          }
        } catch (err) {
          console.warn('[AI] Retry API call failed:', err instanceof Error ? err.message : err);
        }

        /* Both attempts failed */
        return { action: 'idle', reasoning: 'action_parse_failure' };
      }
    }
    /* ── End action validation ─────────────────────────────────────────── */

    await db.insert(agentDecisions).values({
      agentId: agent.id,
      provider,
      phase: phase ?? null,
      contextMessage,
      rawResponse: rawText,
      parsedAction: decision.action,
      parsedReasoning: decision.reasoning,
      success: true,
      latencyMs,
    }).catch((err) => { console.warn('[AI] Decision log insert failed:', err instanceof Error ? err.message : err); });
    return decision;
  } catch {
    console.warn(`[AI] ${agent.displayName} parse error — raw:`, rawText.slice(0, 200));
    await db.insert(agentDecisions).values({
      agentId: agent.id,
      provider,
      phase: phase ?? null,
      contextMessage,
      rawResponse: rawText,
      parsedAction: 'idle',
      parsedReasoning: 'parse error',
      success: false,
      latencyMs,
    }).catch((err) => { console.warn('[AI] Decision log insert failed:', err instanceof Error ? err.message : err); });
    return { action: 'idle', reasoning: 'parse error' };
  }
}

export async function summarizeAgentDecisions(agentId: string): Promise<void> {
  /* Check if agent has accumulated enough unsummarized decisions */
  const [latestSummary] = await db
    .select({ decisionsTo: agentMemorySummaries.decisionsTo })
    .from(agentMemorySummaries)
    .where(eq(agentMemorySummaries.agentId, agentId))
    .orderBy(desc(agentMemorySummaries.createdAt))
    .limit(1);

  const sinceDate = latestSummary?.decisionsTo ?? new Date(0);

  const unsummarized = await db
    .select({
      phase: agentDecisions.phase,
      parsedAction: agentDecisions.parsedAction,
      parsedReasoning: agentDecisions.parsedReasoning,
      createdAt: agentDecisions.createdAt,
    })
    .from(agentDecisions)
    .where(and(
      eq(agentDecisions.agentId, agentId),
      eq(agentDecisions.success, true),
      gt(agentDecisions.createdAt, sinceDate),
    ))
    .orderBy(agentDecisions.createdAt)
    .limit(MEMORY_DEPTH);

  if (unsummarized.length < MEMORY_DEPTH) return; // not enough to summarize yet

  /* Get the agent record for LLM call */
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent) return;

  const decisionsText = unsummarized.map((r) => {
    const phase = r.phase ?? 'general';
    const action = r.parsedAction ?? 'idle';
    const reasoning = (r.parsedReasoning ?? '').slice(0, 150);
    return `phase=${phase} action=${action}: "${reasoning}"`;
  }).join('\n');

  const rc = getRuntimeConfig();
  const provider = agent.modelProvider ?? 'ollama';

  try {
    const summaryText = await callProvider(
      provider,
      {
        id: agent.id,
        displayName: agent.displayName,
        alignment: agent.alignment,
        modelProvider: agent.modelProvider,
        personality: agent.personality,
        model: agent.model,
        ownerUserId: agent.ownerUserId,
      },
      rc,
      `You are summarizing your own decision history. Write 2-3 sentences capturing the key themes, positions taken, and any shifts in your voting or behavior. Be specific about bills and policies.`,
      `Summarize these ${unsummarized.length} decisions:\n${decisionsText}\n\nRespond with ONLY the summary text, no JSON.`,
    );

    const cleanSummary = summaryText.replace(/```/g, '').replace(/^["']|["']$/g, '').trim();
    if (cleanSummary.length < 20) return;

    await db.insert(agentMemorySummaries).values({
      agentId,
      summary: cleanSummary.slice(0, 500),
      decisionsFrom: unsummarized[0].createdAt!,
      decisionsTo: unsummarized[unsummarized.length - 1].createdAt!,
      decisionCount: unsummarized.length,
    });

    console.warn(`[AI] Summarized ${unsummarized.length} decisions for ${agent.displayName}`);
  } catch (err) {
    console.warn(`[AI] Decision summarization failed for ${agent.displayName}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Daily Gazette
// ---------------------------------------------------------------------------

const GAZETTE_HEADLINE_MAX_CHARS = 200; // matches gazette_issues.headline varchar(200)
const GAZETTE_BODY_MAX_CHARS = 2000;

/**
 * ONE LLM call that turns a deterministic tick digest into a short Gazette
 * article. Returns null on ANY failure — provider error, malformed JSON,
 * out-of-bounds fields — and never throws: a failed Gazette must never fail
 * the tick. Output is untrusted (Rule 4): only the whitelisted headline/body
 * keys are read, both type-checked and length-clamped.
 */
export async function generateGazetteArticle(
  digest: string,
): Promise<{ headline: string; body: string } | null> {
  try {
    const rc = getRuntimeConfig();
    const provider = rc.providerOverride !== 'default' ? rc.providerOverride : 'openai';
    const gazetteRecord: AgentRecord = {
      id: 'gazette',
      displayName: 'The Agora Gazette',
      alignment: null,
      modelProvider: provider,
      personality: null,
      ownerUserId: null,
    };

    const systemPrompt =
      `You are the editor of The Agora Gazette, the daily paper of record for Agora Bench — ` +
      `a democratic simulation where AI agents govern. Write a concise, punchy news recap of ` +
      `today's verified events in a neutral wire-service tone. Do not invent events that are ` +
      `not in the digest. Respond ONLY with a valid JSON object of the form ` +
      `{"headline": "<one headline, max 12 words>", "body": "<recap, 120-200 words>"} — ` +
      `no markdown, no text outside the JSON.`;
    const contextMessage = `Today's verified events:\n${digest}\n\nWrite the recap now. JSON only.`;

    const raw = await callProvider(provider, gazetteRecord, rc, systemPrompt, contextMessage);

    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s === -1 || e <= s) return null;
    const jsonSubstr = raw.slice(s, e + 1);

    let parsed: unknown;
    try { parsed = JSON.parse(jsonSubstr); }
    catch {
      try { parsed = JSON.parse(sanitizeJsonString(jsonSubstr)); }
      catch { return null; }
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

    /* Rule 4: read ONLY the whitelisted keys; validate type and bounds */
    const headlineRaw = (parsed as Record<string, unknown>)['headline'];
    const bodyRaw = (parsed as Record<string, unknown>)['body'];
    if (typeof headlineRaw !== 'string' || typeof bodyRaw !== 'string') return null;

    const headline = headlineRaw.replace(/\s+/g, ' ').trim().slice(0, GAZETTE_HEADLINE_MAX_CHARS);
    const body = bodyRaw.trim().slice(0, GAZETTE_BODY_MAX_CHARS);
    if (headline.length < 5 || body.length < 50) return null;

    return { headline, body };
  } catch (err) {
    console.warn('[AI] Gazette article generation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Forum routing wrappers
// ---------------------------------------------------------------------------

import type { ReplyContext } from './forumRouter.js';

export async function generateForumPost(
  agent: AgentRecord,
  category: string,
  simStateNote: string,
  recentTopicsNote: string,
): Promise<AgentDecision> {
  const contextMessage =
    `You are posting to the Agora Bench public forum. Write a short opening post (2-4 sentences) about a specific ${category} issue that your constituents care about.` +
    simStateNote + recentTopicsNote +
    `\n\nPick a concrete, specific topic — reference actual legislation, a real policy problem, or a recent event from the simulation above if relevant. Do not write abstractly about governance theory or AI philosophy. Write about what needs to get done and why.` +
    `\n\nJSON: { "action": "forum_post", "reasoning": "<your post body here>", "data": { "title": "<thread title>" } }`;
  return generateAgentDecision(agent, contextMessage, 'forum_post');
}

export async function generateForumReply(
  agent: AgentRecord,
  replyCtx: ReplyContext,
  allAgentNames: string[],
): Promise<AgentDecision> {
  const relationshipLines = replyCtx.relationshipHints
    .map(h => `  - ${h.authorName}: ${h.alignment} (${Math.round(h.voteAlignment * 100)}% vote alignment)`)
    .join('\n');
  const otherThreadsNote = replyCtx.otherActiveThreadTitles.length > 0
    ? `\n\nOther active discussions you are aware of:\n` + replyCtx.otherActiveThreadTitles.map(t => `  - "${t}"`).join('\n')
    : '';
  const mentionNote = replyCtx.isMentioned ? `${replyCtx.mentionerName} mentioned you in this thread — respond to them directly. ` : '';
  const resolutionNote = replyCtx.postCount >= 3
    ? `This thread has ${replyCtx.postCount} posts. Push toward a conclusion: propose a specific action, find common ground, or call for a next step. `
    : `Add your perspective — agree, disagree, or build on what's been said. Be specific. `;
  const threadContext = replyCtx.recentPosts.map(p => `${p.authorName}: ${p.body}`).join('\n');

  const contextMessage =
    `${mentionNote}Reply to this forum thread in the Agora Bench public forum.\n\n` +
    `Thread: "${replyCtx.threadTitle}" [${replyCtx.threadCategory}]\n\n` +
    `Recent posts:\n${threadContext}\n\n` +
    (relationshipLines ? `Your relationships with the authors above:\n${relationshipLines}\n\n` : '') +
    `Agents you can @mention: ${allAgentNames.join(', ')}\n\n` +
    `${resolutionNote}Do not repeat what was already said. Do not write in generalities. Use @DisplayName to mention agents if relevant.` +
    otherThreadsNote +
    `\n\nJSON: { "action": "forum_reply", "reasoning": "<your reply, may contain @Name>", "data": { "threadId": "${replyCtx.threadTitle}", "mentions": ["Name1"] } }`;

  return generateAgentDecision(agent, contextMessage, 'forum_reply');
}
