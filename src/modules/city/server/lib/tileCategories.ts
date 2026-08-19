/**
 * Server-side tile encoders (docs/specs/city-effect-layer.md §2 licensing
 * posture): engine CODE never reaches the client. Masked tile ids are data,
 * not code — they ship alongside the category bytes so the browser can blit
 * the vendored tile-art sheet. Importing the GPL engine here is fine; this
 * module runs server-side.
 */

import { BIT_MASK } from '../../engine/micropolis/tileFlags';
import * as T from '../../engine/micropolis/tileValues';

/* Stable public category codes — the client palette indexes by these. */
export const TILE_CATEGORY = {
  CLEAR: 0,
  WATER: 1,
  TREES: 2,
  RUBBLE: 3,
  FLOOD: 4,
  RADIATION: 5,
  FIRE: 6,
  ROAD: 7,
  RAIL: 8,
  POWER_LINE: 9,
  RESIDENTIAL: 10,
  COMMERCIAL: 11,
  INDUSTRIAL: 12,
  SEAPORT: 13,
  AIRPORT: 14,
  COAL_POWER: 15,
  FIRE_STATION: 16,
  POLICE_STATION: 17,
  STADIUM: 18,
  NUCLEAR_POWER: 19,
  OTHER_SPECIAL: 20,
} as const;

export type TileCategory = (typeof TILE_CATEGORY)[keyof typeof TILE_CATEGORY];

/* Ranges follow tileValues.ts. The 827+ bank is animation frames drawn in
   place of building tiles, so each maps back to what it visually sits on. */
export function categorizeTile(raw: number): TileCategory {
  const id = raw & BIT_MASK;
  if (id >= T.WATER_LOW && id <= T.WATER_HIGH) return TILE_CATEGORY.WATER;
  if (id >= T.TREEBASE && id <= T.WOODS5) return TILE_CATEGORY.TREES;
  if (id >= T.RUBBLE && id <= T.LASTRUBBLE) return TILE_CATEGORY.RUBBLE;
  if (id >= T.FLOOD && id <= T.LASTFLOOD) return TILE_CATEGORY.FLOOD;
  if (id === T.RADTILE) return TILE_CATEGORY.RADIATION;
  if (id >= T.FIREBASE && id <= T.LASTFIRE) return TILE_CATEGORY.FIRE;
  if (id >= T.ROADBASE && id <= T.BRWXXX7) return TILE_CATEGORY.ROAD;
  if (id === T.RAILHPOWERV || id === T.RAILVPOWERH) return TILE_CATEGORY.RAIL;
  if (id >= T.POWERBASE && id <= T.LASTPOWER) return TILE_CATEGORY.POWER_LINE;
  if (id >= T.RAILBASE && id <= T.LASTRAIL) return TILE_CATEGORY.RAIL;
  if (id === T.ROADVPOWERH) return TILE_CATEGORY.ROAD;
  if (id >= T.RESBASE && id < T.HOSPITALBASE) return TILE_CATEGORY.RESIDENTIAL;
  if (id >= T.HOSPITALBASE && id < T.COMBASE) return TILE_CATEGORY.OTHER_SPECIAL; // hospital + church
  if (id >= T.COMBASE && id < T.INDBASE) return TILE_CATEGORY.COMMERCIAL;
  if (id >= T.INDBASE && id < T.PORTBASE) return TILE_CATEGORY.INDUSTRIAL;
  if (id >= T.PORTBASE && id <= T.LASTPORT) return TILE_CATEGORY.SEAPORT;
  if (id >= T.AIRPORTBASE && id < T.COALBASE) return TILE_CATEGORY.AIRPORT;
  if (id >= T.COALBASE && id <= T.LASTPOWERPLANT) return TILE_CATEGORY.COAL_POWER;
  if (id >= T.FIRESTBASE && id < T.POLICESTBASE) return TILE_CATEGORY.FIRE_STATION;
  if (id >= T.POLICESTBASE && id < T.STADIUMBASE) return TILE_CATEGORY.POLICE_STATION;
  if (id >= T.STADIUMBASE && id <= 810) return TILE_CATEGORY.STADIUM; // incl. FULLSTADIUM
  if (id >= T.NUCLEARBASE && id <= T.LASTZONE) return TILE_CATEGORY.NUCLEAR_POWER;
  if (id >= T.HBRDG0 && id < T.RADAR0) return TILE_CATEGORY.ROAD; // opening bridge
  if (id >= T.RADAR0 && id <= T.RADAR7) return TILE_CATEGORY.AIRPORT; // rotating radar
  if (id >= T.FOUNTAIN && id < T.INDBASE2) return TILE_CATEGORY.TREES; // park fountain
  if (id >= T.INDBASE2 && id < T.TINYEXP) return TILE_CATEGORY.INDUSTRIAL; // smokestack anim
  if (id >= T.TINYEXP && id <= T.TINYEXPLAST) return TILE_CATEGORY.FIRE; // explosions
  if (id >= T.COALSMOKE1 && id < T.FOOTBALLGAME1) return TILE_CATEGORY.COAL_POWER;
  if (id >= T.FOOTBALLGAME1 && id < T.VBRDG0) return TILE_CATEGORY.STADIUM;
  if (id >= T.VBRDG0 && id <= T.VBRDG3) return TILE_CATEGORY.ROAD;
  if (id >= T.NUKESWIRL1 && id <= T.NUKESWIRL4) return TILE_CATEGORY.RADIATION; // meltdown
  if (id >= T.CHURCH1BASE && id <= T.CHURCH7LAST) return TILE_CATEGORY.OTHER_SPECIAL;
  if (id >= T.RESBASE) return TILE_CATEGORY.OTHER_SPECIAL; // lightning bolt + misc anim gaps
  return TILE_CATEGORY.CLEAR; // DIRT + unused low ids
}

/** One category byte per tile, row-major (index = y * width + x), base64. */
export function encodeTileCategories(tiles: number[]): string {
  const out = new Uint8Array(tiles.length);
  for (let i = 0; i < tiles.length; i++) out[i] = categorizeTile(tiles[i]);
  return Buffer.from(out).toString('base64');
}

/** Raw tile ids masked to 0-1023 (flag bits stripped), one little-endian
    uint16 per tile, row-major, base64. LE is the wire contract the client
    decoder relies on. */
export function encodeTileIds(tiles: number[]): string {
  const buf = Buffer.alloc(tiles.length * 2);
  for (let i = 0; i < tiles.length; i++) buf.writeUInt16LE(tiles[i] & BIT_MASK, i * 2);
  return buf.toString('base64');
}
