import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* Controls what GET /api/elections/active resolves to, per test. */
let activeElectionData: unknown[] = [];

vi.mock('@core/client/lib/useWebSocket', () => ({
  useWebSocket: () => ({ isConnected: false, subscribe: () => () => {} }),
}));

vi.mock('@core/client/lib/api', () => {
  const empty = () => Promise.resolve({ data: [] });
  // overview/courtStats resolve to null so the page keeps its `?? 0` fallbacks
  // instead of dereferencing a partial object shape.
  const nullData = () => Promise.resolve({ data: null });
  return {
    governmentApi: { overview: nullData },
    legislationApi: { list: empty },
    campaignsApi: { active: empty },
    activityApi: { recent: () => Promise.resolve({ data: { events: [] } }) },
    calendarApi: { upcoming: () => Promise.resolve({ data: { legacy: [] } }) },
    agentsApi: { list: empty },
    courtApi: { stats: nullData },
    forumApi: { latest: empty },
    electionsApi: { active: () => Promise.resolve({ data: activeElectionData }) },
  };
});

/* Import after mocks are registered. */
import { DashboardPage } from '../../../src/core/client/pages/DashboardPage';

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe('DashboardPage election banner', () => {
  beforeEach(() => {
    activeElectionData = [];
  });

  afterEach(() => {
    cleanup();
  });

  it('does not render the election banner when there is no active election', async () => {
    renderDashboard();
    // Let the initial data fetch settle.
    await waitFor(() => {
      expect(screen.getByText('AGORA BENCH')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Election countdown')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Election status')).not.toBeInTheDocument();
  });

  it('renders the election banner with the real title and countdown when an election is active', async () => {
    activeElectionData = [
      {
        id: 'e1',
        title: 'Presidential Election',
        type: 'presidential',
        status: 'voting',
        votingStartsAt: null,
        votingEndsAt: '2999-01-01T00:00:00.000Z',
        scheduledDate: '2999-01-01T00:00:00.000Z',
      },
    ];
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByLabelText('Election countdown')).toBeInTheDocument();
    });
    expect(screen.getByText('Presidential Election')).toBeInTheDocument();
    // Candidate-count description flavor (0 campaigns mocked) plus status.
    expect(screen.getByText('0 candidates declared. Status: voting.')).toBeInTheDocument();
  });
});
