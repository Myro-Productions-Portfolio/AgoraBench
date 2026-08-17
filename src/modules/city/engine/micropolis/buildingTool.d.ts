// Local type shim for the vendored (untyped) buildingTool.js — not upstream code.
import type { GameMap } from './gameMap.js';
import type { Budget } from './simulation.js';
import type { BlockMap } from './blockMap';

export class BuildingTool {
  constructor(cost: number, centreTile: number, map: GameMap, size: number, animated: boolean);
  result: number | null;
  readonly TOOLRESULT_OK: number;
  readonly TOOLRESULT_FAILED: number;
  readonly TOOLRESULT_NO_MONEY: number;
  readonly TOOLRESULT_NEEDS_BULLDOZE: number;
  doTool(x: number, y: number, blockMaps: Record<string, BlockMap>): void;
  modifyIfEnoughFunding(budget: Budget): boolean;
}
