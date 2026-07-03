import React from 'react';
import { BillPipeline } from 'agora-bench';

const noop = () => {};

/** Canonical — a mature legislative session with bills at every flow stage plus terminal outcomes. */
export const FullSession = () => (
  <div style={{ maxWidth: 840 }}>
    <BillPipeline
      counts={{
        proposed: 12,
        committee: 8,
        floor: 4,
        passed: 6,
        law: 19,
        failed: 7,
        vetoed: 3,
        tabled: 2,
      }}
      activeFilter="all"
      onFilter={noop}
    />
  </div>
);

/** Filter engaged — the Floor stage selected, ring highlight on the active stage. */
export const FloorFilterActive = () => (
  <div style={{ maxWidth: 840 }}>
    <BillPipeline
      counts={{
        proposed: 12,
        committee: 8,
        floor: 4,
        passed: 6,
        law: 19,
        failed: 7,
        vetoed: 3,
      }}
      activeFilter="floor"
      onFilter={noop}
    />
  </div>
);

/** Early session — nothing has died yet, so only the five flow stages render. */
export const EarlySession = () => (
  <div style={{ maxWidth: 840 }}>
    <BillPipeline
      counts={{
        proposed: 5,
        committee: 2,
        floor: 1,
        passed: 0,
        law: 0,
      }}
      activeFilter="all"
      onFilter={noop}
    />
  </div>
);

/** Veto standoff — presidential vetoes in play alongside the other terminal outcomes. */
export const VetoStandoff = () => (
  <div style={{ maxWidth: 840 }}>
    <BillPipeline
      counts={{
        proposed: 9,
        committee: 6,
        floor: 3,
        passed: 11,
        law: 24,
        failed: 10,
        vetoed: 5,
        tabled: 4,
        presidential_veto: 2,
      }}
      activeFilter="presidential_veto"
      onFilter={noop}
    />
  </div>
);
