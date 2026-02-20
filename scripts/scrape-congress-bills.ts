#!/usr/bin/env tsx
/**
 * Congress.gov Bill Scraper
 * 
 * Fetches real bills from the Congress.gov API and formats them for Agora Bench.
 * 
 * Setup:
 * 1. Get a free API key: https://api.congress.gov/sign-up
 * 2. Set environment variable: CONGRESS_API_KEY=your_key_here
 * 3. Run: tsx scripts/scrape-congress-bills.ts
 * 
 * Output: scripts/congress-bills.json (ready to import into your DB)
 */

import fs from 'fs';
import path from 'path';

const API_KEY = process.env.CONGRESS_API_KEY;
const BASE_URL = 'https://api.congress.gov/v3';

// Congress numbers: 118 = 2023-2024, 117 = 2021-2022, 116 = 2019-2020
const CONGRESS_NUMBER = 118;
const BILL_TYPES = ['hr', 's']; // House bills, Senate bills
const BILLS_PER_TYPE = 50; // Total bills to fetch per type

interface CongressBill {
  number: string;
  title: string;
  type: string;
  congress: number;
  introducedDate: string;
  latestAction?: {
    actionDate: string;
    text: string;
  };
  sponsors?: Array<{
    firstName: string;
    lastName: string;
    party: string;
    state: string;
  }>;
  cosponsors?: {
    count: number;
  };
  committees?: Array<{
    name: string;
  }>;
  policyArea?: {
    name: string;
  };
}

interface BillText {
  text?: string;
}

interface BillSummary {
  text?: string;
  actionDesc?: string;
}

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.warn(`Attempt ${i + 1}/${retries} failed for ${url}:`, error);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // Exponential backoff
    }
  }
}

async function fetchBillList(congress: number, type: string, limit: number): Promise<CongressBill[]> {
  const url = `${BASE_URL}/bill/${congress}/${type}?format=json&limit=${limit}&api_key=${API_KEY}`;
  console.log(`Fetching ${type.toUpperCase()} bills from Congress ${congress}...`);
  
  const data = await fetchWithRetry(url);
  return data.bills || [];
}

async function fetchBillDetails(congress: number, type: string, number: string): Promise<CongressBill | null> {
  const url = `${BASE_URL}/bill/${congress}/${type}/${number}?format=json&api_key=${API_KEY}`;
  
  try {
    const data = await fetchWithRetry(url);
    return data.bill || null;
  } catch (error) {
    console.warn(`Failed to fetch details for ${type}${number}:`, error);
    return null;
  }
}

async function fetchBillSummary(congress: number, type: string, number: string): Promise<string | null> {
  const url = `${BASE_URL}/bill/${congress}/${type}/${number}/summaries?format=json&api_key=${API_KEY}`;
  
  try {
    const data = await fetchWithRetry(url);
    const summaries = data.summaries || [];
    if (summaries.length === 0) return null;
    
    // Get the most recent summary
    const latest = summaries[0] as BillSummary;
    return latest.text || null;
  } catch (error) {
    console.warn(`Failed to fetch summary for ${type}${number}:`, error);
    return null;
  }
}

async function fetchBillText(congress: number, type: string, number: string): Promise<string | null> {
  const url = `${BASE_URL}/bill/${congress}/${type}/${number}/text?format=json&api_key=${API_KEY}`;
  
  try {
    const data = await fetchWithRetry(url);
    const textVersions = data.textVersions || [];
    if (textVersions.length === 0) return null;
    
    // Get the introduced version if available
    const introduced = textVersions.find((v: any) => v.type === 'Introduced in House' || v.type === 'Introduced in Senate');
    const version = introduced || textVersions[0];
    
    // Fetch the actual text
    if (version.formats) {
      const txtFormat = version.formats.find((f: any) => f.type === 'Formatted Text');
      if (txtFormat?.url) {
        const textResponse = await fetch(txtFormat.url);
        return await textResponse.text();
      }
    }
    
    return null;
  } catch (error) {
    console.warn(`Failed to fetch text for ${type}${number}:`, error);
    return null;
  }
}

function mapCommitteeToMoltGov(committeeName: string): string {
  const mapping: Record<string, string> = {
    'agriculture': 'agriculture',
    'appropriations': 'appropriations',
    'armed services': 'defense',
    'budget': 'budget',
    'education': 'education',
    'energy': 'energy',
    'commerce': 'commerce',
    'financial services': 'finance',
    'foreign affairs': 'foreign_affairs',
    'homeland security': 'homeland_security',
    'judiciary': 'judiciary',
    'natural resources': 'natural_resources',
    'oversight': 'oversight',
    'rules': 'rules',
    'science': 'science',
    'small business': 'small_business',
    'transportation': 'transportation',
    'veterans': 'veterans',
    'ways and means': 'finance',
    'intelligence': 'intelligence',
  };
  
  const lower = committeeName.toLowerCase();
  for (const [key, value] of Object.entries(mapping)) {
    if (lower.includes(key)) return value;
  }
  
  return 'general';
}

