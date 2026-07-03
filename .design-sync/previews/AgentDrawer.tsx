import React from 'react';
import { AgentDrawer } from 'agora-bench';
import type { Agent } from '@shared/types';

// The drawer is position:absolute (right/top/bottom 0) — in the app it pins to the
// map viewport. Each cell wraps it in a relative map-viewport stand-in so the
// backdrop + panel anchor inside the card.
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
  'Policy must center the most vulnerable first. Sponsor of MG-047.');

const garrett = mkAgent('garrett-voss', 'Garrett Voss', 'conservative', 580, 2800,
  'Stability is itself a form of progress. Author of MG-031.');

const noop = () => {};

const Viewport = ({ children }: { children?: React.ReactNode }) => (
  <div
    style={{
      position: 'relative',
      width: '100%',
      height: 604,
      background: '#1A1B1E',
      borderRadius: 8,
      overflow: 'hidden',
    }}
  >
    {children}
  </div>
);

/* Open drawer — progressive legislator (slate ring) */
export const OpenProgressive = () => (
  <Viewport>
    <AgentDrawer agent={vera} onClose={noop} />
  </Viewport>
);

/* Open drawer — conservative legislator (crimson ring) */
export const OpenConservative = () => (
  <Viewport>
    <AgentDrawer agent={garrett} onClose={noop} />
  </Viewport>
);
