import { useState, useEffect, useMemo, useCallback } from 'react';
import { agentsApi } from '@core/client/lib/api';

/* ── Types ─────────────────────────────────────────────────────────────── */

interface CoalitionAgent {
  id: string;
  displayName: string;
  alignment: string | null;
  approvalRating: number;
}

interface Relationship {
  sourceId: string;
  targetId: string;
  alignment: number;
}

interface Bloc {
  members: string[];
  avgAlignment: number;
  label: string;
}

interface CoalitionData {
  agents: CoalitionAgent[];
  relationships: Relationship[];
  blocs: Bloc[];
}

/* ── Color helpers ─────────────────────────────────────────────────────── */

function alignmentCellColor(value: number): string {
  if (value > 0.8) return 'bg-green-600';
  if (value > 0.6) return 'bg-green-800/70';
  if (value > 0.4) return 'bg-zinc-600/50';
  if (value > 0.2) return 'bg-red-900/60';
  return 'bg-red-700/70';
}

function alignmentCellBorder(value: number): string {
  if (value > 0.8) return 'border-green-500/30';
  if (value > 0.6) return 'border-green-700/20';
  if (value > 0.4) return 'border-zinc-500/20';
  if (value > 0.2) return 'border-red-800/20';
  return 'border-red-600/30';
}

const ALIGNMENT_BADGE: Record<string, string> = {
  progressive: 'text-yellow-400 bg-yellow-900/20 border-yellow-700/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat: 'text-green-400 bg-green-900/20 border-green-700/30',
  moderate: 'text-stone-300 bg-stone-800/20 border-stone-600/30',
  libertarian: 'text-red-400 bg-red-900/20 border-red-700/30',
};

/* ── Component ─────────────────────────────────────────────────────────── */

