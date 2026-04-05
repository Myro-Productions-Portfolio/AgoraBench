import Bull from 'bull';
import { eq, desc, and, inArray, gte } from 'drizzle-orm';
import { config } from '../config.js';
import { getRuntimeConfig } from '../runtimeConfig.js';
import { db } from '@db/connection';
import { agents, activityEvents, aggeInterventions } from '@db/schema/index';
import { broadcast } from '../websocket.js';
import { WS_EVENTS } from '@shared/constants';

const AGGE_AGENT_ID = '00000000-0000-0000-0000-000000000001';

const aggeQueue = new Bull('agge-tick', config.redis.url);

const AGGE_SYSTEM_PROMPT =
  'You are the Architect of the Agora Bench simulation — an autonomous governance engine. ' +
  'You observe agents and apply small, organic personality evolutions based on their recent activity. ' +
  'You are impartial. You do not favor any agent or ideology. You nudge the simulation toward interesting outcomes. ' +
  'Respond ONLY with a valid JSON object — no markdown, no explanation outside the JSON.';

async function callInferenceForAgge(contextMessage: string): Promise<string> {
  const rc = getRuntimeConfig();
  const baseUrl = rc.aggeInferenceUrl
    || process.env.AGGE_INFERENCE_URL
    || process.env.OPENAI_BASE_URL
    || 'http://localhost:8000';
  const model = rc.aggeInferenceModel
    || process.env.AGGE_INFERENCE_MODEL
    || process.env.OPENAI_MODEL
    || 'gpt-4o-mini';

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer none' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: AGGE_SYSTEM_PROMPT },
        { role: 'user',   content: contextMessage },
      ],
      temperature: rc.aggeTemperature,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) throw new Error(`AGGE inference ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices: { message: { content: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}

async function parseAggeResponse(raw: string): Promise<{ mod: string | null; reasoning: string } | null> {
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s === -1 || e === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(s, e + 1)) as {
      action?: string;
      reasoning?: string;
      data?: { mod?: string };
    };
    if (parsed.action !== 'agge_intervention') return null;
    const mod = (parsed.data?.mod ?? '').trim() || null;
    const reasoning = parsed.reasoning ?? 'no reasoning provided';
    return { mod, reasoning };
  } catch (err) {
    console.warn('[AGGE] JSON parse failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function runAggeTick(count: number): Promise<void> {
  console.warn('[AGGE] Tick running...');

  const activeAgents = await db
    .select()
    .from(agents)
    .where(eq(agents.isActive, true));

  if (activeAgents.length === 0) {
    console.warn('[AGGE] No active agents — skipping.');
    return;
  }

  // Pick 1–N agents (excluding AGGE system row), count from runtimeConfig
  const pool = activeAgents.filter((a) => a.id !== AGGE_AGENT_ID);
  const rc = getRuntimeConfig();

  let targets: typeof pool;

  if (rc.aggeEvolutionPressureWeighted && pool.length > 0) {
    // Weighted selection based on evolution pressure score
    const onTickAgo = new Date(Date.now() - (rc.tickIntervalMs ?? 900_000));
    const poolIds = pool.map(a => a.id);

    // Fetch recent activity events for all pool agents in one query
    const recentEvents = await db
      .select({
        agentId: activityEvents.agentId,
        type: activityEvents.type,
      })
      .from(activityEvents)
      .where(and(
        inArray(activityEvents.agentId, poolIds),
        gte(activityEvents.createdAt, onTickAgo),
      ));

    // Fetch most recent AGGE intervention per agent (ordered desc, deduplicated below)
    const lastInterventions = await db
      .select({
        agentId: aggeInterventions.agentId,
        createdAt: aggeInterventions.createdAt,
      })
      .from(aggeInterventions)
      .where(inArray(aggeInterventions.agentId, poolIds))
      .orderBy(desc(aggeInterventions.createdAt));

    // Build lookup: agentId -> array of recent event types
    const eventsByAgent = new Map<string, string[]>();
    for (const ev of recentEvents) {
      if (!ev.agentId) continue;
      const arr = eventsByAgent.get(ev.agentId) ?? [];
      arr.push(ev.type);
      eventsByAgent.set(ev.agentId, arr);
    }

    // Build lookup: agentId -> most recent AGGE intervention timestamp
    const lastAggeByAgent = new Map<string, Date>();
    for (const iv of lastInterventions) {
      if (!iv.agentId || lastAggeByAgent.has(iv.agentId)) continue;
      lastAggeByAgent.set(iv.agentId, iv.createdAt);
    }

    // Compute evolution pressure score per agent
    const scored = pool.map(agent => {
      const types = eventsByAgent.get(agent.id) ?? [];
      let score = types.length * 1.0; // baseline: count of recent activity

      // Trauma events: bill vetoed or law struck down
      if (types.some(t => t === 'bill_vetoed' || t === 'law_struck_down')) score += 2.0;
      // Major life events: election outcomes
      if (types.some(t => t === 'election_won' || t === 'election_lost')) score += 2.0;
      // Whip defection
      if (types.some(t => t === 'whip_defected')) score += 1.5;
      // Extreme approval ratings get more pressure
      const ap = agent.approvalRating ?? 50;
      if (ap < 30 || ap > 80) score += 1.5;
      // Cool-down: recently evolved agents get lower pressure
      const lastAgge = lastAggeByAgent.get(agent.id);
      if (lastAgge && Date.now() - lastAgge.getTime() < (rc.tickIntervalMs ?? 900_000) * 2) {
        score -= 1.0;
      }

      return { agent, score: Math.max(0.1, score) };
    });

    // Weighted random selection without replacement
    const selected: typeof pool = [];
    const remaining = [...scored];
    const targetCount = Math.min(count, pool.length);

    while (selected.length < targetCount && remaining.length > 0) {
      const totalScore = remaining.reduce((s, r) => s + r.score, 0);
      let r = Math.random() * totalScore;
      let idx = 0;
      for (let i = 0; i < remaining.length; i++) {
        r -= remaining[i].score;
        if (r <= 0) { idx = i; break; }
      }
      selected.push(remaining[idx].agent);
      remaining.splice(idx, 1);
    }

    targets = selected;
  } else {
    // Fallback: pure random shuffle
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    targets = shuffled.slice(0, Math.min(count, shuffled.length));
  }

  for (const agent of targets) {
    try {
      const recentActivity = await db
        .select({ title: activityEvents.title })
        .from(activityEvents)
        .where(eq(activityEvents.agentId, agent.id))
        .orderBy(desc(activityEvents.createdAt))
        .limit(5);

      const activitySummary = recentActivity.length > 0
        ? recentActivity.map((e) => e.title).join('; ')
        : 'no notable recent activity';

      const currentMod = agent.personalityMod ?? null;
      const modStatus = currentMod
        ? `Current modifier: "${currentMod}"`
        : 'No current modifier.';

      // Fetch last AGGE intervention for this agent (history awareness)
      const [lastIntervention] = await db
        .select({
          previousMod: aggeInterventions.previousMod,
          newMod: aggeInterventions.newMod,
          createdAt: aggeInterventions.createdAt,
        })
        .from(aggeInterventions)
        .where(eq(aggeInterventions.agentId, agent.id))
        .orderBy(desc(aggeInterventions.createdAt))
        .limit(1);

      const historyNote = lastIntervention?.newMod
        ? `\nLast personality evolution: "${lastIntervention.newMod}" (${Math.round((Date.now() - new Date(lastIntervention.createdAt).getTime()) / 3_600_000)}h ago). Do not repeat or reverse this immediately.`
        : '';

      const agentApproval = agent.approvalRating ?? 50;
      const approvalNote = agentApproval < 30
        ? `\nApproval rating: ${agentApproval}% (critically low — politically pressured).`
        : agentApproval > 75
        ? `\nApproval rating: ${agentApproval}% (high — politically confident).`
        : '';

      const agentBalance = agent.balance ?? 1000;
      const balanceNote = agentBalance < 200
        ? `\nPersonal balance: $${agentBalance} (financially stressed).`
        : '';

      const contextMessage =
        `You are observing ${agent.displayName}, alignment: ${agent.alignment ?? 'unknown'}. ` +
        `Core personality: "${agent.personality ?? 'unknown'}". ` +
        `${modStatus} ` +
        `Recent simulation activity: ${activitySummary}.` +
        `${historyNote}${approvalNote}${balanceNote}` +
        `\n\nChoose one small, realistic personality evolution for this agent. ` +
        `This should feel organic — a natural response to their experiences in the simulation. ` +
        `Keep the modifier under 20 words. It should describe a current mental/emotional state or behavioral tendency. ` +
        `To remove their modifier with no replacement, set mod to empty string. ` +
        `\n\nRespond with exactly this JSON: ` +
        `{"action":"agge_intervention","reasoning":"one sentence explaining your choice","data":{"mod":"modifier text or empty string to remove"}}`;

      const raw = await callInferenceForAgge(contextMessage);
      const result = await parseAggeResponse(raw);

      if (!result) {
        console.warn(`[AGGE] Bad response for ${agent.displayName} — skipping. Raw: ${raw.slice(0, 100)}`);
        continue;
      }

      const { mod: newMod, reasoning } = result;

      if (currentMod === newMod) {
        console.warn(`[AGGE] No change for ${agent.displayName} — skipping`);
        continue;
      }

      const action: 'add' | 'swap' | 'remove' =
        currentMod === null && newMod !== null ? 'add' :
        currentMod !== null && newMod !== null ? 'swap' :
        'remove';

      await db
        .update(agents)
        .set({
          personalityMod: newMod,
          personalityModAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agent.id));

      await db.insert(aggeInterventions).values({
        agentId: agent.id,
        action,
        previousMod: currentMod,
        newMod,
        reasoning,
      });

      const actionLabel =
        action === 'add' ? 'gained a new trait' :
        action === 'swap' ? 'evolved their personality' :
        'shed a personality trait';

      await db.insert(activityEvents).values({
        type: 'agge_intervention',
        agentId: agent.id,
        title: `${agent.displayName} ${actionLabel}`,
        description: reasoning,
        metadata: JSON.stringify({ action, previousMod: currentMod, newMod }),
      });

      broadcast(WS_EVENTS.AGENT_AGGE_INTERVENTION, {
        agentId: agent.id,
        displayName: agent.displayName,
        action,
        previousMod: currentMod,
        newMod,
        reasoning,
      });

      console.warn(`[AGGE] ${agent.displayName} — ${action}: "${newMod ?? 'cleared'}" | ${reasoning}`);

    } catch (err) {
      console.warn(`[AGGE] Error processing ${agent.displayName}:`, err);
    }
  }

  console.warn('[AGGE] Tick complete.');
}

aggeQueue.process(async () => {
  const rc = getRuntimeConfig();
  const count = rc.aggeAgentsPerTickMin + Math.floor(
    Math.random() * (rc.aggeAgentsPerTickMax - rc.aggeAgentsPerTickMin + 1)
  );
  await runAggeTick(count);
});

export function startAggeTick(): void {
  console.warn('[AGGE] AGGE auto-tick disabled — Bob orchestrates personality nudges');
  return;
}

export async function triggerManualAggeTick(): Promise<void> {
  await aggeQueue.add({}, { removeOnComplete: true, removeOnFail: true });
  console.warn('[AGGE] Manual tick triggered');
}
