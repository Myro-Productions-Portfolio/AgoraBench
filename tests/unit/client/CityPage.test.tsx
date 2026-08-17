import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

/* Controls what GET /api/city/state resolves to, per test. */
let cityStateData: unknown = { started: false };

vi.mock('@core/client/lib/api', () => ({
  cityApi: {
    state: () => Promise.resolve({ success: true, data: cityStateData }),
    history: () => Promise.resolve({ success: true, data: { snapshots: [] } }),
  },
}));

/* Import after mocks are registered. */
import { CityPage } from '../../../src/modules/city/client/pages/CityPage';

describe('CityPage', () => {
  beforeEach(() => {
    cityStateData = { started: false };
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the not-founded empty state when the city has not started', async () => {
    render(<CityPage />);
    await waitFor(() => {
      expect(screen.getByText('The city has not been founded yet')).toBeInTheDocument();
    });
    expect(screen.queryByLabelText('Capitol City map')).not.toBeInTheDocument();
  });

  it('renders map, stat strip, and delta line when the city is live', async () => {
    cityStateData = {
      started: true,
      tickNumber: 1290,
      cityTimeMonths: 26,
      updatedAt: '2026-08-17T00:00:00.000Z',
      map: { width: 2, height: 2, categories: btoa(String.fromCharCode(0, 1, 10, 12)) },
      stats: {
        population: 8754,
        cityClass: 'Town',
        cityScore: 640,
        funds: 17130,
        taxRate: 16,
        resValve: 300,
        comValve: -50,
        indValve: 0,
        crimeAverage: 29,
        pollutionAverage: 27,
        landValueAverage: 88,
      },
      delta: { population: 214, funds: -1120, score: 28, crime: 5, pollution: -4 },
    };
    render(<CityPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Capitol City map')).toBeInTheDocument();
    });
    expect(screen.getByText('8,754')).toBeInTheDocument();
    expect(screen.getByText('$17,130')).toBeInTheDocument();
    // Year 3, Month 3 = 26 months; shown in both the map header and stat strip.
    expect(screen.getAllByText(/Year 3, Month 3/).length).toBeGreaterThan(0);
    expect(
      screen.getByText('Population +214 · Funds −$1,120 · Score +28 · Crime up · Pollution down'),
    ).toBeInTheDocument();
  });

  it('hides the delta line when delta is null (fewer than 2 snapshots)', async () => {
    cityStateData = {
      started: true,
      tickNumber: 1,
      cityTimeMonths: 0,
      updatedAt: '2026-08-17T00:00:00.000Z',
      map: { width: 1, height: 1, categories: btoa(String.fromCharCode(1)) },
      stats: {
        population: 0,
        cityClass: 'Village',
        cityScore: 500,
        funds: 20000,
        taxRate: 7,
        resValve: 0,
        comValve: 0,
        indValve: 0,
        crimeAverage: 0,
        pollutionAverage: 0,
        landValueAverage: 0,
      },
      delta: null,
    };
    render(<CityPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Capitol City map')).toBeInTheDocument();
    });
    expect(screen.queryByText('This tick')).not.toBeInTheDocument();
  });
});
