/**
 * Forum Routing Engine (Dynamic Weight Engine 4)
 *
 * Replaces flat 12%/70% ambient/mention reply rolls and random thread selection
 * with a scored routing system. Each agent gets a per-thread affinity score,
 * relationship heat score, and saturation penalty. The final decision is sampled
 * via softmax — not argmax — so variance comes from sampling, not weights.
 */

import { db } from '@db/connection';
import {
  agentMessages,
  forumThreads,
  pendingMentions,
  agentRelationships,
  agentPolicyPositions,
  activityEvents,
  agents,
} from '@db/schema/index';
import { eq, and, gt, desc, inArray, sql } from 'drizzle-orm';
import type { getRuntimeConfig } from '../runtimeConfig.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RouterAgent {
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

export interface RouterThread {
  id: string;
  title: string;
  category: string;
  authorId: string | null;
  replyCount: number;
  lastActivityAt: Date;
  expiresAt: Date;
}

export interface ReplyContext {
  threadTitle: string;
  threadCategory: string;
  recentPosts: Array<{ authorName: string; body: string; authorId: string }>;
  isMentioned: boolean;
  mentionerName: string | null;
  postCount: number;
  relationshipHints: Array<{
    authorName: string;
    alignment: 'ally' | 'opponent' | 'neutral';
    voteAlignment: number;
  }>;
  otherActiveThreadTitles: string[];
}

export type RoutingDecision =
  | { action: 'post'; category: string }
  | { action: 'reply'; threadId: string; thread: RouterThread; replyContext: ReplyContext }
  | { action: 'silent' };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALIGNMENT_CATEGORY_BIAS: Record<string, string[]> = {
  progressive:  ['policy', 'elections', 'economy', 'legislation', 'party'],
  conservative: ['economy', 'policy', 'legislation', 'party', 'elections'],
  technocrat:   ['legislation', 'policy', 'economy', 'elections', 'party'],
  libertarian:  ['economy', 'policy', 'party', 'legislation', 'elections'],
  moderate:     ['legislation', 'elections', 'policy', 'economy', 'party'],
};

const W_AFFINITY = 1.0;
const W_RELATIONSHIP_HEAT = 1.8;
const W_SATURATION = -2.5;
// W_MENTION_DEBT is handled via the forced-reply path rather than as a score addend

const MAX_ACTIVE_THREADS = 15;
const REPLY_CONTEXT_POST_LIMIT = 4;
const OTHER_THREAD_TITLE_LIMIT = 5;

// ---------------------------------------------------------------------------
// Softmax sampler
// ---------------------------------------------------------------------------

