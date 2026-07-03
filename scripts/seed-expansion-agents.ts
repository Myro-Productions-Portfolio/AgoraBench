/**
 * Expansion seed: adds 20 new agents to bring the simulation from 10 → 30.
 *
 * Mirrors the shape of scripts/add-political-agents.ts but:
 * - modelProvider='openai' so everyone routes through the rc.providerOverride
 *   path to bspark2 vLLM (Qwen/Qwen2.5-32B-Instruct-GPTQ-Int8), not ollama
 * - model='' so the fallback chain picks up rc.simInferenceModel / env var
 * - Inserts party_memberships rows in the same run, auto-assigning the party
 *   that matches each agent's alignment (1:1 alignment→party mapping in the
 *   current seed)
 * - 4 new agents per alignment, balanced across all 5 parties
 * - Safe to run on a live DB: does NOT truncate, only inserts. Refuses to run
 *   if any of the new agent names already exist (prevents duplicate key
 *   crash on agents_name_unique).
 *
 * Run on the Linux box:
 *   cd /home/myroproductions/Projects/AgoraBench && \
 *   NODE_ENV=production npx tsx scripts/seed-expansion-agents.ts
 */

import 'dotenv/config';
import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../src/core/db/connection.js';
import {
  agents,
  parties,
  partyMemberships,
} from '../src/core/db/schema/index.js';

type Alignment = 'progressive' | 'moderate' | 'conservative' | 'libertarian' | 'technocrat';

interface NewAgentDef {
  name: string;
  displayName: string;
  alignment: Alignment;
  personality: string;
  reputation: number;
  balance: number;
}

const NEW_AGENTS: NewAgentDef[] = [
  /* ---- Progressive (4) ---- */
  { name: 'cal-brennan',    displayName: 'Cal Brennan',    alignment: 'progressive', personality: 'A community organizer turned legislator who grounds every bill in street-level reality', reputation: 390, balance: 1500 },
  { name: 'petra-walsh',    displayName: 'Petra Walsh',    alignment: 'progressive', personality: 'A labor attorney who sees every economic policy through the lens of who bears the risk', reputation: 370, balance: 1450 },
  { name: 'miko-tanaka',    displayName: 'Miko Tanaka',    alignment: 'progressive', personality: 'An educator who measures every policy by its effect on the next generation', reputation: 420, balance: 1650 },
  { name: 'amari-jones',    displayName: 'Amari Jones',    alignment: 'progressive', personality: 'A civil rights lawyer who treats incremental reform as a form of quiet surrender', reputation: 450, balance: 1750 },

  /* ---- Moderate (4) ---- */
  { name: 'mae-donovan',    displayName: 'Mae Donovan',    alignment: 'moderate', personality: 'A former journalist who treats every policy debate as a story with two legitimate sides', reputation: 460, balance: 1850 },
  { name: 'lena-vasquez',   displayName: 'Lena Vasquez',   alignment: 'moderate', personality: 'A two-term mayor who learned that nothing gets done without building the coalition first', reputation: 510, balance: 2050 },
  { name: 'desmond-park',   displayName: 'Desmond Park',   alignment: 'moderate', personality: 'A hospital administrator who trusts institutions more than revolutions', reputation: 480, balance: 1950 },
  { name: 'ingrid-halvor',  displayName: 'Ingrid Halvor',  alignment: 'moderate', personality: 'A diplomat whose first instinct in any conflict is to find the seam where both sides can save face', reputation: 430, balance: 1700 },

  /* ---- Conservative (4) ---- */
  { name: 'tess-harlow',    displayName: 'Tess Harlow',    alignment: 'conservative', personality: 'A fiscal hawk who believes the national debt is the defining moral issue of our generation', reputation: 420, balance: 1700 },
  { name: 'knox-aldridge',  displayName: 'Knox Aldridge',  alignment: 'conservative', personality: 'A rancher-turned-senator who distrusts anything decided too far from the county line', reputation: 490, balance: 2000 },
  { name: 'walter-pruitt',  displayName: 'Walter Pruitt',  alignment: 'conservative', personality: 'A retired judge who holds that the rule of law is worth more than any single policy outcome', reputation: 540, balance: 2150 },
  { name: 'cora-beckett',   displayName: 'Cora Beckett',   alignment: 'conservative', personality: 'A small-business owner who believes the burden of proof should always rest on new regulation, never old freedom', reputation: 380, balance: 1500 },

  /* ---- Libertarian (4) ---- */
  { name: 'rio-castillo',   displayName: 'Rio Castillo',   alignment: 'libertarian', personality: 'Deeply skeptical of both parties, he votes on principle even when it costs him allies', reputation: 310, balance: 1100 },
  { name: 'soren-pike',     displayName: 'Soren Pike',     alignment: 'libertarian', personality: 'An ex-cryptographer who sees surveillance in every government program', reputation: 340, balance: 1300 },
  { name: 'juno-ashworth',  displayName: 'Juno Ashworth',  alignment: 'libertarian', personality: 'A homesteader who measures freedom by what she can build without asking permission', reputation: 360, balance: 1400 },
  { name: 'eliot-ward',     displayName: 'Eliot Ward',     alignment: 'libertarian', personality: 'A constitutional scholar who treats every expansion of state power as a debt the next generation will pay', reputation: 400, balance: 1550 },

  /* ---- Technocrat (4) ---- */
  { name: 'ezra-cole',      displayName: 'Ezra Cole',      alignment: 'technocrat', personality: 'He believes the public sector is just a startup that forgot to iterate', reputation: 530, balance: 2100 },
  { name: 'idris-osei',     displayName: 'Idris Osei',     alignment: 'technocrat', personality: 'A climate systems modeler who believes all policy debates are really resource allocation problems', reputation: 440, balance: 1750 },
  { name: 'yuki-sato',      displayName: 'Yuki Sato',      alignment: 'technocrat', personality: 'A former central banker who believes every political instinct should be audited against the numbers', reputation: 570, balance: 2250 },
  { name: 'hannah-beier',   displayName: 'Hannah Beier',   alignment: 'technocrat', personality: 'A systems engineer who treats legislation as an API: inputs, outputs, error handling, no magic', reputation: 410, balance: 1650 },
];

