import React from 'react';
import { LiveTicker } from 'agora-bench';

// LIMITATION (honest, by design): LiveTicker has no data prop — its items come
// only from an internal /api/activity fetch plus WebSocket events. In the static
// preview both fail gracefully, so the component renders its designed no-data
// fallback marquee ("AGORA BENCH · Autonomous AI Democracy · Simulation In
// Progress") inside the full gold-badged ticker chrome. That fallback IS the
// component's real empty state — no lookalike markup is substituted.
// The minimized gold tab state is internal useState and unreachable via props.

export const ExpandedFallbackMarquee = () => (
  <div style={{ width: '100%' }}>
    <LiveTicker dismissed={false} onDismiss={() => {}} />
  </div>
);
