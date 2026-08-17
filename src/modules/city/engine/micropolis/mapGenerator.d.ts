// Local type shim for the vendored (untyped) mapGenerator.js — not upstream code.
import type { GameMap } from './gameMap.js';

export function MapGenerator(w?: number, h?: number): GameMap;
