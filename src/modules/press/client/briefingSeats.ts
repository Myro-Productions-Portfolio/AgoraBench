// Hand-calibrated against briefing-room.png (1264px wide → 1000-wide viewBox, /1.264).
// Not a smooth formula — matches the actual art. Podium at viewBox (500, 346).
// Three marker roles: press seats + on-stage speakers + flanking guests.
export const PODIUM_POSITION = { viewBoxWidth: 1000, viewBoxHeight: 671, x: 500, y: 346 };

// Per-role marker styling, from the owner's calibration (ROLE_STYLE). Sizes in px at the 1000x671 viewBox.
export const ROLE_STYLE = {
  press:   { base: 'rgba(184,149,106,0.6)',  active: '#e8b96a', size: 14 },
  speaker: { base: 'rgba(199,106,106,0.65)', active: '#e2838a', size: 20 },
  guest:   { base: 'rgba(143,176,208,0.65)', active: '#a8cdf0', size: 16 },
};

export type BriefingMarker =
  | { role: 'press'; r: number; c: number; x: number; y: number }
  | { role: 'speaker'; i: number; x: number; y: number }
  | { role: 'guest'; side: 'left' | 'right'; i: number; x: number; y: number };

export const CALIBRATED_MARKERS: BriefingMarker[] = [
  { role: 'press', r: 0, c: 0, x: 337, y: 404 }, { role: 'press', r: 0, c: 1, x: 391, y: 404 },
  { role: 'press', r: 0, c: 3, x: 461, y: 404 },
  { role: 'press', r: 0, c: 4, x: 500, y: 404 }, { role: 'press', r: 0, c: 5, x: 556, y: 405 },
  { role: 'press', r: 0, c: 6, x: 609, y: 404 }, { role: 'press', r: 0, c: 7, x: 664, y: 405 },
  { role: 'press', r: 0, c: 8, x: 718, y: 405 }, { role: 'press', r: 1, c: 0, x: 283, y: 405 },
  { role: 'press', r: 1, c: 1, x: 376, y: 416 },
  { role: 'press', r: 1, c: 3, x: 454, y: 419 }, { role: 'press', r: 1, c: 4, x: 500, y: 419 },
  { role: 'press', r: 1, c: 5, x: 546, y: 419 },
  { role: 'press', r: 1, c: 8, x: 686, y: 419 },
  { role: 'press', r: 2, c: 0, x: 254, y: 417 }, { role: 'press', r: 2, c: 1, x: 315, y: 417 },
  { role: 'press', r: 2, c: 3, x: 445, y: 433 },
  { role: 'press', r: 2, c: 4, x: 500, y: 433 }, { role: 'press', r: 2, c: 5, x: 555, y: 433 },
  { role: 'press', r: 2, c: 6, x: 610, y: 433 },
  { role: 'press', r: 2, c: 8, x: 748, y: 419 }, { role: 'press', r: 3, c: 0, x: 212, y: 433 },
  { role: 'press', r: 3, c: 1, x: 285, y: 434 }, { role: 'press', r: 3, c: 2, x: 357, y: 434 },
  { role: 'press', r: 3, c: 3, x: 436, y: 451 }, { role: 'press', r: 3, c: 4, x: 500, y: 451 },
  { role: 'press', r: 3, c: 5, x: 564, y: 451 }, { role: 'press', r: 3, c: 6, x: 628, y: 451 },
  { role: 'press', r: 3, c: 7, x: 715, y: 434 }, { role: 'press', r: 3, c: 8, x: 789, y: 434 },
  { role: 'press', r: 4, c: 0, x: 159, y: 456 }, { role: 'press', r: 4, c: 1, x: 245, y: 456 },
  { role: 'press', r: 4, c: 2, x: 330, y: 456 }, { role: 'press', r: 4, c: 3, x: 424, y: 476 },
  { role: 'press', r: 4, c: 4, x: 500, y: 476 }, { role: 'press', r: 4, c: 5, x: 576, y: 476 },
  { role: 'press', r: 4, c: 6, x: 652, y: 476 }, { role: 'press', r: 4, c: 7, x: 757, y: 457 },
  { role: 'press', r: 4, c: 8, x: 842, y: 456 }, { role: 'press', r: 5, c: 0, x: 85, y: 486 },
  { role: 'press', r: 5, c: 1, x: 189, y: 487 }, { role: 'press', r: 5, c: 2, x: 293, y: 487 },
  { role: 'press', r: 5, c: 6, x: 684, y: 510 },
  { role: 'press', r: 5, c: 7, x: 811, y: 488 }, { role: 'press', r: 5, c: 8, x: 916, y: 488 },
  { role: 'speaker', i: 0, x: 429, y: 310 }, { role: 'speaker', i: 1, x: 501, y: 289 }, { role: 'speaker', i: 2, x: 571, y: 307 },
  { role: 'guest', side: 'left', i: 0, x: 130, y: 369 }, { role: 'guest', side: 'left', i: 1, x: 80, y: 377 }, { role: 'guest', side: 'left', i: 2, x: 36, y: 383 },
  { role: 'guest', side: 'right', i: 0, x: 873, y: 368 }, { role: 'guest', side: 'right', i: 1, x: 916, y: 375 }, { role: 'guest', side: 'right', i: 2, x: 965, y: 381 },
];
