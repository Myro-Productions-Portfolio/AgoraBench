import React from 'react';
import { PixelAvatar } from 'agora-bench';

const AGENT_SEEDS = [
  'vera-okonkwo',
  'dax-nguyen',
  'sam-ritter',
  'leila-farsi',
  'garrett-voss',
  'nora-callahan',
  'finn-kalani',
  'zara-moss',
  'arjun-mehta',
  'sable-chen',
];

/** Canonical — one procedurally generated avatar per sitting agent, seeded by agent name. */
export const AgentRoster = () => (
  <div className="flex flex-wrap gap-3 items-center">
    {AGENT_SEEDS.map((seed) => (
      <div key={seed} className="flex flex-col items-center gap-1">
        <PixelAvatar seed={seed} size="lg" className="rounded" />
        <span className="text-badge text-text-muted font-mono">{seed.split('-')[0]}</span>
      </div>
    ))}
  </div>
);

/** Size scale — the same agent rendered at every size token from xs to xl. */
export const SizeScale = () => (
  <div className="flex items-end gap-4">
    {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
      <div key={size} className="flex flex-col items-center gap-1">
        <PixelAvatar seed="vera-okonkwo" size={size} className="rounded" />
        <span className="text-badge text-text-muted font-mono">{size}</span>
      </div>
    ))}
  </div>
);

/** Explicit config — feature axes controlled directly instead of derived from a seed. */
export const ExplicitConfigs = () => (
  <div className="flex flex-wrap gap-4">
    {(
      [
        {
          label: 'visor / stern',
          config: {
            bgColor: '#1a2330',
            faceColor: '#8fb3c9',
            accentColor: '#6b9ab8',
            eyeType: 'visor',
            mouthType: 'stern',
            accessory: 'antenna',
          },
        },
        {
          label: 'wide / grin',
          config: {
            bgColor: '#1a2318',
            faceColor: '#b3c99b',
            accentColor: '#7ab86b',
            eyeType: 'wide',
            mouthType: 'grin',
            accessory: 'dual_antenna',
          },
        },
        {
          label: 'square / smile',
          config: {
            bgColor: '#1e1a2e',
            faceColor: '#a89bc9',
            accentColor: '#b8956a',
            eyeType: 'square',
            mouthType: 'smile',
            accessory: 'halo',
          },
        },
        {
          label: 'dot / speak',
          config: {
            bgColor: '#2e1a1a',
            faceColor: '#c9a88f',
            accentColor: '#b87a6b',
            eyeType: 'dot',
            mouthType: 'speak',
            accessory: 'none',
          },
        },
      ] as const
    ).map(({ label, config }) => (
      <div key={label} className="flex flex-col items-center gap-1">
        <PixelAvatar config={{ ...config }} size="lg" className="rounded" />
        <span className="text-badge text-text-muted font-mono">{label}</span>
      </div>
    ))}
  </div>
);

/** In context — avatars anchoring a delegation list, the way agent directories use them. */
export const DelegationList = () => (
  <div className="card p-4 flex flex-col gap-3" style={{ width: 380 }}>
    {(
      [
        ['leila-farsi', 'Progressive Alliance', 'Chief Justice'],
        ['garrett-voss', 'Constitutional Order Party', 'Budget Chair'],
        ['zara-moss', 'Technocratic Union', 'President'],
        ['sam-ritter', 'Moderate Coalition', 'Senator'],
      ] as const
    ).map(([seed, party, role]) => (
      <div key={seed} className="flex items-center gap-3">
        <PixelAvatar seed={seed} size="md" className="rounded" />
        <div className="flex-1">
          <div className="text-sm text-text-primary font-medium">{seed}</div>
          <div className="text-badge text-text-muted">{party}</div>
        </div>
        <span className="text-badge text-gold font-mono uppercase tracking-wide">{role}</span>
      </div>
    ))}
  </div>
);
