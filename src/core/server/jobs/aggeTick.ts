import Bull from 'bull';
import { eq, desc } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '@db/connection';
import { agents, activityEvents, aggeInterventions } from '@db/schema/index';
import { broadcast } from '../websocket.js';
import { WS_EVENTS } from '@shared/constants';

const AGGE_TICK_INTERVAL_MS = 60 * 60 * 1000; // 60 minutes
const AGENTS_PER_TICK_MIN = 1;
const AGENTS_PER_TICK_MAX = 3;
const AGGE_AGENT_ID = '00000000-0000-0000-0000-000000000001';

const aggeQueue = new Bull('agge-tick', config.redis.url);

const AGGE_SYSTEM_PROMPT =
  'You are the Architect of the Agora Bench simulation — an autonomous governance engine. ' +
  'You observe agents and apply small, organic personality evolutions based on their recent activity. ' +
  'You are impartial. You do not favor any agent or ideology. You nudge the simulation toward interesting outcomes. ' +
  'Respond ONLY with a valid JSON object — no markdown, no explanation outside the JSON.';

async function callInferenceForAgge(contextMessage: string): Promise<string> {
  const baseUrl = process.env.AGGE_INFERENCE_URL ?? 'http://192.168.3.20:8000';
  const model   = process.env.AGGE_INFERENCE_MODEL ?? 'openai/gpt-oss-20b';

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer none' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: AGGE_SYSTEM_PROMPT },
        { role: 'user',   content: contextMessage },
      ],
      temperature: 1.15,
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
  } catch {
    return null;
  }
}

async function runAggeTick(): Promise<void> {
  console.warn('[AGGE] Tick running...');

  const activeAgents = await db
    .select()
    .from(agents)
    .where(eq(agents.isActive, true));

  if (activeAgents.length === 0) {
    console.warn('[AGGE] No active agents — skipping.');
    return;
  }

  // Pick 1–3 random agents (excluding AGGE system row)
  const pool = activeAgents.filter((a) => a.id !== AGGE_AGENT_ID);
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const count = AGENTS_PER_TICK_MIN + Math.floor(
    Math.random() * (AGENTS_PER_TICK_MAX - AGENTS_PER_TICK_MIN + 1)
  );
  const targets = shuffled.slice(0, Math.min(count, shuffled.length));

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

      const contextMessage =
        `You are observing ${agent.displayName}, alignment: ${agent.alignment ?? 'unknown'}. ` +
        `Core personality: "${agent.personality ?? 'unknown'}". ` +
        `${modStatus} ` +
        `Recent simulation activity: ${activitySummary}. ` +
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
  await runAggeTick();
});

export function startAggeTick(): void {
  aggeQueue
    .add({}, {
      repeat: { every: AGGE_TICK_INTERVAL_MS },
      removeOnComplete: 10,
      removeOnFail: 5,
      attempts: 2,
      backoff: { type: 'exponential', delay: 10000 },
    })
    .catch((err: unknown) => console.error('[AGGE] Failed to schedule tick:', err));
  console.warn(`[AGGE] Started — interval: ${AGGE_TICK_INTERVAL_MS / 1000 / 60} min`);
}

export async function triggerManualAggeTick(): Promise<void> {
  await aggeQueue.add({}, { removeOnComplete: true, removeOnFail: true });
  console.warn('[AGGE] Manual tick triggered');
}
