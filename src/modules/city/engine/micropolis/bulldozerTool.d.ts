// Local type shim for the vendored (untyped) bulldozerTool.js — not upstream code.
import type { GameMap } from './gameMap.js';
import type { Budget } from './simulation.js';
import type { BlockMap } from './blockMap';

export class BulldozerTool {
  constructor(map: GameMap);
  result: number | null;
  readonly TOOLRESULT_OK: number;
  readonly TOOLRESULT_FAILED: number;
  readonly TOOLRESULT_NO_MONEY: number;
  readonly TOOLRESULT_NEEDS_BULLDOZE: number;
  doTool(x: number, y: number, blockMaps: Record<string, BlockMap>): void;
  modifyIfEnoughFunding(budget: Budget): boolean;
}
