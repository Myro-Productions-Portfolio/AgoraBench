import { describe, expect, it } from 'vitest';
import { computeStatsDelta } from '@modules/city/server/routes/city';
import type { CityStats } from '@modules/city/engine/types';

function stats(overrides: Partial<CityStats> = {}): CityStats {
  return {
    cityTime: 96,
    year: 1902,
    month: 0,
    population: 8_540,
    cityClass: 'Town',
    cityScore: 612,
    funds: 18_250,
    cashFlow: -120,
    taxRate: 16,
    roadFunding: 1,
    fireFunding: 1,
    policeFunding: 1,
    resValve: 300,
    comValve: -50,
    indValve: 120,
    resPop: 320,
    comPop: 40,
    indPop: 47,
    totalPop: 127,
    crimeAverage: 24,
    pollutionAverage: 31,
    landValueAverage: 88,
    trafficAverage: 12,
    roadEffect: 32,
    fireEffect: 1000,
    policeEffect: 1000,
    poweredZoneCount: 18,
    unpoweredZoneCount: 2,
    ...overrides,
  };
}

describe('computeStatsDelta', () => {
  it('reports latest minus previous for the curated fields', () => {
    const previous = stats();
    const latest = stats({
      population: 8_754,
      funds: 17_130,
      cityScore: 640,
      crimeAverage: 29,
      pollutionAverage: 27,
    });
    expect(computeStatsDelta(latest, previous)).toEqual({
      population: 214,
      funds: -1_120,
      score: 28,
      crime: 5,
      pollution: -4,
    });
  });

  it('is all zeros when nothing moved', () => {
    expect(computeStatsDelta(stats(), stats())).toEqual({
      population: 0,
      funds: 0,
      score: 0,
      crime: 0,
      pollution: 0,
    });
  });
});
