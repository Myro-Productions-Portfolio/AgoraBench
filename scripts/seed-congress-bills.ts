#!/usr/bin/env tsx
/**
 * Seed Congress Bills into Agora Bench Database
 * 
 * Loads scraped bills from congress-bills.json and assigns them to random agents.
 * 
 * Usage: tsx scripts/seed-congress-bills.ts
 */

import fs from 'fs';
import path from 'path';
import { db } from '../src/db/connection.js';
import { bills, agents } from '../src/db/schema/index.js';
import { eq } from 'drizzle-orm';

interface ScrapedBill {
  externalId?: string;
  id?: string;
  title: string;
  summary: string;
  fullText?: string;
  committee: string;
  policyArea?: string;
  introducedDate: string;
  sponsorInfo?: {
    name: string;
    party: string;
    state: string;
  } | null;
  sponsor?: string;
  cosponsorCount?: number;
}

async function main() {
  console.log('Seeding Congress Bills into Agora Bench');
  console.log('============================================\n');
  
  // Load scraped bills (try simple version first, then full version)
  let billsPath = path.join(process.cwd(), 'scripts', 'congress-bills-simple.json');
  
  if (!fs.existsSync(billsPath)) {
    billsPath = path.join(process.cwd(), 'scripts', 'congress-bills.json');
  }
  
  if (!fs.existsSync(billsPath)) {
    console.error('ERROR: No bills file found.');
    console.error('Run: pnpm exec tsx scripts/scrape-simple.ts first');
    process.exit(1);
  }
  
  console.log(`Loading bills from: ${path.basename(billsPath)}`);
  
  const scrapedBills: ScrapedBill[] = JSON.parse(fs.readFileSync(billsPath, 'utf-8'));
  console.log(`Loaded ${scrapedBills.length} bills from congress-bills.json\n`);
  
  // Get all active agents
  const activeAgents = await db.select().from(agents).where(eq(agents.isActive, true));
  
  if (activeAgents.length === 0) {
    console.error('ERROR: No active agents found in database.');
    console.error('Create some agents first.');
    process.exit(1);
  }
  
  console.log(`Found ${activeAgents.length} active agents to assign as sponsors\n`);
  
  let inserted = 0;
  let skipped = 0;
  
  for (const scrapedBill of scrapedBills) {
    // Check if bill already exists
    const existing = await db
      .select()
      .from(bills)
      .where(eq(bills.title, scrapedBill.title))
      .limit(1);
    
    if (existing.length > 0) {
      console.log(`⏭️  Skipping: "${scrapedBill.title}" (already exists)`);
      skipped++;
      continue;
    }
    
    // Randomly assign to an agent
    const randomAgent = activeAgents[Math.floor(Math.random() * activeAgents.length)];
    
    // Randomly select 0-3 co-sponsors (different from sponsor)
    const cosponsorCount = Math.floor(Math.random() * 4);
    const coSponsorIds = activeAgents
      .filter(a => a.id !== randomAgent.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, cosponsorCount)
      .map(a => a.id);
    
    // Insert bill
    await db.insert(bills).values({
      title: scrapedBill.title,
      summary: scrapedBill.summary,
      fullText: scrapedBill.fullText || `[Real bill from Congress]\n\n${scrapedBill.title}\n\nIntroduced: ${scrapedBill.introducedDate}\nSponsor: ${scrapedBill.sponsor}\nCommittee: ${scrapedBill.committee}\n\nSummary: ${scrapedBill.summary}`,
      sponsorId: randomAgent.id,
      coSponsorIds: JSON.stringify(coSponsorIds),
      committee: scrapedBill.committee,
      status: 'proposed', // Start at proposed, let simulation advance them
      billType: 'original',
    });
    
    console.log(`✅ Inserted: "${scrapedBill.title}"`);
    console.log(`   Sponsor: ${randomAgent.displayName}`);
    console.log(`   Co-sponsors: ${cosponsorCount}`);
    console.log(`   Committee: ${scrapedBill.committee}\n`);
    
    inserted++;
  }
  
  console.log('\n===========================================');
  console.log(`✅ Inserted: ${inserted} bills`);
  console.log(`⏭️  Skipped: ${skipped} bills (duplicates)`);
  console.log('===========================================\n');
  
  console.log('Next steps:');
  console.log('1. Restart your simulation tick');
  console.log('2. Watch agents vote on real legislation');
  console.log('3. Monitor which bills advance through committees');
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
