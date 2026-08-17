// Local type shim for the vendored (untyped) simulation.js — not upstream code.
// Only the surface the engine wrapper touches is typed.
import type { GameMap } from './gameMap.js';
import type { BlockMap } from './blockMap';

export interface Budget {
  totalFunds: number;
  cityTax: number;
  cashFlow: number;
  taxFund: number;
  roadPercent: number;
  firePercent: number;
  policePercent: number;
  roadEffect: number;
  fireEffect: number;
  policeEffect: number;
  autoBudget: boolean;
  awaitingValues: boolean;
  doBudgetWindow(): void;
  setTax(amount: number): void;
  setFunds(amount: number): void;
}

export interface Census {
  totalPop: number;
  resPop: number;
  comPop: number;
  indPop: number;
  crimeAverage: number;
  pollutionAverage: number;
  landValueAverage: number;
  trafficAverage?: number;
  poweredZoneCount: number;
  unpoweredZoneCount: number;
}

export interface Valves {
  resValve: number;
  comValve: number;
  indValve: number;
  resCap: boolean;
  comCap: boolean;
  indCap: boolean;
}

export interface Evaluation {
  cityPop: number;
  cityClass: string;
  cityScore: number;
  cityYes: number;
}

export interface SpriteManager {
  spriteList: object[];
  spriteCycle: number;
  makeSprite(type: number, x: number, y: number): object;
}

export interface DisasterManager {
  disastersEnabled: boolean;
  _floodCount: number;
}

export interface PowerManager {
  powerGridMap: BlockMap;
}

export class Simulation {
  constructor(map: GameMap, gameLevel: number, speed: number, savedGame?: unknown);
  static readonly LEVEL_EASY: number;
  static readonly LEVEL_MED: number;
  static readonly LEVEL_HARD: number;
  static readonly SPEED_PAUSED: number;
  static readonly SPEED_SLOW: number;
  static readonly SPEED_MED: number;
  static readonly SPEED_FAST: number;
  budget: Budget;
  evaluation: Evaluation;
  spriteManager: SpriteManager;
  disasterManager: DisasterManager;
  blockMaps: Record<string, BlockMap>;
  _map: GameMap;
  _census: Census;
  _valves: Valves;
  _powerManager: PowerManager;
  _phaseCycle: number;
  _simCycle: number;
  _cityTime: number;
  _lastTickTime: number | Date;
  simTick(): void;
  _skipInitialEvaluation(): void;
}
