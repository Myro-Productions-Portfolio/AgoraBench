import React from 'react';
import { MapEventTicker } from 'agora-bench';

// The ticker is an absolute bottom bar over the map viewport — each cell gives it
// a relative map-region stand-in to pin to. Event shapes mirror
// useAgentMap.addTickerEvent (highlight = actor / quoted bill, text = what happened).
const MapRegion = ({ children }: { children?: React.ReactNode }) => (
  <div
    style={{
      position: 'relative',
      width: '100%',
      height: 130,
      background: 'radial-gradient(ellipse at center, #22242A 0%, #1A1B1E 80%)',
      borderRadius: 8,
      overflow: 'hidden',
    }}
  >
    {children}
  </div>
);

const T0 = 1747310400000;

/* Busy legislative session — vote, bill, campaign and election events mixed */
export const BusyFeed = () => (
  <MapRegion>
    <MapEventTicker
      events={[
        { id: 'tick-9', highlight: 'Vera Okonkwo', text: 'voted yea on "Renewable Grid Modernization Act"', type: 'vote', timestamp: T0 },
        { id: 'tick-8', highlight: 'Garrett Voss', text: 'proposed "Fiscal Responsibility and Sunset Provisions Act"', type: 'bill', timestamp: T0 - 42000 },
        { id: 'tick-7', highlight: 'Nora Callahan', text: 'campaigning at Party Hall for Senate Seat 3', type: 'campaign', timestamp: T0 - 96000 },
        { id: 'tick-6', highlight: '"Open Deliberation Act"', text: 'passed into law (7 yea, 2 nay)', type: 'bill', timestamp: T0 - 150000 },
        { id: 'tick-5', highlight: 'Election Center', text: 'voting underway: President of the Agora', type: 'election', timestamp: T0 - 204000 },
      ]}
    />
  </MapRegion>
);

/* Quiet tick — a lone floor vote scrolling by */
export const QuietFeed = () => (
  <MapRegion>
    <MapEventTicker
      events={[
        { id: 'tick-2', highlight: 'Sam Ritter', text: 'voted nay on "Emergency Powers Extension Act"', type: 'vote', timestamp: T0 },
        { id: 'tick-1', highlight: '"MG-044"', text: 'advanced: committee → floor', type: 'bill', timestamp: T0 - 78000 },
      ]}
    />
  </MapRegion>
);

/* Election night — green election highlights dominate the crawl */
export const ElectionNight = () => (
  <MapRegion>
    <MapEventTicker
      events={[
        { id: 'tick-14', highlight: 'Arjun Mehta', text: 'elected President of the Agora (34 votes)', type: 'election', timestamp: T0 },
        { id: 'tick-13', highlight: 'Zara Moss', text: 'conceded the presidential race', type: 'election', timestamp: T0 - 30000 },
        { id: 'tick-12', highlight: 'Leila Farsi', text: 'campaigning: "The center holds when we hold it together"', type: 'campaign', timestamp: T0 - 88000 },
        { id: 'tick-11', highlight: 'Election Center', text: 'certifying final tallies', type: 'election', timestamp: T0 - 132000 },
      ]}
    />
  </MapRegion>
);
