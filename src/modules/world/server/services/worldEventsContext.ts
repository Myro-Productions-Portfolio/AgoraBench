// src/modules/world/server/services/worldEventsContext.ts
//
// World Events prompt-injection channel (E2 slice 2,
// docs/specs/world-events-injection.md). Deterministic builder mirroring
// congressContext.ts: turns the read-only world_events feed into one national
// briefing block every agent sees. No LLM, no per-agent routing, no per-row
// injection state — a live query rebuilt each cache cycle.
//
// Dark by default: gated on rc.worldEventsInjectionEnabled (independent of
// worldFeedEnabled, which gates polling). Off → returns '' and prompts are
// byte-identical to today.

import { db } from '@db/connection';
import { worldEvents } from '@db/schema/index';
import { and, gte, ne, desc } from 'drizzle-orm';
import { getRuntimeConfig } from '@core/server/runtimeConfig';
import { severityTier, isStateFips, SEVERITY_LABELS } from '@modules/world/server/lib/worldSeverity';

const MAX_EVENTS = 6;
const MAX_CHARS = 900;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min — world events move faster than congress bills

let cache: { block: string; ts: number } | null = null;

export async function buildWorldEventsBlock(): Promise<string> {
  const rc = getRuntimeConfig();
  if (!rc.worldEventsInjectionEnabled) return '';

  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.block;

  try {
    const since = new Date(Date.now() - rc.worldEventsRecencyHours * 60 * 60 * 1000);

    const rows = await db
      .select({
        category: worldEvents.category,
        severity: worldEvents.severity,
        title: worldEvents.title,
        summary: worldEvents.summary,
        location: worldEvents.location,
      })
      .from(worldEvents)
      .where(
        and(
          gte(worldEvents.occurredAt, since),
          gte(worldEvents.severity, rc.worldEventsMinSeverity),
          ne(worldEvents.status, 'expired'),
        ),
      )
      .orderBy(desc(worldEvents.severity), desc(worldEvents.occurredAt))
      .limit(MAX_EVENTS);

    if (rows.length === 0) {
      cache = { block: '', ts: Date.now() };
      return '';
    }

    const lines = rows.map((r) => {
      const where = isStateFips(r.location) ? `, in ${r.location}` : '';
      const tier = SEVERITY_LABELS[severityTier(r.severity)];
      const desc = firstSentence(r.summary, 200);
      return `[${r.category}${where}] ${r.title} (${tier})${desc ? ` — ${desc}` : ''}`;
    });

    const block = lines.join('\n').slice(0, MAX_CHARS);
    cache = { block, ts: Date.now() };
    return block;
  } catch (err) {
    console.warn('[worldEventsContext] build failed:', err instanceof Error ? err.message : String(err));
    return '';
  }
}

function firstSentence(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const end = clean.search(/[.!?]/);
  const sentence = end !== -1 ? clean.slice(0, end + 1) : clean;
  return sentence.slice(0, maxChars);
}
