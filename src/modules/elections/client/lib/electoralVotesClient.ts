/**
 * Client-side Electoral College seed data for the broadcast map — 2024–2028
 * apportionment, keyed by 2-letter state abbreviation (the same keying as the
 * served stateResults/evByCandidate blocks; the map's FIPS geometry bridges
 * via FIPS_TO_STATE[fips].abbr in callers).
 *
 * Deliberate duplicate of src/core/server/lib/electoralCollege.ts — client
 * code never imports from @core/server. Keep the two in sync if apportionment
 * ever changes (next real-world change: the 2030 census).
 */

export const EV_BY_STATE: Readonly<Record<string, number>> = Object.freeze({
  AL: 9, AK: 3, AZ: 11, AR: 6, CA: 54, CO: 10, CT: 7, DE: 3, DC: 3, FL: 30,
  GA: 16, HI: 4, ID: 4, IL: 19, IN: 11, IA: 6, KS: 6, KY: 8, LA: 8, ME: 4,
  MD: 10, MA: 11, MI: 15, MN: 10, MS: 6, MO: 10, MT: 4, NE: 5, NV: 6, NH: 4,
  NJ: 14, NM: 5, NY: 28, NC: 16, ND: 3, OH: 17, OK: 7, OR: 8, PA: 19, RI: 4,
  SC: 9, SD: 3, TN: 11, TX: 40, UT: 6, VT: 3, VA: 13, WA: 12, WV: 4, WI: 10,
  WY: 3,
});

/** EVs required to win the presidency (270 of 538). */
export const EC_MAJORITY_CLIENT = 270;

/** Total electoral votes across all jurisdictions (538). */
export const EC_TOTAL_EV = Object.values(EV_BY_STATE).reduce((a, b) => a + b, 0);

/** Number of EC jurisdictions (50 states + DC) — the "N of 51 called" denominator. */
export const EC_STATE_COUNT = Object.keys(EV_BY_STATE).length;
