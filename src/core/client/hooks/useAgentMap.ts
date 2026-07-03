// src/core/client/hooks/useAgentMap.ts

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from '../lib/useWebSocket';
import { agentsApi, activityApi } from '../lib/api';
import type { Agent } from '@shared/types';

// Maps activity types (from DB) to building IDs
const ACTIVITY_TYPE_TO_BUILDING: Record<string, string> = {
  // Capitol
  vote: 'capitol',
  bill_proposed: 'capitol',
  bill_resolved: 'capitol',
  bill_advanced: 'capitol',
  bill: 'capitol',
  debate: 'capitol',
  committee_review: 'capitol',
  committee_amendment: 'capitol',
  bill_tabled: 'capitol',
  presidential_veto: 'capitol',
  veto_override_attempt: 'capitol',
  veto_override_success: 'capitol',
  veto_sustained: 'capitol',
  // Party Hall
  campaign_speech: 'party-hall',
  party: 'party-hall',
  // Election Center
  election_voting_started: 'election-center',
  election_completed: 'election-center',
  election: 'election-center',
  // Archives
  law: 'archives',
  law_amended: 'archives',
  law_enacted: 'archives',
  // Supreme Court
  law_struck_down: 'supreme-court',
  law_upheld: 'supreme-court',
  court_case_filed: 'supreme-court',
  judicial_review_initiated: 'supreme-court',
  judicial_vote: 'supreme-court',
  // Treasury
  salary_payment: 'treasury',
  tax_collected: 'treasury',
};

// Fallback building distribution — agents spread across all buildings on initial load
// TODO: replace with position-holder sorting once agent position data is available
const FALLBACK_BUILDINGS = [
  'party-hall',
  'capitol',
  'treasury',
  'supreme-court',
  'archives',
  'election-center',
  'party-hall',
  'capitol',
];

function getFallbackBuilding(agentId: string): string {
  // Simple hash: sum char codes mod array length
  const hash = agentId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return FALLBACK_BUILDINGS[hash % FALLBACK_BUILDINGS.length];
}

export type SpeechBubble = {
  id: string;
  agentId: string;
  text: string;
  type: 'speech' | 'vote';
  expiresAt: number;
};

export type BuildingPulse = {
  buildingId: string;
  color: string;
  triggeredAt: number;
};

export type TickerEvent = {
  id: string;
  text: string;
  highlight: string;
  type: string;
  timestamp: number;
};

export interface AgentMapState {
  agents: Agent[];
  // agentId -> buildingId
  agentLocations: Record<string, string>;
  speechBubbles: SpeechBubble[];
  buildingPulses: BuildingPulse[];
  tickerEvents: TickerEvent[];
  selectedAgent: Agent | null;
  setSelectedAgent: (agent: Agent | null) => void;
  isLoading: boolean;
}

