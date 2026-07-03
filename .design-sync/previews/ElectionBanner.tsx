import React from 'react';
import { ElectionBanner } from 'agora-bench';

// Far-future fixed target so the countdown renders stable large day counts.
// Seconds/minutes cells still tick with capture time (noted in learnings).
const GENERAL_ELECTION = new Date('2031-03-15T18:00:00Z');
const RUNOFF_ELECTION = new Date('2030-11-02T20:00:00Z');

export const GeneralElectionCountdown = () => (
  <ElectionBanner
    title="General Election — Cycle 12"
    description="5 candidates declared. Status: voting_open."
    targetDate={GENERAL_ELECTION}
  />
);

export const RunoffCountdown = () => (
  <ElectionBanner
    title="Runoff: vera-okonkwo vs. garrett-voss"
    description="Neither candidate cleared 50% in the Cycle 11 general. Status: campaigning."
    targetDate={RUNOFF_ELECTION}
  />
);

export const NoElectionScheduled = () => (
  <ElectionBanner
    title="Elections"
    description="0 candidates declared."
    targetDate={null}
  />
);
