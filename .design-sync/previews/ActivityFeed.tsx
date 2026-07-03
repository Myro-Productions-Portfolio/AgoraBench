import React from 'react';
import { ActivityFeed } from 'agora-bench';

const recentItems = [
  {
    id: 'act-01',
    type: 'vote' as const,
    highlight: 'vera-okonkwo',
    text: 'voted YEA on MG-047 Renewable Grid Modernization Act, citing district energy shortfalls.',
    time: '4m ago',
  },
  {
    id: 'act-02',
    type: 'bill' as const,
    highlight: 'arjun-mehta',
    text: 'introduced MG-053 Universal Basic Compute Act, referred to the Social Welfare committee.',
    time: '11m ago',
  },
  {
    id: 'act-03',
    type: 'party' as const,
    highlight: 'sable-chen',
    text: 'defected from the Moderate Coalition to join the Technocratic Union after the budget vote.',
    time: '18m ago',
  },
  {
    id: 'act-04',
    type: 'vote' as const,
    highlight: 'garrett-voss',
    text: 'voted NAY on MG-052, warning the M$250 stipend would blow a hole in the M$1.2B budget.',
    time: '26m ago',
  },
  {
    id: 'act-05',
    type: 'campaign' as const,
    highlight: 'nora-callahan',
    text: 'launched a Senate campaign on a Constitutional Order Party platform of sunset clauses.',
    time: '33m ago',
  },
  {
    id: 'act-06',
    type: 'bill' as const,
    highlight: 'leila-farsi',
    text: 'advanced MG-039 Judicial Transparency and Records Act out of the Judiciary committee.',
    time: '41m ago',
  },
  {
    id: 'act-07',
    type: 'vote' as const,
    highlight: 'dax-nguyen',
    text: 'abstained on MG-044 Emergency Powers Extension Act pending a fiscal note from Budget.',
    time: '47m ago',
  },
  {
    id: 'act-08',
    type: 'campaign' as const,
    highlight: 'finn-kalani',
    text: 'gained 6 approval points after the floor debate on grid modernization funding.',
    time: '55m ago',
  },
];

const electionNightItems = [
  {
    id: 'en-01',
    type: 'campaign' as const,
    highlight: 'zara-moss',
    text: 'won the Presidency with 54% of the vote, unseating the Liberty First Party incumbent.',
    time: '2m ago',
  },
  {
    id: 'en-02',
    type: 'party' as const,
    highlight: 'Progressive Alliance',
    text: 'secured a governing majority, taking 4 of 7 Senate seats in the general election.',
    time: '5m ago',
  },
  {
    id: 'en-03',
    type: 'campaign' as const,
    highlight: 'sam-ritter',
    text: 'conceded the Technology committee chair race after a M$180K campaign spend.',
    time: '9m ago',
  },
  {
    id: 'en-04',
    type: 'party' as const,
    highlight: 'garrett-voss',
    text: 'was elected floor leader of the Constitutional Order Party by acclamation.',
    time: '14m ago',
  },
];

/** Canonical dashboard feed — a mixed hour of votes, bills, party moves, and campaign events. */
export const RecentActivity = () => (
  <div style={{ width: 620 }}>
    <ActivityFeed items={recentItems} />
  </div>
);

/** Election-night feed — campaign and party activity dominating the wire. */
export const ElectionNight = () => (
  <div style={{ width: 620 }}>
    <ActivityFeed items={electionNightItems} />
  </div>
);

/** Empty state — no simulation events in the last hour. */
export const QuietHour = () => (
  <div style={{ width: 620 }}>
    <ActivityFeed items={[]} />
  </div>
);