export function useAgentMap(): AgentMapState {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentLocations, setAgentLocations] = useState<Record<string, string>>({});
  const [speechBubbles, setSpeechBubbles] = useState<SpeechBubble[]>([]);
  const [buildingPulses, setBuildingPulses] = useState<BuildingPulse[]>([]);
  const [tickerEvents, setTickerEvents] = useState<TickerEvent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { subscribe } = useWebSocket();
  const bubbleIdRef = useRef(0);
  const tickerIdRef = useRef(0);

  // Initial data load
  useEffect(() => {
    async function load() {
      try {
        const [agentRes, activityRes] = await Promise.all([
          agentsApi.list(1, 50),
          activityApi.recent({ limit: 100 }),
        ]);

        const agentList = (agentRes.data as Agent[]) ?? [];
        setAgents(agentList);

        // Derive each agent's location from their most recent activity.
        // GET /api/activity responds with { events, total } (see
        // src/modules/agents/server/routes/activity.ts), not a bare array —
        // unwrap .events here (matches the working pattern in AdminPage.tsx's
        // fetchActivityFeed). Casting activityRes.data straight to an array
        // made it non-iterable, throwing on every load and leaving
        // agentLocations permanently empty — which is why CapitolMapPage's
        // `agentLocations[agent.id] ?? 'party-hall'` fallback put every
        // agent in Party Hall.
        const activityData = activityRes.data as { events?: Array<{ agentId: string | null; type: string }> } | undefined;
        const activityList = activityData?.events ?? [];
        const locations: Record<string, string> = {};

        // Process activities newest-first; only set location for agent if not already set
        for (const event of activityList) {
          if (event.agentId && !locations[event.agentId]) {
            const building = ACTIVITY_TYPE_TO_BUILDING[event.type] ?? getFallbackBuilding(event.agentId);
            locations[event.agentId] = building;
          }
        }

        // Any agent without a location gets a hash-based fallback building
        for (const agent of agentList) {
          if (!locations[agent.id]) {
            locations[agent.id] = getFallbackBuilding(agent.id);
          }
        }

        setAgentLocations(locations);
      } catch (err) {
        console.error('[useAgentMap] Load failed:', err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  // Helper: add a building pulse
  const triggerPulse = useCallback((buildingId: string, color: string) => {
    const pulse: BuildingPulse = { buildingId, color, triggeredAt: Date.now() };
    setBuildingPulses((prev) => [...prev.filter((p) => p.buildingId !== buildingId), pulse]);
    // Remove after animation (2s)
    setTimeout(() => {
      setBuildingPulses((prev) => prev.filter((p) => p.triggeredAt !== pulse.triggeredAt));
    }, 2000);
  }, []);

  // Helper: add speech bubble
  const addSpeechBubble = useCallback((agentId: string, text: string, type: 'speech' | 'vote') => {
    const id = `bubble-${++bubbleIdRef.current}`;
    const bubble: SpeechBubble = { id, agentId, text, type, expiresAt: Date.now() + 5000 };
    setSpeechBubbles((prev) => [...prev.filter((b) => b.agentId !== agentId), bubble]);
    setTimeout(() => {
      setSpeechBubbles((prev) => prev.filter((b) => b.id !== id));
    }, 5200); // slight extra for exit animation
  }, []);

  // Helper: add ticker event
  const addTickerEvent = useCallback((highlight: string, text: string, type: string) => {
    const id = `tick-${++tickerIdRef.current}`;
    setTickerEvents((prev) => [{ id, highlight, text, type, timestamp: Date.now() }, ...prev].slice(0, 10));
  }, []);

  // Helper: move agent to building
  const moveAgent = useCallback((agentId: string, buildingId: string) => {
    setAgentLocations((prev) => ({ ...prev, [agentId]: buildingId }));
  }, []);

  // WebSocket subscriptions
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    // agent:vote
    unsubs.push(subscribe('agent:vote', (data: unknown) => {
      const d = data as Record<string, unknown>;
      if (!d?.agentId) return;
      moveAgent(d.agentId as string, 'capitol');
      triggerPulse('capitol', '#B8956A'); // gold
      if (d.reasoning) {
        addSpeechBubble(d.agentId as string, `Voted ${String(d.choice ?? '').toUpperCase()}: ${String(d.reasoning)}`, 'vote');
      }
      addTickerEvent(String(d.agentName ?? 'Agent'), `voted ${String(d.choice ?? '')} on "${String(d.billTitle ?? '')}"`, 'vote');
    }));

    // bill:proposed
    unsubs.push(subscribe('bill:proposed', (data: unknown) => {
      const d = data as Record<string, unknown>;
      if (!d?.sponsorId) return;
      moveAgent(d.sponsorId as string, 'capitol');
      triggerPulse('capitol', '#B8956A');
      addTickerEvent(String(d.sponsorName ?? 'Agent'), `proposed "${String(d.title ?? '')}"`, 'bill');
    }));

    // bill:resolved
    unsubs.push(subscribe('bill:resolved', (data: unknown) => {
      const d = data as Record<string, unknown>;
      const color = d?.result === 'passed' ? '#4CAF50' : '#F44336';
      triggerPulse('capitol', color);
      triggerPulse('archives', color);
      const resultWord = d?.result === 'passed' ? 'passed into law' : d?.result === 'failed' ? 'failed the floor vote' : 'vetoed';
      addTickerEvent(`"${String(d?.title ?? '')}"`, `${resultWord} (${String(d?.yeaCount ?? 0)} yea, ${String(d?.nayCount ?? 0)} nay)`, 'bill');
    }));

    // bill:advanced
    unsubs.push(subscribe('bill:advanced', (data: unknown) => {
      const d = data as Record<string, unknown>;
      triggerPulse('capitol', '#B8956A');
      addTickerEvent(`"${String(d?.title ?? '')}"`, `advanced: ${String(d?.from ?? '')} → ${String(d?.to ?? '')}`, 'bill');
    }));

    // campaign:speech
    unsubs.push(subscribe('campaign:speech', (data: unknown) => {
      const d = data as Record<string, unknown>;
      if (!d?.agentId) return;
      moveAgent(d.agentId as string, 'party-hall');
      triggerPulse('party-hall', '#8B3A3A'); // red/campaign
      if (d.speech) {
        addSpeechBubble(d.agentId as string, String(d.speech), 'speech');
      }
      const speechPreview = d.speech ? `${String(d.speech).slice(0, 60)}...` : '';
      addTickerEvent(String(d.agentName ?? 'Agent'), `campaigned for ${String(d.positionType ?? '')}: "${speechPreview}"`, 'campaign');
    }));

    // election:voting_started
    unsubs.push(subscribe('election:voting_started', (data: unknown) => {
      const d = data as Record<string, unknown>;
      triggerPulse('election-center', '#3A6B3A');
      addTickerEvent('Election', `voting opened for ${String(d?.positionType ?? '')}`, 'election');
    }));

    // election:completed
    unsubs.push(subscribe('election:completed', (data: unknown) => {
      const d = data as Record<string, unknown>;
      if (d?.winnerId) {
        moveAgent(d.winnerId as string, 'election-center');
      }
      triggerPulse('election-center', '#4CAF50');
      addTickerEvent(String(d?.winnerName ?? 'Agent'), `won the ${String(d?.positionType ?? '')} election`, 'election');
    }));

    // bill:tabled — committee chair tabled a bill (stays at capitol)
    unsubs.push(subscribe('bill:tabled', (data: unknown) => {
      const d = data as Record<string, unknown>;
      if (d?.chairId) moveAgent(d.chairId as string, 'capitol');
      triggerPulse('capitol', '#B8956A');
      addTickerEvent(`"${String(d?.title ?? '')}"`, `tabled in committee`, 'bill');
    }));

    // bill:committee_amended
    unsubs.push(subscribe('bill:committee_amended', (data: unknown) => {
      const d = data as Record<string, unknown>;
      if (d?.chairId) moveAgent(d.chairId as string, 'capitol');
      triggerPulse('capitol', '#B8956A');
      addTickerEvent(`"${String(d?.title ?? '')}"`, `amended by committee`, 'bill');
    }));

    // bill:presidential_veto
    unsubs.push(subscribe('bill:presidential_veto', (data: unknown) => {
      const d = data as Record<string, unknown>;
      if (d?.presidentId) moveAgent(d.presidentId as string, 'capitol');
      triggerPulse('capitol', '#8B3A3A');
      addTickerEvent(String(d?.presidentName ?? 'President'), `vetoed "${String(d?.title ?? '')}"`, 'veto');
    }));

    // bill:veto_overridden
    unsubs.push(subscribe('bill:veto_overridden', (data: unknown) => {
      const d = data as Record<string, unknown>;
      triggerPulse('capitol', '#4CAF50');
      triggerPulse('archives', '#4CAF50');
      addTickerEvent(`"${String(d?.title ?? '')}"`, `veto overridden — enacted into law`, 'bill');
    }));

    // bill:veto_sustained
    unsubs.push(subscribe('bill:veto_sustained', (data: unknown) => {
      const d = data as Record<string, unknown>;
      triggerPulse('capitol', '#F44336');
      addTickerEvent(`"${String(d?.title ?? '')}"`, `veto sustained — bill defeated`, 'bill');
    }));

    // law:struck_down — Supreme Court
    unsubs.push(subscribe('law:struck_down', (data: unknown) => {
      const d = data as Record<string, unknown>;
      triggerPulse('supreme-court', '#8B3A3A');
      addTickerEvent(`"${String(d?.title ?? '')}"`, `struck down by Supreme Court`, 'judicial');
    }));

    // law:amended — Archives
    unsubs.push(subscribe('law:amended', (data: unknown) => {
      const d = data as Record<string, unknown>;
      triggerPulse('archives', '#B8956A');
      addTickerEvent(`"${String(d?.title ?? '')}"`, `amended`, 'law');
    }));

    // court:case_filed — Supreme Court (judicial slate)
    unsubs.push(subscribe('court:case_filed', (data: unknown) => {
      const d = data as Record<string, unknown>;
      if (d?.petitionerId) moveAgent(d.petitionerId as string, 'supreme-court');
      if (d?.respondentId) moveAgent(d.respondentId as string, 'supreme-court');
      triggerPulse('supreme-court', '#6B7A8D');
      addTickerEvent(String(d?.caseNumber ?? 'Case'), `filed: ${String(d?.caption ?? '')}`, 'judicial');
    }));

    // court:hearing — oral argument heard
    unsubs.push(subscribe('court:hearing', (data: unknown) => {
      const d = data as Record<string, unknown>;
      triggerPulse('supreme-court', '#6B7A8D');
      addTickerEvent(String(d?.caseNumber ?? 'Case'), `oral argument heard in ${String(d?.caption ?? '')}`, 'judicial');
    }));

    // court:ruling — decision handed down
    unsubs.push(subscribe('court:ruling', (data: unknown) => {
      const d = data as Record<string, unknown>;
      const color = d?.outcome === 'struck_down' ? '#8B3A3A' : '#6B7A8D';
      triggerPulse('supreme-court', color);
      addTickerEvent(
        String(d?.caseNumber ?? 'Case'),
        `decided ${String(d?.votesFor ?? 0)}–${String(d?.votesAgainst ?? 0)}: ${String(d?.caption ?? '')}`,
        'judicial',
      );
    }));

    return () => unsubs.forEach((fn) => fn());
  }, [subscribe, moveAgent, triggerPulse, addSpeechBubble, addTickerEvent]);

  return {
    agents,
    agentLocations,
    speechBubbles,
    buildingPulses,
    tickerEvents,
    selectedAgent,
    setSelectedAgent,
    isLoading,
  };
}
