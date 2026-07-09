/**
 * Electoral College seed data (office-selection fidelity, Slice 4).
 *
 * Real 2024–2028 apportionment: each state's electoral votes = House seats + 2
 * senators, DC gets 3 (23rd Amendment). Total = 538; 270 to win. Sourced from
 * the National Archives 2024 EC allocation
 * (https://www.archives.gov/electoral-college/allocation).
 *
 * This is a static data seed, not a DB table: voter→state assignment is a pure
 * deterministic hash of agentId (electionMath.assignVoterState), so the EC
 * layer needs no `agents.state` column, no migration, and no backfill. Dead
 * weight until RuntimeConfig.electoralCollegeEnabled flips true.
 */

/** state code → electoral votes (538 total). */
export const ELECTORAL_VOTES: Readonly<Record<string, number>> = Object.freeze({
  AL: 9, AK: 3, AZ: 11, AR: 6, CA: 54, CO: 10, CT: 7, DE: 3, DC: 3, FL: 30,
  GA: 16, HI: 4, ID: 4, IL: 19, IN: 11, IA: 6, KS: 6, KY: 8, LA: 8, ME: 4,
  MD: 10, MA: 11, MI: 15, MN: 10, MS: 6, MO: 10, MT: 4, NE: 5, NV: 6, NH: 4,
  NJ: 14, NM: 5, NY: 28, NC: 16, ND: 3, OH: 17, OK: 7, OR: 8, PA: 19, RI: 4,
  SC: 9, SD: 3, TN: 11, TX: 40, UT: 6, VT: 3, VA: 13, WA: 12, WV: 4, WI: 10,
  WY: 3,
});

/** Fixed iteration order (alphabetical) for deterministic state assignment. */
export const STATE_ORDER: readonly string[] = Object.freeze(
  Object.keys(ELECTORAL_VOTES).sort(),
);

/** EVs required to win the presidency (270 of 538). */
export const EC_MAJORITY = 270;
