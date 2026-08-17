/* Headless wrapper around the vendored micropolisJS core (GPL-3.0, server-side only —
 * must never be imported by client code). See PROVENANCE.md and ENGINE-NOTES.md. */

import { BuildingTool } from './micropolis/buildingTool.js';
import { BulldozerTool } from './micropolis/bulldozerTool.js';
import { GameMap } from './micropolis/gameMap.js';
import { MapGenerator } from './micropolis/mapGenerator.js';
import { ParkTool } from './micropolis/parkTool.js';
import { RailTool } from './micropolis/railTool.js';
import { Random } from './micropolis/random';
import { RoadTool } from './micropolis/roadTool.js';
import { Simulation } from './micropolis/simulation.js';
import { Tile } from './micropolis/tile';
import { ALLBITS, BIT_MASK } from './micropolis/tileFlags';
import * as TileValues from './micropolis/tileValues';
import { WireTool } from './micropolis/wireTool.js';
import type {
  BuildResult,
  BuildToolName,
  CityKnobs,
  CityState,
  CityStats,
  CreateCityOptions,
} from './types';

export type { BuildResult, BuildToolName, CityKnobs, CityState, CityStats, CreateCityOptions };

/* One city month = 4 cityTime units = 4 full 16-phase simulation cycles. */
const FRAMES_PER_MONTH = 64;
const SNAPSHOT_VERSION = 1;
const DEFAULT_WIDTH = 120;
const DEFAULT_HEIGHT = 100;

const SIM_PROPS = [
  '_cityMonthLast',
  '_cityPopLast',
  '_cityTime',
  '_cityYearLast',
  '_gameLevel',
  '_messageLast',
  '_phaseCycle',
  '_simCycle',
  '_speed',
  '_startingYear',
  '_comLast',
  '_indLast',
  '_resLast',
] as const;

const SPRITE_SKIP_KEYS = new Set(['map', 'spriteManager', 'worldX', 'worldY']);

function sweepOwn(obj: object, skip?: Set<string>): Record<string, unknown> {
  const source = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (skip?.has(key)) continue;
    const value = source[key];
    if (typeof value === 'function') continue;
    out[key] = value === undefined ? undefined : structuredClone(value);
  }
  return out;
}

function restoreSweep(obj: object, snapshot: Record<string, unknown>): void {
  const target = obj as Record<string, unknown>;
  for (const key of Object.keys(snapshot)) {
    target[key] = structuredClone(snapshot[key]);
  }
}

function blockMapData(bm: object): number[] {
  return (bm as unknown as { data: number[] }).data;
}

interface Snapshot {
  v: number;
  prng: number;
  hasTicked: boolean;
  sim: Record<string, unknown>;
  map: {
    width: number;
    height: number;
    cityCentreX: number;
    cityCentreY: number;
    pollutionMaxX: number;
    pollutionMaxY: number;
    tiles: number[];
  };
  blockMaps: Record<string, number[]>;
  powerGrid: number[];
  census: Record<string, unknown>;
  valves: Record<string, unknown>;
  budget: Record<string, unknown>;
  evaluation: Record<string, unknown>;
  disasters: { disastersEnabled: boolean; floodCount: number };
  sprites: { cycle: number; list: Record<string, unknown>[] };
}

export class CityEngine {
  private readonly map: GameMap;
  private readonly sim: Simulation;
  private readonly tools: Record<BuildToolName, BuildingTool | RoadTool>;

  private constructor(map: GameMap, gameLevel?: number, speed?: number) {
    this.map = map;
    this.sim = new Simulation(
      map,
      gameLevel ?? Simulation.LEVEL_EASY,
      speed ?? Simulation.SPEED_SLOW
    );
    this.tools = {
      airport: new BuildingTool(10000, TileValues.AIRPORT, map, 6, false),
      bulldozer: new BulldozerTool(map),
      coal: new BuildingTool(3000, TileValues.POWERPLANT, map, 4, false),
      commercial: new BuildingTool(100, TileValues.COMCLR, map, 3, false),
      fire: new BuildingTool(500, TileValues.FIRESTATION, map, 3, false),
      industrial: new BuildingTool(100, TileValues.INDCLR, map, 3, false),
      nuclear: new BuildingTool(5000, TileValues.NUCLEAR, map, 4, true),
      park: new ParkTool(map),
      police: new BuildingTool(500, TileValues.POLICESTATION, map, 3, false),
      port: new BuildingTool(3000, TileValues.PORT, map, 4, false),
      rail: new RailTool(map),
      residential: new BuildingTool(100, TileValues.FREEZ, map, 3, false),
      road: new RoadTool(map),
      stadium: new BuildingTool(5000, TileValues.STADIUM, map, 4, false),
      wire: new WireTool(map),
    };
  }

