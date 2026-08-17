/* eslint-disable no-console -- CLI harness; the console output is the deliverable */
/* Save/reload/resume-identical smoke harness. Run: pnpm city:smoke
 *
 * Path A: 24 months, serialize, deserialize into a fresh engine, 12 more months.
 * Path B: 36 months continuously from the same seed.
 * Asserts the two serialized end states are byte-identical. */

import { gzipSync } from 'node:zlib';
import { createCity, deserializeCity, type CityEngine } from './index';
import { buildStarterCity } from './starterCity';

const SEED = 0xa60ba;

function statsRow(label: string, engine: CityEngine): string {
  const s = engine.getState().stats;
  return [
    label.padEnd(14),
    String(s.population).padStart(6),
    String(s.funds).padStart(7),
    String(s.cityScore).padStart(5),
    `${s.resValve}/${s.comValve}/${s.indValve}`.padStart(15),
    `${s.resPop}/${s.comPop}/${s.indPop}`.padStart(11),
    String(s.crimeAverage).padStart(5),
    String(s.pollutionAverage).padStart(5),
    String(s.landValueAverage).padStart(5),
    `${s.poweredZoneCount}/${s.unpoweredZoneCount}`.padStart(7),
  ].join('  ');
}

function header(): string {
  return [
    'run/year'.padEnd(14),
    'pop'.padStart(6),
    'funds'.padStart(7),
    'score'.padStart(5),
    'R/C/I valves'.padStart(15),
    'R/C/I pop'.padStart(11),
    'crime'.padStart(5),
    'poll'.padStart(5),
    'land'.padStart(5),
    'pwr/un'.padStart(7),
  ].join('  ');
}

console.log(`Capitol City engine smoke — seed ${SEED}\n`);
console.log(header());

const a = createCity({ seed: SEED });
buildStarterCity(a);
a.tick(12);
console.log(statsRow('A year 1', a));
a.tick(12);
console.log(statsRow('A year 2', a));

const savedAt24 = a.serialize();
const b = deserializeCity(savedAt24);
b.tick(12);
console.log(statsRow('B year 3*', b) + '   (* resumed from month-24 snapshot)');

const c = createCity({ seed: SEED });
buildStarterCity(c);
c.tick(36);
console.log(statsRow('C year 3', c) + '   (continuous 36-month run)');

const endB = b.serialize();
const endC = c.serialize();

const raw = Buffer.byteLength(endB);
const gz = gzipSync(Buffer.from(endB)).byteLength;
console.log(`\nSnapshot size: ${raw} bytes raw, ${gz} bytes gzipped`);

if (endB !== endC) {
  const at = [...endB].findIndex((ch, i) => ch !== endC[i]);
  console.error(`\nDETERMINISM FAILED: serialized states differ (first diff at byte ${at})`);
  console.error(`  B: ...${endB.slice(Math.max(0, at - 60), at + 60)}...`);
  console.error(`  C: ...${endC.slice(Math.max(0, at - 60), at + 60)}...`);
  process.exit(1);
}

const finalPop = c.getState().stats.population;
if (finalPop <= 0) {
  console.error('\nSANITY FAILED: city never developed (population 0) — smoke test is vacuous');
  process.exit(1);
}

console.log('\nDETERMINISM OK: save→reload→resume state is byte-identical to the continuous run');
