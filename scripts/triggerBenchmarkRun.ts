/**
 * Trigger a benchmark run directly (bypasses HTTP auth).
 * Usage: npx tsx scripts/triggerBenchmarkRun.ts [scenarioId] [modelName]
 */
import crypto from 'node:crypto';
import { db } from '../src/core/db/connection.js';
import { benchmarkRuns } from '../src/core/db/schema/index.js';
import { benchmarkQueue } from '../src/modules/benchmark/server/jobs/benchmarkJob.js';

async function main() {
  const scenarioId = process.argv[2] || 'baseline-governance';
  const modelName = process.argv[3] || 'agora-agent';
  const modelBackend = 'internal';

  const runId = crypto.randomUUID();
  const configHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ scenarioId, modelName, modelBackend, agentAssignment: 'all' }))
    .digest('hex')
    .slice(0, 16);

  await db.insert(benchmarkRuns).values({
    id: runId,
    scenarioId,
    status: 'queued',
    modelName,
    modelBackend,
    configHash,
    agentAssignment: 'all',
    triggeredBy: 'admin',
    createdAt: new Date(),
  });

  await benchmarkQueue.add({
    runId,
    scenarioId,
    modelName,
    modelBackend,
    configHash,
    agentAssignment: 'all',
    triggeredBy: 'admin',
  });

  console.log(`Benchmark run queued!`);
  console.log(`  Run ID:    ${runId}`);
  console.log(`  Scenario:  ${scenarioId}`);
  console.log(`  Model:     ${modelName}`);
  console.log(`  Backend:   ${modelBackend}`);
  console.log(`  Config:    ${configHash}`);
  console.log(`\nMonitor: curl -s http://localhost:3001/api/benchmark/results/${runId} | python3 -m json.tool`);

  // Give Bull a moment to register the job
  await new Promise((r) => setTimeout(r, 2000));
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
