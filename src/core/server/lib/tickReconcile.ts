/** Pure decision logic for reconciling Bull repeatable tick jobs against config. */

export interface RepeatableJobInfo {
  key: string;
  every: number;
}

/** Repeatable job keys whose interval no longer matches the configured interval. */
export function staleRepeatableKeys(jobs: RepeatableJobInfo[], configuredIntervalMs: number): string[] {
  return jobs.filter((job) => job.every !== configuredIntervalMs).map((job) => job.key);
}
