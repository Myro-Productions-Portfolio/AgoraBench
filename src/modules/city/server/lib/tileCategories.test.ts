import { describe, expect, it } from 'vitest';
import { encodeTileCategories, encodeTileIds, TILE_CATEGORY } from './tileCategories';

describe('encodeTileIds', () => {
  it('round-trips ids as little-endian uint16 with flag bits stripped', () => {
    const raw = [0, 3, 244, 1023, 0x8000 | 56, 0x7c00 | 612, 0xffff];
    const b64 = encodeTileIds(raw);
    const buf = Buffer.from(b64, 'base64');
    expect(buf.length).toBe(raw.length * 2);
    const decoded: number[] = [];
    for (let i = 0; i < raw.length; i++) decoded.push(buf.readUInt16LE(i * 2));
    expect(decoded).toEqual([0, 3, 244, 1023, 56, 612, 1023]);
  });

  it('encodes empty input to an empty string', () => {
    expect(encodeTileIds([])).toBe('');
  });

  it('byte order is little-endian on the wire', () => {
    const buf = Buffer.from(encodeTileIds([0x0102]), 'base64');
    expect([buf[0], buf[1]]).toEqual([0x02, 0x01]);
  });
});

describe('encodeTileCategories', () => {
  it('still emits one category byte per tile', () => {
    const buf = Buffer.from(encodeTileCategories([0, 2]), 'base64');
    expect(buf.length).toBe(2);
    expect(buf[0]).toBe(TILE_CATEGORY.CLEAR);
    expect(buf[1]).toBe(TILE_CATEGORY.WATER);
  });
});
