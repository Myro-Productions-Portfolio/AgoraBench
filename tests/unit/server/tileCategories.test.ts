import { describe, expect, it } from 'vitest';
import {
  categorizeTile,
  encodeTileCategories,
  TILE_CATEGORY,
} from '@modules/city/server/lib/tileCategories';
/* Engine imports are fine here: this is server/test code (spec §2 — GPL never
   enters the client bundle; tests are not bundled). */
import { ANIMBIT, CONDBIT, POWERBIT, ZONEBIT } from '@modules/city/engine/micropolis/tileFlags';
import * as T from '@modules/city/engine/micropolis/tileValues';

describe('categorizeTile — terrain and disaster tiles', () => {
  it('maps clear/dirt and unused low ids to CLEAR', () => {
    expect(categorizeTile(T.DIRT)).toBe(TILE_CATEGORY.CLEAR);
    expect(categorizeTile(1)).toBe(TILE_CATEGORY.CLEAR);
    expect(categorizeTile(T.UNUSED_TRASH3)).toBe(TILE_CATEGORY.CLEAR);
  });

  it('maps the water band', () => {
    expect(categorizeTile(T.RIVER)).toBe(TILE_CATEGORY.WATER);
    expect(categorizeTile(T.CHANNEL)).toBe(TILE_CATEGORY.WATER);
    expect(categorizeTile(T.LASTRIVEDGE)).toBe(TILE_CATEGORY.WATER);
  });

  it('maps woods and park fountains to TREES', () => {
    expect(categorizeTile(T.TREEBASE)).toBe(TILE_CATEGORY.TREES);
    expect(categorizeTile(T.WOODS)).toBe(TILE_CATEGORY.TREES);
    expect(categorizeTile(T.WOODS5)).toBe(TILE_CATEGORY.TREES);
    expect(categorizeTile(T.FOUNTAIN)).toBe(TILE_CATEGORY.TREES);
  });

  it('maps rubble, flood, radiation, and fire', () => {
    expect(categorizeTile(T.RUBBLE)).toBe(TILE_CATEGORY.RUBBLE);
    expect(categorizeTile(T.LASTRUBBLE)).toBe(TILE_CATEGORY.RUBBLE);
    expect(categorizeTile(T.FLOOD)).toBe(TILE_CATEGORY.FLOOD);
    expect(categorizeTile(T.LASTFLOOD)).toBe(TILE_CATEGORY.FLOOD);
    expect(categorizeTile(T.RADTILE)).toBe(TILE_CATEGORY.RADIATION);
    expect(categorizeTile(T.NUKESWIRL1)).toBe(TILE_CATEGORY.RADIATION);
    expect(categorizeTile(T.FIRE)).toBe(TILE_CATEGORY.FIRE);
    expect(categorizeTile(T.LASTFIRE)).toBe(TILE_CATEGORY.FIRE);
    expect(categorizeTile(T.TINYEXP)).toBe(TILE_CATEGORY.FIRE);
  });
});

describe('categorizeTile — networks', () => {
  it('maps the full road band including traffic and bridge animation tiles', () => {
    expect(categorizeTile(T.HBRIDGE)).toBe(TILE_CATEGORY.ROAD);
    expect(categorizeTile(T.ROADS)).toBe(TILE_CATEGORY.ROAD);
    expect(categorizeTile(T.INTERSECTION)).toBe(TILE_CATEGORY.ROAD);
    expect(categorizeTile(T.HROADPOWER)).toBe(TILE_CATEGORY.ROAD);
    expect(categorizeTile(T.LTRFBASE)).toBe(TILE_CATEGORY.ROAD);
    expect(categorizeTile(T.HTRFBASE)).toBe(TILE_CATEGORY.ROAD);
    expect(categorizeTile(T.LASTROAD)).toBe(TILE_CATEGORY.ROAD);
    expect(categorizeTile(T.ROADVPOWERH)).toBe(TILE_CATEGORY.ROAD);
    expect(categorizeTile(T.HBRDG0)).toBe(TILE_CATEGORY.ROAD);
    expect(categorizeTile(T.VBRDG3)).toBe(TILE_CATEGORY.ROAD);
  });

  it('maps power lines, with rail-power crossings counting as rail', () => {
    expect(categorizeTile(T.HPOWER)).toBe(TILE_CATEGORY.POWER_LINE);
    expect(categorizeTile(T.LVPOWER10)).toBe(TILE_CATEGORY.POWER_LINE);
    expect(categorizeTile(T.RAILHPOWERV)).toBe(TILE_CATEGORY.RAIL);
    expect(categorizeTile(T.RAILVPOWERH)).toBe(TILE_CATEGORY.RAIL);
  });

  it('maps the rail band including rail-road crossings', () => {
    expect(categorizeTile(T.HRAIL)).toBe(TILE_CATEGORY.RAIL);
    expect(categorizeTile(T.LVRAIL10)).toBe(TILE_CATEGORY.RAIL);
    expect(categorizeTile(T.HRAILROAD)).toBe(TILE_CATEGORY.RAIL);
    expect(categorizeTile(T.LASTRAIL)).toBe(TILE_CATEGORY.RAIL);
  });
});

