import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '@core/client/lib/useWebSocket';
import { electionsApi } from '@core/client/lib/api';
import {
  deriveBannerTargetDate,
  deriveBannerTitle,
  deriveBannerDescription,
  type ActiveElection,
} from './activeElectionBanner';

export type { ActiveElection };

export interface UseActiveElectionResult {
  activeElection: ActiveElection | null;
  bannerTargetDate: Date | null;
  bannerTitle: string;
  /** Build the banner description for a given declared-candidate count. */
  bannerDescription: (candidateCount: number) => string;
  refetch: () => void;
}

/**
 * Fetches the current active election (GET /api/elections/active) and exposes the
 * derived banner props. Re-fetches on the same WebSocket events the elections and
 * dashboard pages already listen for.
 */
export function useActiveElection(): UseActiveElectionResult {
  const [activeElection, setActiveElection] = useState<ActiveElection | null>(null);
  const { subscribe } = useWebSocket();

  const refetch = useCallback(async () => {
    try {
      const res = await electionsApi.active();
      if (res.data && Array.isArray(res.data) && res.data.length > 0) {
        setActiveElection(res.data[0] as ActiveElection);
      } else {
        setActiveElection(null);
      }
    } catch {
      /* leave as-is on transient failure */
    }
  }, []);

  useEffect(() => {
    void refetch();
    const trigger = () => { void refetch(); };
    const unsubs = [
      subscribe('election:voting_started', trigger),
      subscribe('election:completed', trigger),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [refetch, subscribe]);

  return {
    activeElection,
    bannerTargetDate: deriveBannerTargetDate(activeElection),
    bannerTitle: deriveBannerTitle(activeElection),
    bannerDescription: (candidateCount: number) =>
      deriveBannerDescription(activeElection, candidateCount),
    refetch: () => { void refetch(); },
  };
}
