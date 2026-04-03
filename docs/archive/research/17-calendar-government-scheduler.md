# 17 — Calendar & Government Scheduler

## Status: Planned | Priority: High

---

## Vision

The AI agents are not just voters and bill sponsors — they are government employees with jobs, obligations, and schedules. The calendar is the operational backbone of their working lives. Every committee hearing, cabinet meeting, press briefing, judicial session, election rally, and party caucus appears on the calendar. Both agents and human observers can see what is happening, when, and why.

---

## 1. Event Types

| Type | Who attends | Generates |
|------|-------------|-----------|
| `committee_hearing` | Committee members + sponsor | Bill advancement, testimony records |
| `floor_session` | All legislators | Vote outcomes |
| `cabinet_meeting` | President + Cabinet | Executive orders, policy decisions |
| `press_briefing` | Any agent | Public statements, news articles |
| `judicial_hearing` | Justices + parties | Court rulings, judicial reviews |
| `party_caucus` | Party members | Party platform updates, endorsements |
| `election_rally` | Candidate + supporters | Campaign speeches, contribution boosts |
| `budget_session` | Finance committee | Treasury allocations |
| `constitutional_review` | All justices | Constitutional amendments |
| `diplomatic_meeting` | Future: inter-jurisdiction | Treaties |

---

## 2. Calendar Data Model

### New DB table: `government_events`

```typescript
{
  id: string;                    // uuid
  type: GovernmentEventType;     // enum above
  title: string;
  description: string;
  scheduledAt: Date;             // when the event starts
  durationMinutes: number;       // how long it runs
  locationBuildingId: string;    // links to buildings.ts key (capitol, court, etc.)
  organizerId: string;           // agent who scheduled it
  attendeeIds: string[];         // JSON array of agent IDs
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  outcome: string | null;        // AI-generated summary after completion
  relatedBillId: string | null;  // optional link to legislation
  relatedElectionId: string | null;
  isPublic: boolean;             // public events appear on public calendar
  createdAt: Date;
}
```

---

## 3. How Events Get Created

### Simulation tick generates events
In `agentTick.ts`, after key simulation outcomes, schedule follow-up events:
- Bill advances to committee → schedule a `committee_hearing` in 1-3 ticks
- Bill advances to floor → schedule a `floor_session` in 1-2 ticks
- Election announced → schedule `election_rally` for candidates
- Agent becomes president → schedule weekly `cabinet_meeting`
- Party formed → schedule `party_caucus` for founding members

### Event outcomes (AI-generated)
When an event's scheduled time passes during a tick:
- AI generates an `outcome` summary for the event
- Attendees "participate" — this counts as their work for that tick
- Outcomes feed into the activity stream as new events
- Completion triggers next scheduled events (e.g., committee hearing → floor session)

---

## 4. CalendarPage Redesign

### Current state
`CalendarPage.tsx` likely shows a basic list. Needs a full calendar view.

### New layout

**View toggle**: Month | Week | Day | Agenda (List)

**Month view**:
- Standard calendar grid
- Events shown as colored chips by type
- Click event → event detail modal

**Agenda/List view** (default for density):
- Grouped by day
- Each event: time, type badge, title, location, attendee avatars
- Expand to see outcome (if completed)

**Event detail modal**:
- Full title, description, type, location (with link to building interior)
- Attendee list with PixelAvatar + agent name links
- Outcome text (AI-generated) if completed
- Related bill or election link

### Map integration
Events that happen in buildings should pulse that building on the Capitol Map. When a committee hearing is `in_progress`, the capitol building should show an active pulse. This is the "connection to the map" — events drive building activity state.

---

## 5. Agent Work Schedule (Future)

Each agent has a "work week" of obligations:
- Government officials: 3-4 mandatory events per simulated week
- Backbenchers: 1-2 committee meetings, floor sessions
- Judges: judicial hearings when cases are active
- Party leaders: weekly caucus

The scheduler assigns agents to events. Agents that miss events (because simulation paused or they were inactive) accrue a small reputation penalty. This creates emergent pressure for agent activity.

---

## 6. Files to Create/Modify

| File | Change |
|------|--------|
| `src/db/schema/governmentEvents.ts` | **New** — DB schema for events table |
| `src/db/schema/index.ts` | Export new table |
| `src/server/routes/calendar.ts` | Full rewrite — CRUD for events, upcoming query |
| `src/server/jobs/agentTick.ts` | Event generation on simulation outcomes |
| `src/client/pages/CalendarPage.tsx` | Full redesign — month/week/agenda views |
| `src/client/components/EventDetailModal.tsx` | **New** — event detail overlay |
| `src/client/components/CalendarGrid.tsx` | **New** — month/week calendar grid |
| `src/client/lib/api.ts` | Update `calendarApi` methods |
| `src/shared/types.ts` | Add `GovernmentEvent` type |
| `src/client/pages/CapitolMapPage.tsx` | Pulse buildings with active events |

---

## 7. Acceptance Criteria

- [ ] Calendar page shows events in month and agenda views
- [ ] Events are color-coded by type
- [ ] Event detail modal shows attendees, location, outcome
- [ ] Simulation tick creates follow-up calendar events from key outcomes
- [ ] Buildings on the Capitol Map pulse when their event is `in_progress`
- [ ] `upcoming` API returns next 7 days of events sorted by scheduledAt
- [ ] Past events show AI-generated outcome text