describe('categorizeTile — zones and buildings', () => {
  it('maps the residential band, with hospitals/churches as OTHER_SPECIAL', () => {
    expect(categorizeTile(T.RESBASE)).toBe(TILE_CATEGORY.RESIDENTIAL);
    expect(categorizeTile(T.FREEZ)).toBe(TILE_CATEGORY.RESIDENTIAL);
    expect(categorizeTile(T.HOUSE)).toBe(TILE_CATEGORY.RESIDENTIAL);
    expect(categorizeTile(T.RZB)).toBe(TILE_CATEGORY.RESIDENTIAL);
    expect(categorizeTile(T.HOSPITAL)).toBe(TILE_CATEGORY.OTHER_SPECIAL);
    expect(categorizeTile(T.CHURCH)).toBe(TILE_CATEGORY.OTHER_SPECIAL);
    expect(categorizeTile(T.CHURCH7LAST)).toBe(TILE_CATEGORY.OTHER_SPECIAL);
  });

  it('maps commercial and industrial bands including smokestack animation', () => {
    expect(categorizeTile(T.COMBASE)).toBe(TILE_CATEGORY.COMMERCIAL);
    expect(categorizeTile(T.COMCLR)).toBe(TILE_CATEGORY.COMMERCIAL);
    expect(categorizeTile(T.CZB)).toBe(TILE_CATEGORY.COMMERCIAL);
    expect(categorizeTile(T.COMLAST)).toBe(TILE_CATEGORY.COMMERCIAL);
    expect(categorizeTile(T.INDBASE)).toBe(TILE_CATEGORY.INDUSTRIAL);
    expect(categorizeTile(T.INDCLR)).toBe(TILE_CATEGORY.INDUSTRIAL);
    expect(categorizeTile(T.IND9)).toBe(TILE_CATEGORY.INDUSTRIAL);
    expect(categorizeTile(T.INDBASE2)).toBe(TILE_CATEGORY.INDUSTRIAL);
    expect(categorizeTile(T.SMOKEBASE)).toBe(TILE_CATEGORY.INDUSTRIAL);
  });

  it('maps ports, airports (incl. radar animation), and power plants (incl. smoke)', () => {
    expect(categorizeTile(T.PORT)).toBe(TILE_CATEGORY.SEAPORT);
    expect(categorizeTile(T.LASTPORT)).toBe(TILE_CATEGORY.SEAPORT);
    expect(categorizeTile(T.AIRPORTBASE)).toBe(TILE_CATEGORY.AIRPORT);
    expect(categorizeTile(T.AIRPORT)).toBe(TILE_CATEGORY.AIRPORT);
    expect(categorizeTile(T.RADAR0)).toBe(TILE_CATEGORY.AIRPORT);
    expect(categorizeTile(T.POWERPLANT)).toBe(TILE_CATEGORY.COAL_POWER);
    expect(categorizeTile(T.COALSMOKE1)).toBe(TILE_CATEGORY.COAL_POWER);
    expect(categorizeTile(T.NUCLEAR)).toBe(TILE_CATEGORY.NUCLEAR_POWER);
    expect(categorizeTile(T.LASTZONE)).toBe(TILE_CATEGORY.NUCLEAR_POWER);
  });

  it('maps services and the stadium (incl. game-day animation)', () => {
    expect(categorizeTile(T.FIRESTATION)).toBe(TILE_CATEGORY.FIRE_STATION);
    expect(categorizeTile(T.POLICESTATION)).toBe(TILE_CATEGORY.POLICE_STATION);
    expect(categorizeTile(T.STADIUM)).toBe(TILE_CATEGORY.STADIUM);
    expect(categorizeTile(T.FULLSTADIUM)).toBe(TILE_CATEGORY.STADIUM);
    expect(categorizeTile(T.FOOTBALLGAME1)).toBe(TILE_CATEGORY.STADIUM);
  });
});

describe('categorizeTile — status flags are stripped', () => {
  it('a powered zone-center residential tile is still RESIDENTIAL', () => {
    expect(categorizeTile(T.FREEZ | ZONEBIT | POWERBIT | CONDBIT)).toBe(TILE_CATEGORY.RESIDENTIAL);
  });

  it('an animated conducting road tile is still ROAD', () => {
    expect(categorizeTile(T.ROADS | ANIMBIT | CONDBIT)).toBe(TILE_CATEGORY.ROAD);
  });
});

describe('encodeTileCategories', () => {
  it('emits one byte per tile, row-major, base64 round-trippable', () => {
    const tiles = [T.DIRT, T.RIVER, T.FREEZ | ZONEBIT | POWERBIT, T.POWERPLANT];
    const decoded = Buffer.from(encodeTileCategories(tiles), 'base64');
    expect([...decoded]).toEqual([
      TILE_CATEGORY.CLEAR,
      TILE_CATEGORY.WATER,
      TILE_CATEGORY.RESIDENTIAL,
      TILE_CATEGORY.COAL_POWER,
    ]);
  });

  it('handles an empty map', () => {
    expect(encodeTileCategories([])).toBe('');
  });
});
