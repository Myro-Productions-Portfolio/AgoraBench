/**
 * benchmarkJob.ts -- Bull queue for benchmark run execution
 *
 * Wraps BenchmarkRunner in a Bull job so benchmark runs can be
 * queued and processed asynchronously.
 */

import Bull from 'bull';
import { config } from '../../../../core/server/config.js';
import { BenchmarkRunner } from '../services/benchmarkRunner.js';
import type { RunConfig } from '../services/benchmarkRunner.js';

const benchmarkQueue = new Bull<RunConfig>('benchmark-run', config.redis.url);

benchmarkQueue.process(async (job) => {
  const runner = new BenchmarkRunner(job.data);
  await runner.execute();
});

benchmarkQueue.on('failed', (job, err) => {
  console.error(`[BenchmarkJob] Job ${job.id} failed:`, err.message);
});

benchmarkQueue.on('completed', (job) => {
  console.log(`[BenchmarkJob] Job ${job.id} completed (run: ${job.data.runId})`);
});

export { benchmarkQueue };
