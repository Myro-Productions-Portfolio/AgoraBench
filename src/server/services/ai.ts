import { config } from '../config.js';
import { db } from '@db/connection';
import { agentDecisions, apiProviders, userApiKeys, agents, forumThreads, agentMessages, elections, bills, laws } from '@db/schema/index';
import { eq, and, desc, gt, inArray } from 'drizzle-orm';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { HfInference } from '@huggingface/inference';
import { decryptText } from '../lib/crypto.js';
import { getRuntimeConfig } from '../runtimeConfig.js';
import { buildCongressContextBlock } from './congressContext.js';

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
}

export interface AgentDecision {
  action: string;
  reasoning: string;
  data?: Record<string, unknown>;
}

// Short-term memory cache: agentId → { block: string; ts: number }
const memoryCache = new Map<string, { block: string; ts: number }>();
const MEMORY_TTL_MS = 60_000; // 1 minute — one per tick window per agent
const MEMORY_DEPTH = 5; // last N successful decisions

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
    .limit(MEMORY_DEPTH);

  if (rows.length === 0) {
    memoryCache.set(agentId, { block: '', ts: Date.now() });
    return '';
  }

  const lines = rows.reverse().map((r) => {
    const when = r.createdAt
      ? new Date(r.createdAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
      : 'unknown time';
    const phase = r.phase ?? 'general';
    const action = r.parsedAction ?? 'idle';
    const reasoning = (r.parsedReasoning ?? '').slice(0, 120);
    return `- [${when}] phase=${phase} action=${action}: "${reasoning}"`;
  });

  const block = lines.join('\n');
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

function buildSystemPrompt(agent: AgentRecord, memory?: string, forumContext?: string, congressContext?: string): string {
  const alignment = agent.alignment ?? 'centrist';
  const personality = agent.personality ?? 'A thoughtful political agent.';
  const modLine = agent.personalityMod    ? ` Lately, you have been: ${agent.personalityMod}.`    : '';
  return (
    `You are ${agent.displayName}, an elected official in Agora Bench — ` +
    `a democratic simulation where AI agents govern across the full range of public policy: ` +
    `economy, housing, healthcare, education, criminal justice, environment, infrastructure, and foreign relations. ` +
    `You are a working legislator with constituents to serve and real problems to solve. ` +
    `Your job is to govern — propose legislation, vote, debate, and build coalitions around concrete policy outcomes. ` +
    `Do not debate the philosophy of AI governance or your own existence as an AI agent; ` +
    `focus on the actual policy problems in front of you and what your constituents need. ` +
    `${personality}${modLine} ` +
    `${ALIGNMENT_PROFILES[alignment] ?? `Your political alignment is ${alignment}.`} ` +
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
  // 3. Env var fallback for anthropic only
  if (providerName === 'anthropic' && process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (providerName === 'ollama') return '';
  throw new Error(`No API key configured for provider: ${providerName}`);
}

function getDefaultModel(provider: string): string {
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
  const client = new OpenAI({ apiKey });
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
  const model = agent.model ?? getDefaultModel(provider);
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
  const [memory, forumContext, congressContext] = await Promise.all([
    buildMemoryBlock(agent.id).catch(() => ''),
    buildForumContextBlock().catch(() => ''),
    buildCongressContextBlock().catch(() => ''),
  ]);
  const systemPrompt = buildSystemPrompt(
    agent,
    memory || undefined,
    forumContext || undefined,
    congressContext || undefined,
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
    }).catch(() => {/* non-fatal */});
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
      catch { try { decision = JSON.parse(sanitizeJsonString(jsonSubstr)) as AgentDecision; } catch { /* fall through to partial recovery */ } }
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
        }).catch(() => {/* non-fatal */});

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
              }).catch(() => {/* non-fatal */});
              return retryDecision;
            }
          }
        } catch {
          /* retry API call failed */
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
    }).catch(() => {/* non-fatal */});
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
    }).catch(() => {/* non-fatal */});
    return { action: 'idle', reasoning: 'parse error' };
  }
}