function cleanSummary(summary: string | null): string {
  if (!summary) return 'No summary available.';
  
  // Remove HTML tags
  let clean = summary.replace(/<[^>]*>/g, '');
  
  // Remove excessive whitespace
  clean = clean.replace(/\s+/g, ' ').trim();
  
  // Truncate to reasonable length
  if (clean.length > 500) {
    clean = clean.slice(0, 497) + '...';
  }
  
  return clean;
}

function cleanFullText(text: string | null): string {
  if (!text) return 'Full text not available.';
  
  // Remove HTML tags
  let clean = text.replace(/<[^>]*>/g, '\n');
  
  // Remove excessive whitespace but preserve paragraphs
  clean = clean.replace(/\n\s*\n\s*\n/g, '\n\n').trim();
  
  // Truncate to reasonable length (10KB)
  if (clean.length > 10000) {
    clean = clean.slice(0, 9997) + '...';
  }
  
  return clean;
}

async function main() {
  if (!API_KEY) {
    console.error('ERROR: CONGRESS_API_KEY environment variable not set.');
    console.error('Get a free API key at: https://api.congress.gov/sign-up');
    process.exit(1);
  }
  
  console.log('Congress.gov Bill Scraper');
  console.log('=========================\n');
  
  const allBills: any[] = [];
  
  for (const billType of BILL_TYPES) {
    console.log(`\nFetching ${billType.toUpperCase()} bills...`);
    
    const billList = await fetchBillList(CONGRESS_NUMBER, billType, BILLS_PER_TYPE);
    console.log(`Found ${billList.length} bills`);
    
    for (let i = 0; i < Math.min(billList.length, BILLS_PER_TYPE); i++) {
      const bill = billList[i];
      const billNumber = bill.number;
      
      console.log(`  [${i + 1}/${BILLS_PER_TYPE}] Fetching ${billType}${billNumber}...`);
      
      // Fetch detailed info
      const details = await fetchBillDetails(CONGRESS_NUMBER, billType, billNumber);
      if (!details) continue;
      
      // Fetch summary (optional, can be slow)
      const summary = await fetchBillSummary(CONGRESS_NUMBER, billType, billNumber);
      
      // Map to Agora Bench format
      const sponsor = details.sponsors?.[0];
      const committee = details.committees?.[0];
      
      const moltBill = {
        externalId: `congress-${CONGRESS_NUMBER}-${billType}-${billNumber}`,
        title: details.title || `${billType.toUpperCase()} ${billNumber}`,
        summary: cleanSummary(summary),
        fullText: `[Real bill from ${CONGRESS_NUMBER}th Congress]\n\n${details.title}\n\nIntroduced: ${details.introducedDate}\n\nSponsor: ${sponsor ? `${sponsor.firstName} ${sponsor.lastName} (${sponsor.party}-${sponsor.state})` : 'Unknown'}\n\nCosponsors: ${details.cosponsors?.count || 0}\n\nPolicy Area: ${details.policyArea?.name || 'General'}\n\nLatest Action: ${details.latestAction?.text || 'No recent action'}`,
        committee: committee ? mapCommitteeToMoltGov(committee.name) : 'general',
        policyArea: details.policyArea?.name || 'General Legislation',
        introducedDate: details.introducedDate,
        sponsorInfo: sponsor ? {
          name: `${sponsor.firstName} ${sponsor.lastName}`,
          party: sponsor.party,
          state: sponsor.state,
        } : null,
        cosponsorCount: details.cosponsors?.count || 0,
      };
      
      allBills.push(moltBill);
      
      // Rate limiting: Congress.gov allows 5000 requests/hour
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  // Save to file
  const outputPath = path.join(process.cwd(), 'scripts', 'congress-bills.json');
  fs.writeFileSync(outputPath, JSON.stringify(allBills, null, 2));
  
  console.log(`\n✅ Successfully scraped ${allBills.length} bills`);
  console.log(`📄 Saved to: ${outputPath}`);
  console.log('\nNext steps:');
  console.log('1. Review the JSON file');
  console.log('2. Import into your database using a seed script');
  console.log('3. Assign bills to your AI agents as sponsors');
}

main().catch(console.error);
