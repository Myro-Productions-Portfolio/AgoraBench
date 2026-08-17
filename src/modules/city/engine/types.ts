export interface CityKnobs {
  /** City tax rate, integer 0-20. Engine default 7. */
  taxRate?: number;
  /** Desired road/rail maintenance funding level, 0-1. Re-normalized by affordability each January. */
  roadFunding?: number;
  /** Desired fire station funding level, 0-1. */
  fireFunding?: number;
  /** Desired police station funding level, 0-1. */
  policeFunding?: number;
  /** Random disasters (fire/flood/tornado/monster). Engine default off. */
  disastersEnabled?: boolean;
}

export type BuildToolName =
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'coal'
  | 'nuclear'
  | 'police'
  | 'fire'
  | 'stadium'
  | 'port'
  | 'airport'
  | 'road'
  | 'rail'
  | 'wire'
  | 'park'
  | 'bulldozer';

export interface BuildResult {
  ok: boolean;
  /** One of TOOLRESULT_OK(0) / FAILED(1) / NO_MONEY(2) / NEEDS_BULLDOZE(3). */
  result: number;
}

export interface CityStats {
  cityTime: number;
  year: number;
  month: number;
  population: number;
  cityClass: string;
  cityScore: number;
  funds: number;
  cashFlow: number;
  taxRate: number;
  roadFunding: number;
  fireFunding: number;
  policeFunding: number;
  resValve: number;
  comValve: number;
  indValve: number;
  resPop: number;
  comPop: number;
  indPop: number;
  totalPop: number;
  crimeAverage: number;
  pollutionAverage: number;
  landValueAverage: number;
  trafficAverage: number;
  roadEffect: number;
  fireEffect: number;
  policeEffect: number;
  poweredZoneCount: number;
  unpoweredZoneCount: number;
}

export interface CityState {
  width: number;
  height: number;
  /** Raw tile values: bits 0-9 tile id, bits 10-15 flags (ZONE/ANIM/BULL/BURN/COND/POWER). */
  tiles: number[];
  stats: CityStats;
}

export interface CreateCityOptions {
  seed: number;
  /** Optional pre-built terrain; omitted = seeded MapGenerator terrain (120x100). */
  map?: { width: number; height: number; tiles: number[] };
}
