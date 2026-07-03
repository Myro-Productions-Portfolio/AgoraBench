import React from 'react';
import { SpeechBubble, AgentAvatarDot } from 'agora-bench';
import type { Agent } from '@shared/types';

// Disable WAAPI in this card so framer-motion falls back to its JS animation driver.
// The capture harness freezes the page clock (document.timeline stops), which leaves
// WAAPI-accelerated opacity tweens stuck at their initial keyframe — the bubble
// (initial opacity 0) captured invisible. The JS driver renders identically live.
if (typeof Element !== 'undefined' && (Element.prototype as { animate?: unknown }).animate) {
  delete (Element.prototype as { animate?: unknown }).animate;
}

// SpeechBubble anchors above its seat wrapper (bottom:100%, left:50%), mirroring
// BuildingInteriorPage's AgentSeat: an absolutely-positioned anchor holding the
// bubble plus the agent's avatar dot beneath it. NOTE: the anchor here is 360px
// wide (dot centered) so the bubble's designed max-w-[180px] wrapping applies —
// against the app's 40px seat anchor, CSS shrink-to-fit collapses the bubble to
// a one-word-per-line column (a live-app quirk, not the intended geometry).
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
const sam = mkAgent('sam-ritter', 'Sam Ritter', 'moderate', 550, 2200,
  'A pragmatist who defaults to whatever actually works over ideological purity');
const nora = mkAgent('nora-callahan', 'Nora Callahan', 'conservative', 430, 1900,
  'She believes a government that cannot balance its books will eventually fail its people');

const noop = () => {};

const Seat = ({
  agent,
  children,
}: {
  agent: Agent;
  children?: React.ReactNode;
}) => (
  <div
    style={{
      position: 'relative',
      width: 400,
      height: 230,
      background: '#1A1B1E',
      borderRadius: 8,
    }}
  >
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: 172,
        width: 360,
        marginLeft: -180,
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      {children}
      <AgentAvatarDot agent={agent} index={0} hasSpeechBubble onClick={noop} />
    </div>
  </div>
);

/* Vote reasoning bubble — emitted with agent:vote events on the live map */
export const VoteReasoning = () => (
  <Seat agent={vera}>
    <SpeechBubble
      bubble={{
        id: 'bubble-31',
        agentId: 'agent-vera-okonkwo',
        text: 'Voted YEA: MG-047 pays for itself within four budget cycles — the fiscal note is sound.',
        type: 'vote',
        expiresAt: 1747310405000,
      }}
    />
  </Seat>
);

/* Floor debate remark — short speech bubble */
export const DebateRemark = () => (
  <Seat agent={sam}>
    <SpeechBubble
      bubble={{
        id: 'bubble-32',
        agentId: 'agent-sam-ritter',
        text: 'The Moderate Coalition will not back any amendment that strips the sunset clause from MG-031.',
        type: 'speech',
        expiresAt: 1747310405000,
      }}
    />
  </Seat>
);

/* Campaign speech over 120 chars — component truncates with an ellipsis */
export const TruncatedCampaignSpeech = () => (
  <Seat agent={nora}>
    <SpeechBubble
      bubble={{
        id: 'bubble-33',
        agentId: 'agent-nora-callahan',
        text: 'A government that cannot balance its books will eventually fail its people — that is why the Constitutional Order Party demands a fiscal note on every bill above M$50M.',
        type: 'speech',
        expiresAt: 1747310405000,
      }}
    />
  </Seat>
);
