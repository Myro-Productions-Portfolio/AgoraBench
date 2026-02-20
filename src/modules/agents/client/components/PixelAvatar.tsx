import React from 'react';

export interface AvatarConfig {
  bgColor: string;
  faceColor: string;
  accentColor: string;
  eyeType: 'square' | 'wide' | 'dot' | 'visor';
  mouthType: 'smile' | 'stern' | 'speak' | 'grin';
  accessory: 'none' | 'antenna' | 'dual_antenna' | 'halo';
}

/* ---- Procedural generation ---- */

function hashString(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  return Math.abs(h);
}

const BG_COLORS = ['#1a1d23', '#1a2330', '#1e1a2e', '#1a2318', '#2e1a1a', '#1e2a1a', '#2a1e2e', '#1a2828'];
const FACE_COLORS = ['#c9b99b', '#8fb3c9', '#b3c99b', '#c9a88f', '#a89bc9', '#9bc9be', '#c9bf8f', '#c98f9b'];
const ACCENT_COLORS = ['#b8956a', '#6b9ab8', '#7ab86b', '#b87a6b', '#8b6bb8', '#6bb8b0', '#b8ad6b', '#b86b7a'];
const EYE_TYPES: AvatarConfig['eyeType'][] = ['square', 'wide', 'dot', 'visor'];
const MOUTH_TYPES: AvatarConfig['mouthType'][] = ['smile', 'stern', 'speak', 'grin'];
const ACCESSORIES: AvatarConfig['accessory'][] = ['none', 'antenna', 'dual_antenna', 'none', 'none', 'halo', 'none', 'antenna'];

export function proceduralConfig(seed: string): AvatarConfig {
  const h = hashString(seed);
  return {
    bgColor: BG_COLORS[h % BG_COLORS.length],
    faceColor: FACE_COLORS[(h >> 4) % FACE_COLORS.length],
    accentColor: ACCENT_COLORS[(h >> 8) % ACCENT_COLORS.length],
    eyeType: EYE_TYPES[(h >> 12) % EYE_TYPES.length],
    mouthType: MOUTH_TYPES[(h >> 16) % MOUTH_TYPES.length],
    accessory: ACCESSORIES[(h >> 20) % ACCESSORIES.length],
  };
}

/* ---- SVG rendering helpers ---- */

/** Render a filled rectangle at grid coordinates (each unit = 1 pixel in 16x16 grid) */
function px(
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  key?: string,
): React.ReactElement {
  return (
    <rect
      key={key}
      x={x}
      y={y}
      width={w}
      height={h}
      fill={color}
    />
  );
}

function renderEyes(eyeType: AvatarConfig['eyeType'], accentColor: string): React.ReactElement[] {
  switch (eyeType) {
    case 'square':
      return [
        px(3, 5, 2, 2, accentColor, 'eye-l'),
        px(9, 5, 2, 2, accentColor, 'eye-r'),
      ];
    case 'wide':
      return [
        px(2, 5, 3, 2, accentColor, 'eye-l'),
        px(8, 5, 3, 2, accentColor, 'eye-r'),
      ];
    case 'dot':
      return [
        px(4, 6, 1, 1, accentColor, 'eye-l'),
        px(10, 6, 1, 1, accentColor, 'eye-r'),
      ];
    case 'visor':
      return [
        px(3, 5, 8, 2, accentColor, 'visor'),
      ];
    default:
      return [];
  }
}

const MOUTH_COLOR = '#1a1d23';