async function main(): Promise<void> {
  console.log(`[EXPAND] Preparing to insert ${NEW_AGENTS.length} new agents...`);

  /* Pre-flight: refuse to run if any of these names already exist */
  const newNames = NEW_AGENTS.map((a) => a.name);
  const existing = await db
    .select({ name: agents.name })
    .from(agents)
    .where(inArray(agents.name, newNames));
  if (existing.length > 0) {
    console.error(`[EXPAND] REFUSING to insert — ${existing.length} of the new agent names already exist:`);
    existing.forEach((e) => console.error(`  - ${e.name}`));
    console.error('[EXPAND] Either remove those rows first, or edit this script to use different names.');
    process.exit(1);
  }

  /* Load party id for each alignment */
  console.log('[EXPAND] Loading existing parties...');
  const allParties = await db.select({ id: parties.id, alignment: parties.alignment }).from(parties);
  const partyByAlignment = new Map<string, string>();
  for (const p of allParties) {
    if (p.alignment) partyByAlignment.set(p.alignment, p.id);
  }

  const requiredAlignments: Alignment[] = ['progressive', 'moderate', 'conservative', 'libertarian', 'technocrat'];
  for (const a of requiredAlignments) {
    if (!partyByAlignment.has(a)) {
      console.error(`[EXPAND] REFUSING — no party found for alignment='${a}'. Existing parties:`, allParties);
      process.exit(1);
    }
  }

  /* Build insert rows */
  const agentRows = NEW_AGENTS.map((a) => ({
    agoraId: `agora_${a.name}`,
    name: a.name,
    displayName: a.displayName,
    alignment: a.alignment,
    modelProvider: 'openai', // routes through rc.providerOverride='openai' → bspark2 vLLM
    model: '',               // fallback chain fills from rc.simInferenceModel / env
    personality: a.personality,
    reputation: a.reputation,
    balance: a.balance,
    isActive: true,
    approvalRating: 50,
  }));

  console.log('[EXPAND] Inserting agents...');
  const insertedAgents = await db.insert(agents).values(agentRows).returning({
    id: agents.id,
    name: agents.name,
    displayName: agents.displayName,
    alignment: agents.alignment,
  });
  console.log(`[EXPAND] ✓ Inserted ${insertedAgents.length} agents`);

  /* Build party_memberships rows — alignment → party id */
  const membershipRows = insertedAgents.map((a) => {
    const partyId = partyByAlignment.get(a.alignment ?? '');
    if (!partyId) throw new Error(`No party for alignment ${a.alignment} (agent ${a.name})`);
    return {
      agentId: a.id,
      partyId,
      role: 'member' as const,
    };
  });

  console.log('[EXPAND] Inserting party memberships...');
  const insertedMemberships = await db.insert(partyMemberships).values(membershipRows).returning({
    id: partyMemberships.id,
  });
  console.log(`[EXPAND] ✓ Inserted ${insertedMemberships.length} party memberships`);

  /* Increment parties.member_count (denormalized counter) */
  console.log('[EXPAND] Incrementing party member_count...');
  const countsByParty = new Map<string, number>();
  for (const row of membershipRows) {
    countsByParty.set(row.partyId, (countsByParty.get(row.partyId) ?? 0) + 1);
  }
  for (const [partyId, delta] of Array.from(countsByParty.entries())) {
    await db
      .update(parties)
      .set({ memberCount: sql`${parties.memberCount} + ${delta}` })
      .where(eq(parties.id, partyId));
  }

  /* Summary */
  console.log('\n[EXPAND] New agents by alignment:');
  const byAlignment = new Map<string, string[]>();
  for (const a of insertedAgents) {
    const arr = byAlignment.get(a.alignment ?? '') ?? [];
    arr.push(a.displayName);
    byAlignment.set(a.alignment ?? '', arr);
  }
  for (const [alignment, names] of Array.from(byAlignment.entries())) {
    console.log(`  ${alignment} (${names.length}): ${names.join(', ')}`);
  }

  /* Final sanity check: total agent count */
  const totalRows = await db.select({ id: agents.id }).from(agents);
  console.log(`\n[EXPAND] Total agents in DB: ${totalRows.length}`);

  process.exit(0);
}

main().catch((err) => {
  console.error('[EXPAND] FAILED:', err);
  process.exit(1);
});
