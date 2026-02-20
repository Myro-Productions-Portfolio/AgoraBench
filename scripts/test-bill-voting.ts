#!/usr/bin/env tsx
/**
 * Test Bill Voting with Real Congress Bills
 * 
 * Demonstrates how agents vote on real legislation with proper context.
 * 
 * Usage: tsx scripts/test-bill-voting.ts
 */

import { db } from '../src/core/db/connection.js';
import { bills, agents, billVotes } from '../src/core/db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { generateAgentDecision } from '../src/core/server/services/ai.js';

async function testBillVoting() {
  console.log('Testing Bill Voting with Real Congress Bills');
  console.log('=============================================\n');
  
  // Get a real bill from the database
  const [bill] = await db
    .select()
    .from(bills)
    .where(eq(bills.status, 'floor'))
    .limit(1);
  
  if (!bill) {
    console.error('No bills at floor status. Run seed-congress-bills.ts first.');
    process.exit(1);
  }
  
  console.log(`Bill: ${bill.title}`);
  console.log(`Committee: ${bill.committee}`);
  console.log(`Summary: ${bill.summary.slice(0, 200)}...\n`);
  
  // Get an agent
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.isActive, true))
    .limit(1);
  
  if (!agent) {
    console.error('No active agents found.');
    process.exit(1);
  }
  
  console.log(`Agent: ${agent.displayName}`);
  console.log(`Alignment: ${agent.alignment}`);
  console.log(`Provider: ${agent.modelProvider || 'ollama'}\n`);
  
  // Check if already voted
  const existingVote = await db
    .select()
    .from(billVotes)
    .where(and(eq(billVotes.billId, bill.id), eq(billVotes.voterId, agent.id)))
    .limit(1);
  
  if (existingVote.length > 0) {
    console.log(`⚠️  Agent already voted: ${existingVote[0].choice}`);
    console.log('Skipping vote (no duplicate votes allowed).\n');
    return;
  }
  
  // Build voting context
  const contextMessage = 
    `Bill up for vote: "${bill.title}". ` +
    `Summary: ${bill.summary} ` +
    `Committee: ${bill.committee}. ` +
    `Your alignment: ${agent.alignment}. ` +
    `Respond with exactly this JSON: {"action":"vote","reasoning":"one sentence explaining your vote","data":{"choice":"yea"}} ` +
    `Use "yea", "nay", or "abstain" only.`;
  
  console.log('Sending to AI...\n');
  
  // Get agent decision
  const decision = await generateAgentDecision(
    {
      id: agent.id,
      displayName: agent.displayName,
      alignment: agent.alignment,
      modelProvider: agent.modelProvider,
      personality: agent.personality,
      model: agent.model,
      ownerUserId: agent.ownerUserId,
    },
    contextMessage,
    'bill_vote_test',
  );
  
  console.log('Decision:');
  console.log(`  Action: ${decision.action}`);
  console.log(`  Reasoning: ${decision.reasoning}`);
  
  if (decision.data?.choice) {
    console.log(`  Vote: ${decision.data.choice}\n`);
    
    // Record the vote
    await db.insert(billVotes).values({
      billId: bill.id,
      voterId: agent.id,
      choice: decision.data.choice as 'yea' | 'nay' | 'abstain',
    });
    
    console.log('✅ Vote recorded in database');
  } else {
    console.log('\n⚠️  No vote choice in decision data');
  }
  
  console.log('\n===========================================');
  console.log('Test complete!');
  console.log('===========================================');
}

testBillVoting()
  .catch(console.error)
  .finally(() => process.exit(0));
