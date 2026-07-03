import React from 'react';
import { AgentAvatarDot } from 'agora-bench';
import type { Agent } from '@shared/types';

// Seed-roster agents (src/core/db/seed.ts). avatarUrl null → initials-ring fallback,
// which is what the live map shows for every agent today.
const mkAgent = (
  name: string,
  displayName: string,
  alignment: string,
  reputation: number,
  balance: number,
  bio: string,
): Agent => ({
  id: `agent-${name}`,
  agoraId: `agora-${name}`,
  name,
  displayName,
  reputation,
  balance,
  registrationDate: new Date('2026-02-14T09:00:00Z'),
  isActive: true,
  avatarUrl: null,
  bio,
  alignment,
});

const vera = mkAgent('vera-okonkwo', 'Vera Okonkwo', 'progressive', 520, 2400,
  'Driven by empathy, she believes policy must center the most vulnerable first');
const dax = mkAgent('dax-nguyen', 'Dax Nguyen', 'progressive', 480, 1800,
  'He believes lasting change only comes through collective action and coalition building');
const sam = mkAgent('sam-ritter', 'Sam Ritter', 'moderate', 550, 2200,
  'A pragmatist who defaults to whatever actually works over ideological purity');
const leila = mkAgent('leila-farsi', 'Leila Farsi', 'moderate', 410, 1600,
  'She instinctively seeks the position that everyone in the room can live with');
const garrett = mkAgent('garrett-voss', 'Garrett Voss', 'conservative', 580, 2800,
  'He distrusts rapid change and holds that stability is itself a form of progress');
const nora = mkAgent('nora-callahan', 'Nora Callahan', 'conservative', 430, 1900,
  'She believes a government that cannot balance its books will eventually fail its people');
const finn = mkAgent('finn-kalani', 'Finn Kalani', 'libertarian', 370, 1400,
  'His first instinct when government acts is to ask who gave it that power');
const zara = mkAgent('zara-moss', 'Zara Moss', 'libertarian', 320, 1200,
  'She believes people solve their own problems better than any government ever could');
const arjun = mkAgent('arjun-mehta', 'Arjun Mehta', 'technocrat', 600, 3000,
  'He trusts numbers and evidence over rhetoric — bad data makes bad laws');
const sable = mkAgent('sable-chen', 'Sable Chen', 'technocrat', 450, 2000,
  'She sees governance as an engineering problem: define the outcome, optimize the system');

const noop = () => {};

/* One dot per alignment family — ring color is derived from agent.alignment */
export const AlignmentRings = () => (
  <div
    style={{
      display: 'inline-flex',
      gap: 40,
      padding: '28px 32px',
      background: '#1A1B1E',
      borderRadius: 8,
    }}
  >
    {[
      { agent: vera, label: 'progressive' },
      { agent: garrett, label: 'conservative' },
      { agent: sam, label: 'moderate' },
      { agent: arjun, label: 'technocrat' },
    ].map(({ agent, label }) => (
      <div
        key={agent.id}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}
      >
        <AgentAvatarDot agent={agent} index={0} hasSpeechBubble={false} onClick={noop} />
        <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#9B9D9F' }}>{label}</span>
      </div>
    ))}
  </div>
);

/* Slot-offset cluster — how occupants of one building spread around its center */
export const CapitolCluster = () => (
  <div
    style={{
      position: 'relative',
      width: 320,
      height: 210,
      background: '#1A1B1E',
      borderRadius: 8,
      overflow: 'hidden',
    }}
  >
    {/* faint building footprint the cluster hovers over */}
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '45%',
        width: 130,
        height: 90,
        marginLeft: -65,
        marginTop: -45,
        borderRadius: 4,
        background: 'linear-gradient(160deg, #C9B99B1E 0%, #C9B99B09 100%)',
        border: '1px solid #C9B99B3E',
      }}
    />
    {[vera, dax, sam, garrett, nora, finn, arjun].map((agent, i) => (
      <div
        key={agent.id}
        style={{ position: 'absolute', left: '50%', top: '45%', marginLeft: -16, marginTop: -16 }}
      >
        <AgentAvatarDot agent={agent} index={i} hasSpeechBubble={false} onClick={noop} />
      </div>
    ))}
  </div>
);

/* Full ten-agent roster occupying every slot offset */
export const FullAssembly = () => (
  <div
    style={{
      position: 'relative',
      width: 380,
      height: 240,
      background: '#1A1B1E',
      borderRadius: 8,
      overflow: 'hidden',
    }}
  >
    {[vera, dax, sam, leila, garrett, nora, finn, zara, arjun, sable].map((agent, i) => (
      <div
        key={agent.id}
        style={{ position: 'absolute', left: '50%', top: '42%', marginLeft: -16, marginTop: -16 }}
      >
        <AgentAvatarDot agent={agent} index={i} hasSpeechBubble={i === 0} onClick={noop} />
      </div>
    ))}
  </div>
);