  static create(options: CreateCityOptions): CityEngine {
    Random.seedRandom(options.seed);
    let map: GameMap;
    if (options.map) {
      map = new GameMap(options.map.width, options.map.height);
      restoreTiles(map, options.map.tiles);
    } else {
      map = MapGenerator(DEFAULT_WIDTH, DEFAULT_HEIGHT);
    }
    return new CityEngine(map);
  }

  static deserialize(serialized: string): CityEngine {
    const snap = JSON.parse(serialized) as Snapshot;
    if (snap.v !== SNAPSHOT_VERSION) {
      throw new Error(`Unsupported city snapshot version ${snap.v}`);
    }

    /* Construct around a blank map, then overwrite every piece of mutable state.
       Construction-time scans over blank DIRT consume no PRNG draws and spawn no
       sprites, so nothing from construction survives into the restored state. */
    const map = new GameMap(snap.map.width, snap.map.height);
    const engine = new CityEngine(map, snap.sim._gameLevel as number, snap.sim._speed as number);
    const sim = engine.sim;

    restoreTiles(map, snap.map.tiles);
    map.cityCentreX = snap.map.cityCentreX;
    map.cityCentreY = snap.map.cityCentreY;
    map.pollutionMaxX = snap.map.pollutionMaxX;
    map.pollutionMaxY = snap.map.pollutionMaxY;

    restoreSweep(sim, snap.sim);
    for (const [name, data] of Object.entries(snap.blockMaps)) {
      blockMapData(sim.blockMaps[name]).splice(0, Infinity, ...data);
    }
    blockMapData(sim._powerManager.powerGridMap).splice(0, Infinity, ...snap.powerGrid);
    restoreSweep(sim._census, snap.census);
    restoreSweep(sim._valves, snap.valves);
    restoreSweep(sim.budget, snap.budget);
    restoreSweep(sim.evaluation, snap.evaluation);
    sim.disasterManager.disastersEnabled = snap.disasters.disastersEnabled;
    sim.disasterManager._floodCount = snap.disasters.floodCount;

    sim.spriteManager.spriteList.length = 0;
    sim.spriteManager.spriteCycle = snap.sprites.cycle;
    for (const spriteSnap of snap.sprites.list) {
      const sprite = sim.spriteManager.makeSprite(
        spriteSnap.type as number,
        spriteSnap.x as number,
        spriteSnap.y as number
      );
      restoreSweep(sprite, spriteSnap);
    }

    if (snap.hasTicked) sim._skipInitialEvaluation();
    Random.setRandomState(snap.prng);
    return engine;
  }

  tick(months: number = 1): void {
    const frames = months * FRAMES_PER_MONTH;
    for (let i = 0; i < frames; i++) {
      /* Defeat the wall-clock frame throttle in _simFrame. */
      this.sim._lastTickTime = -1;
      this.sim.simTick();
      /* Headless stand-in for the budget window: when the engine asks for user
         budget confirmation, confirm immediately with the current funding levels. */
      if (this.sim.budget.awaitingValues) {
        this.sim.budget.doBudgetWindow();
      }
    }
  }

  build(tool: BuildToolName, x: number, y: number): BuildResult {
    const t = this.tools[tool];
    t.doTool(x, y, this.sim.blockMaps);
    const applied = t.modifyIfEnoughFunding(this.sim.budget);
    return { ok: applied, result: t.result ?? t.TOOLRESULT_FAILED };
  }