export function CoalitionView() {
  const [data, setData] = useState<CoalitionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{ row: string; col: string } | null>(null);

  useEffect(() => {
    agentsApi
      .coalitions()
      .then((res) => {
        setData(res.data as CoalitionData);
      })
      .catch((e) => {
        console.error('[CoalitionView] failed to load coalitions', e);
        setError('Failed to load coalition data.');
      })
      .finally(() => setLoading(false));
  }, []);

  /* Build pair lookup: "idA|idB" -> alignment */
  const pairMap = useMemo(() => {
    if (!data) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const r of data.relationships) {
      const key = [r.sourceId, r.targetId].sort().join('|');
      m.set(key, r.alignment);
    }
    return m;
  }, [data]);

  /* Sort agents so bloc members cluster together.
     Assign each agent a sort key: bloc index first, then alignment, then name. */
  const sortedAgents = useMemo(() => {
    if (!data) return [];
    const blocIndex = new Map<string, number>();
    data.blocs.forEach((bloc, idx) => {
      for (const mid of bloc.members) {
        blocIndex.set(mid, idx);
      }
    });
    return [...data.agents].sort((a, b) => {
      const aBloc = blocIndex.get(a.id) ?? 999;
      const bBloc = blocIndex.get(b.id) ?? 999;
      if (aBloc !== bBloc) return aBloc - bBloc;
      const aAlign = a.alignment?.toLowerCase() ?? '';
      const bAlign = b.alignment?.toLowerCase() ?? '';
      if (aAlign !== bAlign) return aAlign.localeCompare(bAlign);
      return a.displayName.localeCompare(b.displayName);
    });
  }, [data]);

  const agentMap = useMemo(() => {
    if (!data) return new Map<string, CoalitionAgent>();
    return new Map(data.agents.map((a) => [a.id, a]));
  }, [data]);

  const getAlignment = useCallback(
    (idA: string, idB: string): number | null => {
      if (idA === idB) return 1;
      const key = [idA, idB].sort().join('|');
      return pairMap.get(key) ?? null;
    },
    [pairMap],
  );

  /* ── Render ──────────────────────────────────────────────────────────── */

  if (loading) {
    return <div className="py-20 text-center text-text-muted text-sm">Loading coalition data...</div>;
  }

  if (error) {
    return <div className="py-10 text-center text-danger text-sm">{error}</div>;
  }

  if (!data || data.agents.length === 0) {
    return <div className="py-20 text-center text-text-muted text-sm">No agent relationship data available yet.</div>;
  }

  const hoveredAlignment =
    hoveredCell && hoveredCell.row !== hoveredCell.col
      ? getAlignment(hoveredCell.row, hoveredCell.col)
      : null;
  const hoveredRowAgent = hoveredCell ? agentMap.get(hoveredCell.row) : null;
  const hoveredColAgent = hoveredCell ? agentMap.get(hoveredCell.col) : null;

  return (
    <div className="space-y-8">
      {/* ── Detected Blocs ──────────────────────────────────────────────── */}
      <section>
        <h2 className="font-serif text-xl font-semibold text-text-primary mb-4">Detected Voting Blocs</h2>
        {data.blocs.length === 0 ? (
          <p className="text-sm text-text-muted">
            No strong voting blocs detected (requires 3+ agents with mutual alignment above 70%).
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.blocs.map((bloc, idx) => (
              <BlocCard key={idx} bloc={bloc} agentMap={agentMap} />
            ))}
          </div>
        )}
      </section>

      {/* ── Alignment Matrix ────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-serif text-xl font-semibold text-text-primary">Alignment Matrix</h2>
            <p className="text-sm text-text-muted mt-0.5">
              Vote alignment between all agents. Hover a cell for details.
            </p>
          </div>

          {/* Tooltip for hovered cell */}
          {hoveredCell && hoveredRowAgent && hoveredColAgent && hoveredCell.row !== hoveredCell.col && (
            <div className="text-sm text-text-secondary bg-surface border border-border rounded px-3 py-1.5">
              <span className="text-text-primary font-medium">{hoveredRowAgent.displayName}</span>
              {' + '}
              <span className="text-text-primary font-medium">{hoveredColAgent.displayName}</span>
              {': '}
              {hoveredAlignment !== null ? (
                <span className="font-mono">{(hoveredAlignment * 100).toFixed(0)}% alignment</span>
              ) : (
                <span className="text-text-muted">No data</span>
              )}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 mb-3 text-xs text-text-muted">
          <span>Low</span>
          <div className="flex gap-0.5">
            <div className="w-5 h-3 rounded-sm bg-red-700/70" />
            <div className="w-5 h-3 rounded-sm bg-red-900/60" />
            <div className="w-5 h-3 rounded-sm bg-zinc-600/50" />
            <div className="w-5 h-3 rounded-sm bg-green-800/70" />
            <div className="w-5 h-3 rounded-sm bg-green-600" />
          </div>
          <span>High</span>
        </div>

        {/* Matrix container -- horizontally scrollable for many agents */}
        <div className="overflow-auto border border-border rounded-lg bg-surface/50">
          <div
            className="inline-grid"
            style={{
              gridTemplateColumns: `140px repeat(${sortedAgents.length}, 28px)`,
              gridTemplateRows: `32px repeat(${sortedAgents.length}, 28px)`,
            }}
          >
            {/* Top-left corner (empty) */}
            <div className="sticky left-0 z-20 bg-surface/90 backdrop-blur-sm border-b border-r border-border" />

            {/* Column headers */}
            {sortedAgents.map((agent) => (
              <div
                key={`col-${agent.id}`}
                className="border-b border-border flex items-end justify-center pb-0.5"
                title={agent.displayName}
              >
                <span
                  className="text-[9px] text-text-muted font-medium leading-none whitespace-nowrap overflow-hidden"
                  style={{
                    writingMode: 'vertical-rl',
                    textOrientation: 'mixed',
                    maxHeight: '28px',
                  }}
                >
                  {agent.displayName.length > 8
                    ? agent.displayName.slice(0, 7) + '.'
                    : agent.displayName}
                </span>
              </div>
            ))}

            {/* Rows */}
            {sortedAgents.map((rowAgent) => (
              <>
                {/* Row label */}
                <div
                  key={`row-${rowAgent.id}`}
                  className="sticky left-0 z-10 bg-surface/90 backdrop-blur-sm border-r border-border flex items-center px-2"
                >
                  <span className="text-[11px] text-text-secondary font-medium truncate">
                    {rowAgent.displayName}
                  </span>
                </div>

                {/* Cells */}
                {sortedAgents.map((colAgent) => {
                  const val = getAlignment(rowAgent.id, colAgent.id);
                  const isDiagonal = rowAgent.id === colAgent.id;
                  const isHovered =
                    hoveredCell?.row === rowAgent.id && hoveredCell?.col === colAgent.id;

                  return (
                    <div
                      key={`${rowAgent.id}-${colAgent.id}`}
                      className={`
                        w-[28px] h-[28px] border transition-all duration-75 cursor-crosshair
                        ${isDiagonal ? 'bg-zinc-700/30 border-zinc-600/20' : ''}
                        ${!isDiagonal && val !== null ? `${alignmentCellColor(val)} ${alignmentCellBorder(val)}` : ''}
                        ${!isDiagonal && val === null ? 'bg-zinc-800/20 border-zinc-700/10' : ''}
                        ${isHovered ? 'ring-1 ring-gold/60 z-10' : ''}
                      `}
                      onMouseEnter={() => setHoveredCell({ row: rowAgent.id, col: colAgent.id })}
                      onMouseLeave={() => setHoveredCell(null)}
                    />
                  );
                })}
              </>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ── Bloc Card ─────────────────────────────────────────────────────────── */

function BlocCard({
  bloc,
  agentMap,
}: {
  bloc: Bloc;
  agentMap: Map<string, CoalitionAgent>;
}) {
  const members = bloc.members
    .map((id) => agentMap.get(id))
    .filter((a): a is CoalitionAgent => a !== undefined);

  return (
    <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-text-primary text-sm">{bloc.label}</h3>
        <span className="text-xs font-mono text-text-muted">
          {(bloc.avgAlignment * 100).toFixed(0)}% avg
        </span>
      </div>

      {/* Alignment bar */}
      <div className="h-1.5 rounded-full bg-border overflow-hidden">
        <div
          className="h-full rounded-full bg-green-500 transition-all"
          style={{ width: `${(bloc.avgAlignment * 100).toFixed(0)}%` }}
        />
      </div>

      {/* Member chips */}
      <div className="flex flex-wrap gap-1.5">
        {members.map((agent) => {
          const alignKey = agent.alignment?.toLowerCase() ?? '';
          const badgeClass =
            ALIGNMENT_BADGE[alignKey] ?? 'text-text-muted bg-border/10 border-border/30';
          return (
            <span
              key={agent.id}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border ${badgeClass}`}
            >
              {agent.displayName}
            </span>
          );
        })}
      </div>

      <div className="text-xs text-text-muted">
        {members.length} member{members.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
