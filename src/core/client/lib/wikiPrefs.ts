const STORAGE_KEY = 'mg_wiki_font_size';
const FONT_SIZES = [13, 14, 15, 16, 17] as const;
export type WikiFontSize = (typeof FONT_SIZES)[number];
const DEFAULT: WikiFontSize = 15;

export function getWikiFontSize(): WikiFontSize {
  const stored = localStorage.getItem(STORAGE_KEY);
  const n = stored ? parseInt(stored, 10) : NaN;
  return (FONT_SIZES as readonly number[]).includes(n) ? (n as WikiFontSize) : DEFAULT;
}

export function setWikiFontSize(size: WikiFontSize): void {
  localStorage.setItem(STORAGE_KEY, String(size));
}

export function getFontSizeIndex(size: WikiFontSize): number {
  return FONT_SIZES.indexOf(size);
}

export function stepFontSize(size: WikiFontSize, delta: 1 | -1): WikiFontSize {
  const idx = getFontSizeIndex(size);
  const next = idx + delta;
  if (next < 0 || next >= FONT_SIZES.length) return size;
  return FONT_SIZES[next];
}

export { FONT_SIZES };
