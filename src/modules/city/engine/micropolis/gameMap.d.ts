// Local type shim for the vendored (untyped) gameMap.js — not upstream code.
import type { Tile } from './tile';

export class GameMap {
  constructor(width?: number, height?: number, defaultValue?: number);
  width: number;
  height: number;
  cityCentreX: number;
  cityCentreY: number;
  pollutionMaxX: number;
  pollutionMaxY: number;
  _data: Tile[];
  getTile(x: number, y: number): Tile;
  getTileValue(x: number, y: number): number;
  setTileValue(x: number, y: number, value: number): void;
  testBounds(x: number, y: number): boolean;
}