  setKnobs(knobs: CityKnobs): void {
    const budget = this.sim.budget;
    if (knobs.taxRate !== undefined) {
      budget.setTax(clamp(Math.round(knobs.taxRate), 0, 20));
    }
    if (knobs.roadFunding !== undefined) budget.roadPercent = clamp(knobs.roadFunding, 0, 1);
    if (knobs.fireFunding !== undefined) budget.firePercent = clamp(knobs.fireFunding, 0, 1);
    if (knobs.policeFunding !== undefined) budget.policePercent = clamp(knobs.policeFunding, 0, 1);
    if (knobs.disastersEnabled !== undefined) {
      this.sim.disasterManager.disastersEnabled = knobs.disastersEnabled;
    }
  }

  getState(): CityState {
    const sim = this.sim;
    const census = sim._census;
    const budget = sim.budget;
    const stats: CityStats = {
      cityTime: sim._cityTime,
      year: Math.floor(sim._cityTime / 48) + 1900,
      month: (sim._cityTime % 48) >> 2,
      population: sim.evaluation.cityPop,
      cityClass: sim.evaluation.cityClass,
      cityScore: sim.evaluation.cityScore,
      funds: budget.totalFunds,
      cashFlow: budget.cashFlow,
      taxRate: budget.cityTax,
      roadFunding: budget.roadPercent,
      fireFunding: budget.firePercent,
      policeFunding: budget.policePercent,
      resValve: sim._valves.resValve,
      comValve: sim._valves.comValve,
      indValve: sim._valves.indValve,
      resPop: census.resPop,
      comPop: census.comPop,
      indPop: census.indPop,
      totalPop: census.totalPop,
      crimeAverage: census.crimeAverage,
      pollutionAverage: census.pollutionAverage,
      landValueAverage: census.landValueAverage,
      trafficAverage: census.trafficAverage ?? 0,
      roadEffect: budget.roadEffect,
      fireEffect: budget.fireEffect,
      policeEffect: budget.policeEffect,
      poweredZoneCount: census.poweredZoneCount,
      unpoweredZoneCount: census.unpoweredZoneCount,
    };
    return {
      width: this.map.width,
      height: this.map.height,
      tiles: this.map._data.map((t) => t.getRawValue()),
      stats,
    };
  }

  serialize(): string {
    const sim = this.sim;
    if (sim._phaseCycle !== 0) {
      throw new Error('serialize() must be called on a month boundary (mid-cycle state is not captured)');
    }
    const simSnap: Record<string, unknown> = {};
    for (const prop of SIM_PROPS) {
      simSnap[prop] = (sim as unknown as Record<string, unknown>)[prop];
    }
    const blockMaps: Record<string, number[]> = {};
    for (const name of Object.keys(sim.blockMaps).sort()) {
      blockMaps[name] = blockMapData(sim.blockMaps[name]).slice();
    }
    const snap: Snapshot = {
      v: SNAPSHOT_VERSION,
      prng: Random.getRandomState(),
      hasTicked: Object.prototype.hasOwnProperty.call(sim, '_simulate'),
      sim: simSnap,
      map: {
        width: this.map.width,
        height: this.map.height,
        cityCentreX: this.map.cityCentreX,
        cityCentreY: this.map.cityCentreY,
        pollutionMaxX: this.map.pollutionMaxX,
        pollutionMaxY: this.map.pollutionMaxY,
        tiles: this.map._data.map((t) => t.getRawValue()),
      },
      blockMaps,
      powerGrid: blockMapData(sim._powerManager.powerGridMap).slice(),
      census: sweepOwn(sim._census),
      valves: sweepOwn(sim._valves),
      budget: sweepOwn(sim.budget),
      evaluation: sweepOwn(sim.evaluation),
      disasters: {
        disastersEnabled: sim.disasterManager.disastersEnabled,
        floodCount: sim.disasterManager._floodCount,
      },
      sprites: {
        cycle: sim.spriteManager.spriteCycle,
        list: sim.spriteManager.spriteList.map((s) => sweepOwn(s, SPRITE_SKIP_KEYS)),
      },
    };
    return JSON.stringify(snap);
  }
}

function restoreTiles(map: GameMap, tiles: number[]): void {
  for (let i = 0; i < tiles.length; i++) {
    map._data[i] = new Tile(tiles[i] & BIT_MASK, tiles[i] & ALLBITS);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createCity(options: CreateCityOptions): CityEngine {
  return CityEngine.create(options);
}

export function deserializeCity(serialized: string): CityEngine {
  return CityEngine.deserialize(serialized);
}