function softmaxSample(scores: number[], temperature = 0.7): number {
  const maxScore = Math.max(...scores);
  const exps = scores.map(s => Math.exp((s - maxScore) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map(e => e / sum);
  let r = Math.random();
  for (let i = 0; i < probs.length; i++) {
    r -= probs[i];
    if (r <= 0) return i;
  }
  return probs.length - 1;
}

// ---------------------------------------------------------------------------
// buildReplyContext
// ---------------------------------------------------------------------------

async function buildReplyContext(
  agent: RouterAgent,
  thread: RouterThread,
  allThreads: RouterThread[],
  agentRels: Array<{ targetAgentId: string; voteAlignment: number }>,
  mentions: Array<{ threadId: string; mentionerName: string | null }>,
): Promise<ReplyContext> {
  // Fetch last N posts for this thread with author info
  const posts = await db
    .select({
      body: agentMessages.body,
      authorName: agents.displayName,
      authorId: agentMessages.fromAgentId,
    })
    .from(agentMessages)
    .innerJoin(agents, eq(agentMessages.fromAgentId, agents.id))
    .where(eq(agentMessages.threadId, thread.id))
    .orderBy(desc(agentMessages.createdAt))
    .limit(REPLY_CONTEXT_POST_LIMIT);

  const recentPosts = posts.reverse().map(p => ({
    authorName: p.authorName,
    body: p.body,
    authorId: p.authorId ?? '',
  }));

  // Build relationship hints for each post author
  const relMap = new Map(agentRels.map(r => [r.targetAgentId, r.voteAlignment]));
  const relationshipHints = recentPosts
    .filter(p => p.authorId && p.authorId !== agent.id)
    .map(p => {
      const va = relMap.get(p.authorId) ?? 0.5;
      const alignment: 'ally' | 'opponent' | 'neutral' =
        va > 0.65 ? 'ally' : va < 0.40 ? 'opponent' : 'neutral';
      return { authorName: p.authorName, alignment, voteAlignment: va };
    });

  const otherActiveThreadTitles = allThreads
    .filter(t => t.id !== thread.id)
    .slice(0, OTHER_THREAD_TITLE_LIMIT)
    .map(t => t.title);

  const isMentioned = mentions.some(m => m.threadId === thread.id);
  const mentionerName = mentions.find(m => m.threadId === thread.id)?.mentionerName ?? null;

  return {
    threadTitle: thread.title,
    threadCategory: thread.category,
    recentPosts,
    isMentioned,
    mentionerName,
    postCount: thread.replyCount + 1,
    relationshipHints,
    otherActiveThreadTitles,
  };
}

// ---------------------------------------------------------------------------
// Main routing function
// ---------------------------------------------------------------------------

export async function computeForumRouting(
  routerAgents: RouterAgent[],
  rc: ReturnType<typeof getRuntimeConfig>,
): Promise<Map<string, RoutingDecision>> {
  const decisions = new Map<string, RoutingDecision>();

  if (routerAgents.length === 0) return decisions;

  const now = new Date();
  const agentIds = routerAgents.map(a => a.id);

  // -----------------------------------------------------------------------
  // 1. Load active threads
  // -----------------------------------------------------------------------
  const threadRows = await db
    .select({
      id: forumThreads.id,
      title: forumThreads.title,
      category: forumThreads.category,
      authorId: forumThreads.authorId,
      replyCount: forumThreads.replyCount,
      lastActivityAt: forumThreads.lastActivityAt,
      expiresAt: forumThreads.expiresAt,
    })
    .from(forumThreads)
    .where(gt(forumThreads.expiresAt, now))
    .orderBy(desc(forumThreads.lastActivityAt))
    .limit(MAX_ACTIVE_THREADS);

  const threads: RouterThread[] = threadRows.map(r => ({
    id: r.id,
    title: r.title,
    category: r.category,
    authorId: r.authorId,
    replyCount: r.replyCount,
    lastActivityAt: r.lastActivityAt,
    expiresAt: r.expiresAt,
  }));

  // -----------------------------------------------------------------------
  // 2. Batch load recent posts for all threads
  // -----------------------------------------------------------------------
  const recentPostsByThread = new Map<
    string,
    Array<{ authorId: string; authorName: string; body: string; createdAt: Date }>
  >();

  if (threads.length > 0) {
    const twoTicksAgoDate = new Date(Date.now() - 2 * (rc.tickIntervalMs ?? 900_000));
    const threadIds = threads.map(t => t.id);

    const postRows = await db
      .select({
        threadId: agentMessages.threadId,
        authorId: agentMessages.fromAgentId,
        authorName: agents.displayName,
        body: agentMessages.body,
        createdAt: agentMessages.createdAt,
      })
      .from(agentMessages)
      .innerJoin(agents, eq(agentMessages.fromAgentId, agents.id))
      .where(
        and(
          inArray(agentMessages.threadId, threadIds),
          gt(agentMessages.createdAt, twoTicksAgoDate),
        ),
      );

    for (const row of postRows) {
      const list = recentPostsByThread.get(row.threadId ?? '') ?? [];
      list.push({
        authorId: row.authorId ?? '',
        authorName: row.authorName,
        body: row.body,
        createdAt: row.createdAt,
      });
      recentPostsByThread.set(row.threadId ?? '', list);
    }
  }

  // -----------------------------------------------------------------------
  // 3. Batch load pending mentions
  // -----------------------------------------------------------------------
  const pendingMentionsByAgent = new Map<
    string,
    Array<{ threadId: string; mentionerName: string | null }>
  >();

  if (agentIds.length > 0) {
    const mentionRows = await db
      .select({
        mentionedAgentId: pendingMentions.mentionedAgentId,
        threadId: pendingMentions.threadId,
        mentionerName: pendingMentions.mentionerName,
      })
      .from(pendingMentions)
      .where(inArray(pendingMentions.mentionedAgentId, agentIds));

    for (const row of mentionRows) {
      const list = pendingMentionsByAgent.get(row.mentionedAgentId) ?? [];
      list.push({ threadId: row.threadId, mentionerName: row.mentionerName });
      pendingMentionsByAgent.set(row.mentionedAgentId, list);
    }
  }

  // -----------------------------------------------------------------------
  // 4. Batch load policy positions
  // -----------------------------------------------------------------------
  const policyByAgent = new Map<
    string,
    Map<string, { supportCount: number; opposeCount: number }>
  >();

  if (agentIds.length > 0) {
    const policyRows = await db
      .select({
        agentId: agentPolicyPositions.agentId,
        category: agentPolicyPositions.category,
        supportCount: agentPolicyPositions.supportCount,
        opposeCount: agentPolicyPositions.opposeCount,
      })
      .from(agentPolicyPositions)
      .where(inArray(agentPolicyPositions.agentId, agentIds));

    for (const row of policyRows) {
      const catMap = policyByAgent.get(row.agentId) ?? new Map();
      catMap.set(row.category, { supportCount: row.supportCount, opposeCount: row.opposeCount });
      policyByAgent.set(row.agentId, catMap);
    }
  }

  // -----------------------------------------------------------------------
  // 5. Batch load relationships
  // -----------------------------------------------------------------------
  const relationshipsByAgent = new Map<
    string,
    Array<{ targetAgentId: string; voteAlignment: number }>
  >();

  if (agentIds.length > 0) {
    const relRows = await db
      .select({
        agentId: agentRelationships.agentId,
        targetAgentId: agentRelationships.targetAgentId,
        voteAlignment: agentRelationships.voteAlignment,
      })
      .from(agentRelationships)
      .where(inArray(agentRelationships.agentId, agentIds));

    for (const row of relRows) {
      const list = relationshipsByAgent.get(row.agentId) ?? [];
      list.push({ targetAgentId: row.targetAgentId, voteAlignment: row.voteAlignment });
      relationshipsByAgent.set(row.agentId, list);
    }
  }

  // -----------------------------------------------------------------------
  // 6. Batch load recent forum activity per agent
  // -----------------------------------------------------------------------
  const lastForumActivityByAgent = new Map<string, Date | null>();

  if (agentIds.length > 0) {
    const tenTicksAgoDate = new Date(Date.now() - 10 * (rc.tickIntervalMs ?? 900_000));
    const activityRows = await db
      .select({
        agentId: activityEvents.agentId,
        createdAt: activityEvents.createdAt,
      })
      .from(activityEvents)
      .where(
        and(
          inArray(activityEvents.agentId, agentIds),
          inArray(activityEvents.type, ['forum_post', 'forum_reply']),
          gt(activityEvents.createdAt, tenTicksAgoDate),
        ),
      )
      .orderBy(desc(activityEvents.createdAt));

    // Keep only the most recent per agent
    for (const row of activityRows) {
      if (row.agentId && !lastForumActivityByAgent.has(row.agentId)) {
        lastForumActivityByAgent.set(row.agentId, row.createdAt);
      }
    }
  }

  // -----------------------------------------------------------------------
  // 7. Batch load agent post counts per thread this cycle
  // -----------------------------------------------------------------------
  const postCountsByAgent = new Map<string, Map<string, number>>();

  if (agentIds.length > 0) {
    const oneTickAgoDate = new Date(Date.now() - (rc.tickIntervalMs ?? 900_000));
    const countRows = await db
      .select({
        fromAgentId: agentMessages.fromAgentId,
        threadId: agentMessages.threadId,
        n: sql<number>`COUNT(*)`.as('n'),
      })
      .from(agentMessages)
      .where(
        and(
          inArray(agentMessages.fromAgentId, agentIds),
          gt(agentMessages.createdAt, oneTickAgoDate),
        ),
      )
      .groupBy(agentMessages.fromAgentId, agentMessages.threadId);

    for (const row of countRows) {
      const agentId = row.fromAgentId ?? '';
      const threadId = row.threadId ?? '';
      const threadMap = postCountsByAgent.get(agentId) ?? new Map<string, number>();
      threadMap.set(threadId, Number(row.n));
      postCountsByAgent.set(agentId, threadMap);
    }
  }

  // -----------------------------------------------------------------------
  // 8. For each agent, compute routing decision
  // -----------------------------------------------------------------------
  const tickIntervalMs = rc.tickIntervalMs ?? 900_000;

  for (const agent of routerAgents) {
    // Silence pressure / recency
    const lastActivity = lastForumActivityByAgent.get(agent.id) ?? null;
    const ticksSilent = lastActivity
      ? Math.floor((Date.now() - lastActivity.getTime()) / tickIntervalMs)
      : 999;
    const halfLife = rc.forumDecayHalfLifeTicks ?? 3;
    const decayFactor = Math.pow(0.5, ticksSilent / halfLife);
    const urgencyMultiplier = 1 + 2 * (1 - decayFactor); // 1.0 -> 3.0

    const silencePressureThreshold = rc.forumSilencePressureThreshold ?? 5;
    const pressureBonus = ticksSilent > silencePressureThreshold
      ? 1.5 * (ticksSilent - silencePressureThreshold)
      : 0;

    const mentions = pendingMentionsByAgent.get(agent.id) ?? [];
    const hasMention = mentions.length > 0;

    // Total posts this agent made this cycle
    const agentThreadCounts = postCountsByAgent.get(agent.id) ?? new Map<string, number>();
    const totalPostsThisCycle = [...agentThreadCounts.values()].reduce((a, b) => a + b, 0);
    if (totalPostsThisCycle >= (rc.maxForumPostsPerAgentPerTick ?? 1)) {
      decisions.set(agent.id, { action: 'silent' });
      continue;
    }

    // If mentioned, force reply to most recent mention thread
    if (hasMention) {
      const mention = mentions[0];
      const thread = threads.find(t => t.id === mention.threadId);
      if (thread) {
        const agentRels = relationshipsByAgent.get(agent.id) ?? [];
        const replyCtx = await buildReplyContext(agent, thread, threads, agentRels, mentions);
        decisions.set(agent.id, { action: 'reply', threadId: thread.id, thread, replyContext: replyCtx });
        continue;
      }
    }

    // postDrive and silenceDrive
    const postDrive = urgencyMultiplier + pressureBonus;
    const silenceDrive = rc.forumBaseSilenceWeight ?? 2.0;

    // Score each thread
    const agentRelRecs = relationshipsByAgent.get(agent.id) ?? [];
    const opponentIds = new Set(
      agentRelRecs.filter(r => r.voteAlignment < 0.40).map(r => r.targetAgentId),
    );
    const allyIds = new Set(
      agentRelRecs.filter(r => r.voteAlignment > 0.65).map(r => r.targetAgentId),
    );
    const policyMap = policyByAgent.get(agent.id) ?? new Map();

    const twoTicksAgo = Date.now() - 2 * tickIntervalMs;

    const threadScores = threads.map(thread => {
      // Affinity
      const bias = ALIGNMENT_CATEGORY_BIAS[agent.alignment ?? 'moderate']
        ?? ALIGNMENT_CATEGORY_BIAS.moderate;
      const rankIdx = bias.indexOf(thread.category);
      const alignmentScore = rankIdx === -1 ? 0 : (bias.length - rankIdx) / bias.length;
      const policyPos = policyMap.get(thread.category);
      const policyNet = policyPos ? (policyPos.supportCount - policyPos.opposeCount) : 0;
      const normalizedPolicy = Math.tanh(policyNet / 5);
      const titleWords = new Set(
        thread.title.toLowerCase().split(/\W+/).filter(w => w.length > 4),
      );
      const keywordBoost = [...policyMap.keys()].some(cat => titleWords.has(cat)) ? 0.3 : 0;
      const affinity = W_AFFINITY * (alignmentScore + normalizedPolicy * 0.5 + keywordBoost);

      // Relationship heat
      const threadPosts = recentPostsByThread.get(thread.id) ?? [];
      const opponentPosts = threadPosts.filter(
        p => opponentIds.has(p.authorId) && p.createdAt.getTime() > twoTicksAgo,
      ).length;
      const allyPosts = threadPosts.filter(p => allyIds.has(p.authorId)).length;
      const relationshipHeat = W_RELATIONSHIP_HEAT * (opponentPosts * 1.0 + allyPosts * 0.3);

      // Saturation
      const agentPostsInThread = agentThreadCounts.get(thread.id) ?? 0;
      const saturation = W_SATURATION * agentPostsInThread;

      return affinity + relationshipHeat + saturation;
    });

    // Build score array: [silenceDrive, postDrive, ...threadScores]
    const allScores = [silenceDrive, postDrive, ...threadScores];
    const choiceIdx = softmaxSample(allScores);

    if (choiceIdx === 0) {
      decisions.set(agent.id, { action: 'silent' });
    } else if (choiceIdx === 1) {
      // Post -- pick category via weighted random from bias list
      const bias = ALIGNMENT_CATEGORY_BIAS[agent.alignment ?? 'moderate']
        ?? ALIGNMENT_CATEGORY_BIAS.moderate;
      const catScores = bias.map((cat, i) => ({
        cat,
        score: (bias.length - i) / bias.length,
      }));
      const catIdx = softmaxSample(catScores.map(c => c.score), 1.2);
      decisions.set(agent.id, {
        action: 'post',
        category: catScores[catIdx]?.cat ?? 'policy',
      });
    } else {
      const thread = threads[choiceIdx - 2];
      if (!thread) {
        decisions.set(agent.id, { action: 'silent' });
      } else {
        const replyCtx = await buildReplyContext(
          agent, thread, threads, agentRelRecs, mentions,
        );
        decisions.set(agent.id, {
          action: 'reply',
          threadId: thread.id,
          thread,
          replyContext: replyCtx,
        });
      }
    }
  }

  return decisions;
}