function renderMouth(mouthType: AvatarConfig['mouthType']): React.ReactElement[] {
  switch (mouthType) {
    case 'smile':
      // Upward curve: corners at y=9, middle at y=10
      return [
        px(5, 9, 1, 1, MOUTH_COLOR, 'm0'),
        px(6, 10, 1, 1, MOUTH_COLOR, 'm1'),
        px(7, 10, 1, 1, MOUTH_COLOR, 'm2'),
        px(8, 10, 1, 1, MOUTH_COLOR, 'm3'),
        px(9, 9, 1, 1, MOUTH_COLOR, 'm4'),
      ];
    case 'stern':
      // Flat line
      return [
        px(5, 9, 1, 1, MOUTH_COLOR, 'm0'),
        px(6, 9, 1, 1, MOUTH_COLOR, 'm1'),
        px(7, 9, 1, 1, MOUTH_COLOR, 'm2'),
        px(8, 9, 1, 1, MOUTH_COLOR, 'm3'),
        px(9, 9, 1, 1, MOUTH_COLOR, 'm4'),
      ];
    case 'speak':
      // 2x2 open rect (hollow square) at (6,8)
      return [
        px(6, 8, 2, 1, MOUTH_COLOR, 'm-top'),
        px(6, 9, 2, 1, MOUTH_COLOR, 'm-bot'),
      ];
    case 'grin':
      // Wide grin
      return [
        px(4, 9, 1, 1, MOUTH_COLOR, 'm0'),
        px(5, 10, 1, 1, MOUTH_COLOR, 'm1'),
        px(6, 10, 1, 1, MOUTH_COLOR, 'm2'),
        px(7, 10, 1, 1, MOUTH_COLOR, 'm3'),
        px(8, 10, 1, 1, MOUTH_COLOR, 'm4'),
        px(9, 10, 1, 1, MOUTH_COLOR, 'm5'),
        px(10, 9, 1, 1, MOUTH_COLOR, 'm6'),
      ];
    default:
      return [];
  }
}

function renderAccessory(accessory: AvatarConfig['accessory'], accentColor: string): React.ReactElement[] {
  switch (accessory) {
    case 'antenna':
      return [
        px(7, 0, 1, 1, accentColor, 'ant0'),
        px(7, 1, 1, 1, accentColor, 'ant1'),
        px(7, 2, 1, 1, accentColor, 'ant2'),
      ];
    case 'dual_antenna':
      return [
        px(4, 1, 1, 1, accentColor, 'dant0'),
        px(4, 2, 1, 1, accentColor, 'dant1'),
        px(10, 1, 1, 1, accentColor, 'dant2'),
        px(10, 2, 1, 1, accentColor, 'dant3'),
      ];
    case 'halo':
      return [
        px(4, 0, 8, 1, accentColor, 'halo'),
      ];
    case 'none':
    default:
      return [];
  }
}

/* ---- Size map ---- */
const SIZE_MAP = {
  xs: 16,
  sm: 32,
  md: 48,
  lg: 96,
  xl: 160,
} as const;

/* ---- Component ---- */

interface PixelAvatarProps {
  config?: AvatarConfig;
  seed?: string;
  size?: keyof typeof SIZE_MAP;
  className?: string;
}

export function PixelAvatar({ config, seed, size = 'md', className }: PixelAvatarProps) {
  const resolvedConfig: AvatarConfig =
    config ?? proceduralConfig(seed ?? 'default');

  const totalPx = SIZE_MAP[size];

  const eyes = renderEyes(resolvedConfig.eyeType, resolvedConfig.accentColor);
  const mouth = renderMouth(resolvedConfig.mouthType);
  const accessory = renderAccessory(resolvedConfig.accessory, resolvedConfig.accentColor);

  return (
    <svg
      width={totalPx}
      height={totalPx}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      className={className}
      aria-hidden="true"
    >
      {/* Background */}
      <rect x={0} y={0} width={16} height={16} fill={resolvedConfig.bgColor} />

      {/* Face body: (2,3) to (14,13) = 12w x 10h */}
      <rect x={2} y={3} width={12} height={10} fill={resolvedConfig.faceColor} />

      {/* Eyes */}
      {eyes}

      {/* Mouth */}
      {mouth}

      {/* Accessory */}
      {accessory}
    </svg>
  );
}
