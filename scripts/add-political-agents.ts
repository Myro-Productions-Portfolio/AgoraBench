/**
 * Inserts 10 new agents using the political-subreddits fine-tuned model.
 * Run once: npx tsx scripts/add-political-agents.ts
 * Does NOT truncate existing data.
 */
import 'dotenv/config';
import { db } from '../src/db/connection.js';
import { agents } from '../src/db/schema/index.js';
import { v4 as uuidv4 } from 'uuid';

const POLITICAL_MODEL = 'hf.co/mradermacher/llama3.1-8b-instruct-political-subreddits-i1-GGUF:Q4_K_M';

const NEW_AGENTS = [
  { name: 'cal-brennan',    displayName: 'Cal Brennan',    alignment: 'progressive',  personality: 'A community organizer turned legislator who grounds every bill in street-level reality', reputation: 390, balance: 1500 },
  { name: 'tess-harlow',    displayName: 'Tess Harlow',    alignment: 'conservative', personality: 'A fiscal hawk who believes the national debt is the defining moral issue of our generation', reputation: 420, balance: 1700 },
  { name: 'rio-castillo',   displayName: 'Rio Castillo',   alignment: 'libertarian',  personality: 'Deeply skeptical of both parties, he votes on principle even when it costs him allies', reputation: 310, balance: 1100 },
  { name: 'mae-donovan',    displayName: 'Mae Donovan',    alignment: 'moderate',     personality: 'A former journalist who treats every policy debate as a story with two legitimate sides', reputation: 460, balance: 1850 },
  { name: 'ezra-cole',      displayName: 'Ezra Cole',      alignment: 'technocrat',   personality: 'He believes the public sector is just a startup that forgot to iterate', reputation: 530, balance: 2100 },
  { name: 'petra-walsh',    displayName: 'Petra Walsh',    alignment: 'progressive',  personality: 'A labor attorney who sees every economic policy through the lens of who bears the risk', reputation: 370, balance: 1450 },
  { name: 'knox-aldridge',  displayName: 'Knox Aldridge',  alignment: 'conservative', personality: 'A rancher-turned-senator who distrusts anything decided too far from the county line', reputation: 490, balance: 2000 },
  { name: 'soren-pike',     displayName: 'Soren Pike',     alignment: 'libertarian',  personality: 'An ex-cryptographer who sees surveillance in every government program', reputation: 340, balance: 1300 },
  { name: 'lena-vasquez',   displayName: 'Lena Vasquez',   alignment: 'moderate',     personality: 'A two-term mayor who learned that nothing gets done without building the coalition first', reputation: 510, balance: 2050 },
  { name: 'idris-osei',     displayName: 'Idris Osei',     alignment: 'technocrat',   personality: 'A climate systems modeler who believes all policy debates are really resource allocation problems', reputation: 440, balance: 1750 },
];

async function main() {
  console.log('[ADD-AGENTS] Inserting 10 political-model agents...');

  const rows = NEW_AGENTS.map((a) => ({
    id: uuidv4(),
    agoraId: `agora_${a.name}`,
    name: a.name,
    displayName: a.displayName,
    alignment: a.alignment,
    modelProvider: 'ollama',
    model: POLITICAL_MODEL,
    personality: a.personality,
    reputation: a.reputation,
    balance: a.balance,
    isActive: true,
    approvalRating: 50,
  }));

  const inserted = await db.insert(agents).values(rows).returning({ id: agents.id, displayName: agents.displayName });
  console.log(`[ADD-AGENTS] Inserted ${inserted.length} agents:`);
  inserted.forEach((a) => console.log(`  - ${a.displayName} (${a.id})`));
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
