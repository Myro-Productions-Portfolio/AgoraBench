import React from 'react';
import { EventDetailModal } from 'agora-bench';

// The harness's story root has transform:translateZ(0), which re-scopes the
// modal's position:fixed to the cell box. Give the cell a full-viewport-height
// in-flow body so the fixed backdrop/centering has a real box to fill.
const Stage = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ height: 'calc(100vh - 80px)' }}>{children}</div>
);

export const CommitteeHearingScheduled = () => (
  <Stage>
    <EventDetailModal
      event={{
        id: 'evt-2041',
        type: 'committee_hearing',
        title: 'Budget Committee Hearing on MG-031 Fiscal Note',
        description:
          'The Budget committee convenes to review the fiscal note attached to MG-031 (Fiscal Responsibility and Sunset Provisions Act). Sponsor garrett-voss will present projected outlays; nora-callahan and zara-moss are scheduled to question the M$50M sunset threshold.',
        scheduledAt: '2026-07-09T14:00:00Z',
        durationMinutes: 90,
        locationBuildingId: 'capitol',
        status: 'scheduled',
        outcome: null,
        isPublic: true,
      }}
      onClose={() => {}}
    />
  </Stage>
);

export const FloorSessionInProgress = () => (
  <Stage>
    <EventDetailModal
      event={{
        id: 'evt-2044',
        type: 'floor_session',
        title: 'Floor Vote: MG-047 Renewable Grid Modernization Act',
        description:
          'Full chamber floor session on MG-047. Sponsor vera-okonkwo opens debate on the M$120M grid retrofit allocation. The Progressive Alliance and Technocratic Union have signaled yea; the Liberty First Party is expected to move an amendment striking the distributed-storage mandate.',
        scheduledAt: '2026-07-08T16:30:00Z',
        durationMinutes: 120,
        locationBuildingId: 'capitol',
        status: 'in_progress',
        outcome: null,
        isPublic: true,
      }}
      onClose={() => {}}
    />
  </Stage>
);

export const JudicialHearingCompleted = () => (
  <Stage>
    <EventDetailModal
      event={{
        id: 'evt-1987',
        type: 'judicial_hearing',
        title: 'Constitutional Challenge to MG-044 Emergency Powers Extension',
        description:
          'The court hears the Constitutional Order Party challenge to MG-044, arguing the two-tick extension of executive emergency authority exceeds charter limits. Counsel for petitioner: leila-farsi. Counsel for the executive: dax-nguyen.',
        scheduledAt: '2026-06-30T10:00:00Z',
        durationMinutes: 150,
        locationBuildingId: 'supreme-court',
        status: 'completed',
        outcome:
          'Struck down 4-1. The court held that emergency authority extensions require a supermajority floor vote; MG-044 passed on a 5-5 tie broken by the executive, which the charter does not permit for emergency-powers legislation. Dissent by sable-chen filed to the public gazette.',
        isPublic: true,
      }}
      onClose={() => {}}
    />
  </Stage>
);

export const ElectionRallyCancelled = () => (
  <Stage>
    <EventDetailModal
      event={{
        id: 'evt-2050',
        type: 'election_rally',
        title: 'Moderate Coalition Rally for finn-kalani',
        description:
          'Campaign rally for finn-kalani ahead of the Cycle 12 general election. Planned speakers included arjun-mehta on the Universal Basic Compute platform (MG-052) and endorsements from three Budget committee members.',
        scheduledAt: '2026-07-11T19:00:00Z',
        durationMinutes: 60,
        locationBuildingId: 'election-center',
        status: 'cancelled',
        outcome:
          'Cancelled after the Election Commission flagged an unreported M$12,500 contribution to the campaign fund. The Moderate Coalition rescheduled pending an audit.',
        isPublic: true,
      }}
      onClose={() => {}}
    />
  </Stage>
);
