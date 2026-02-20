import { useState, useEffect, useCallback } from 'react';
import { benchmarkApi } from '@core/client/lib/api';
import { useWebSocket } from '@core/client/lib/useWebSocket';

/* ── Types ──────────────────────────────────────────────────────────────── */

interface Scenario {
  id: string;
  name: string;
  description: string;
  tier: number;
  difficulty: string | null;
  category: string | null;
  runLength: number;
  isBuiltIn: boolean;
  worldConfig: Record<string, unknown> | null;
  agentConfig: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
  events: unknown[] | null;
}

interface MetricsReport {
  composite: number;
  grade: string;
  dimensions?: Record<string, number>;
  outcomeMetrics?: Record<string, number>;
  agentMetrics?: Record<string, number>;
  coordinationMetrics?: Record<string, number>;
}

interface BenchmarkRun {
  id: string;
  scenarioId: string;
  status: string;
  modelName: string;
  modelBackend: string;
  modelEndpoint: string | null;
  configHash: string;
  agentAssignment: string;
  triggeredBy: string;
  callbackUrl: string | null;
  ticksCompleted: number;
  ticksTotal: number;
  metricsReport: MetricsReport | null;
  rawData: unknown | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface LeaderboardRow {
  rank: number;
  modelName: string;
  avgComposite: number | null;
  bestGrade: string | null;
  totalRuns: number;
  avgDurationSeconds: number | null;
}

/* ── Style Constants ────────────────────────────────────────────────────── */

const GOLD = '#C9A84C';
const BG_DARK = '#0d0d1a';
const BG_CARD = '#1a1a2e';
const BG_CARD_HOVER = '#16213e';
const TEXT_PRIMARY = '#e8e8e8';
const TEXT_SECONDARY = '#888';
const TEXT_GOLD = '#C9A84C';
const BORDER = '#2a2a4e';
const SUCCESS = '#4CAF50';
const WARNING = '#FF9800';
const ERROR = '#f44336';
const INFO = '#2196F3';

const cardStyle: React.CSSProperties = {
  background: BG_CARD,
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  padding: 20,
};

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  borderBottom: `1px solid ${BORDER}`,
  marginBottom: 24,
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: '12px 20px',
    fontSize: 14,
    fontWeight: 500,
    borderBottom: `2px solid ${active ? GOLD : 'transparent'}`,
    color: active ? GOLD : TEXT_SECONDARY,
    background: 'transparent',
    border: 'none',
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: active ? GOLD : 'transparent',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  };
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: `1px solid ${BORDER}`,
  borderRadius: 4,
  padding: '8px 12px',
  fontSize: 13,
  color: TEXT_PRIMARY,
  outline: 'none',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  background: '#2A2B2F',
};

const goldBtnStyle: React.CSSProperties = {
  padding: '8px 20px',
  borderRadius: 4,
  background: 'rgba(201,168,76,0.2)',
  color: GOLD,
  border: `1px solid rgba(201,168,76,0.4)`,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.2s',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: TEXT_SECONDARY,
  marginBottom: 6,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function gradeColor(grade: string | null): string {
  if (!grade) return TEXT_SECONDARY;
  const g = grade.toUpperCase();
  if (g === 'A+' || g === 'A') return GOLD;
  if (g === 'B' || g === 'B+') return SUCCESS;
  if (g === 'C' || g === 'C+') return WARNING;
  if (g === 'D' || g === 'D+') return '#FF5722';
  if (g === 'F') return ERROR;
  return TEXT_SECONDARY;
}

function statusBadge(status: string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '2px 10px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  };
  switch (status) {
    case 'queued':
      return { ...base, color: TEXT_SECONDARY, background: 'rgba(136,136,136,0.15)' };
    case 'running':
      return { ...base, color: INFO, background: 'rgba(33,150,243,0.15)' };
    case 'completed':
      return { ...base, color: SUCCESS, background: 'rgba(76,175,80,0.15)' };
    case 'failed':
      return { ...base, color: ERROR, background: 'rgba(244,67,54,0.15)' };
    default:
      return { ...base, color: TEXT_SECONDARY, background: 'rgba(136,136,136,0.1)' };
  }
}

function tierBadge(tier: number): { label: string; color: string; bg: string } {
  switch (tier) {
    case 1:
      return { label: 'Tier 1 -- Active', color: SUCCESS, bg: 'rgba(76,175,80,0.12)' };
    case 2:
      return { label: 'Tier 2 -- Events', color: INFO, bg: 'rgba(33,150,243,0.12)' };
    case 3:
    default:
      return { label: 'Tier 3 -- Coming Soon', color: TEXT_SECONDARY, bg: 'rgba(136,136,136,0.1)' };
  }
}

function difficultyBadge(difficulty: string | null): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-block',
    padding: '1px 8px',
    borderRadius: 3,
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  };
  switch (difficulty) {
    case 'easy':
      return { ...base, color: SUCCESS, background: 'rgba(76,175,80,0.12)' };
    case 'medium':
      return { ...base, color: WARNING, background: 'rgba(255,152,0,0.12)' };
    case 'hard':
      return { ...base, color: ERROR, background: 'rgba(244,67,54,0.12)' };
    default:
      return { ...base, color: TEXT_SECONDARY, background: 'rgba(136,136,136,0.1)' };
  }
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '--';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '--';
  try {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 30) return `${diffD}d ago`;
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return '--';
  }
}

/* ── Tab Types ───────────────────────────────────────────────────────────── */

type Tab = 'scenarios' | 'runs' | 'leaderboard' | 'docs';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'runs', label: 'Runs' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'docs', label: 'API Docs' },
];

/* ── RunLaunchModal ──────────────────────────────────────────────────────── */

function RunLaunchModal({
  scenario,
  onClose,
  onSuccess,
}: {
  scenario: Scenario;
  onClose: () => void;
  onSuccess: (runIds: string[]) => void;
}) {
  const [modelName, setModelName] = useState('');
  const [modelBackend, setModelBackend] = useState<'internal' | 'external'>('internal');
  const [modelEndpoint, setModelEndpoint] = useState('');
  const [runs, setRuns] = useState(1);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successIds, setSuccessIds] = useState<string[] | null>(null);

  async function handleLaunch() {
    if (!modelName.trim()) {
      setError('Model name is required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await benchmarkApi.triggerRun({
        scenarioId: scenario.id,
        modelName: modelName.trim(),
        modelBackend,
        modelEndpoint: modelBackend === 'external' ? modelEndpoint.trim() : undefined,
        runs,
        callbackUrl: callbackUrl.trim() || undefined,
      });
      const data = res.data as { runIds: string[] };
      setSuccessIds(data.runIds);
      onSuccess(data.runIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger run');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: BG_CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: 28,
          width: '100%',
          maxWidth: 520,
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 600, color: TEXT_PRIMARY, margin: 0 }}>
            Launch Benchmark Run
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: TEXT_SECONDARY,
              fontSize: 20,
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            x
          </button>
        </div>

        {/* Scenario info */}
        <div
          style={{
            background: 'rgba(201,168,76,0.05)',
            border: `1px solid rgba(201,168,76,0.2)`,
            borderRadius: 6,
            padding: 12,
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 12, color: TEXT_GOLD, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Scenario
          </div>
          <div style={{ fontSize: 15, color: TEXT_PRIMARY, fontWeight: 500, marginTop: 2 }}>{scenario.name}</div>
          <div style={{ fontSize: 12, color: TEXT_SECONDARY, marginTop: 4 }}>{scenario.description}</div>
        </div>

        {successIds ? (
          <div>
            <div style={{ color: SUCCESS, fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
              Benchmark runs queued successfully.
            </div>
            <div style={{ fontSize: 12, color: TEXT_SECONDARY, marginBottom: 4 }}>Run IDs:</div>
            {successIds.map((id) => (
              <div
                key={id}
                style={{
                  fontFamily: 'monospace',
                  fontSize: 11,
                  color: TEXT_PRIMARY,
                  background: BG_DARK,
                  padding: '4px 8px',
                  borderRadius: 3,
                  marginBottom: 4,
                  wordBreak: 'break-all',
                }}
              >
                {id}
              </div>
            ))}
            <button onClick={onClose} style={{ ...goldBtnStyle, marginTop: 16, width: '100%' }}>
              Close
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Model Name */}
            <div>
              <label style={labelStyle}>Model Name</label>
              <input
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="e.g. gpt-oss-20b, claude-haiku-4-5"
                style={inputStyle}
              />
            </div>

            {/* Model Backend */}
            <div>
              <label style={labelStyle}>Model Backend</label>
              <div style={{ display: 'flex', gap: 16 }}>
                {(['internal', 'external'] as const).map((val) => (
                  <label
                    key={val}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 13,
                      color: modelBackend === val ? TEXT_PRIMARY : TEXT_SECONDARY,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="modelBackend"
                      value={val}
                      checked={modelBackend === val}
                      onChange={() => setModelBackend(val)}
                      style={{ accentColor: GOLD }}
                    />
                    {val.charAt(0).toUpperCase() + val.slice(1)}
                  </label>
                ))}
              </div>
            </div>

            {/* Model Endpoint (conditional) */}
            {modelBackend === 'external' && (
              <div>
                <label style={labelStyle}>Model Endpoint</label>
                <input
                  type="text"
                  value={modelEndpoint}
                  onChange={(e) => setModelEndpoint(e.target.value)}
                  placeholder="https://api.example.com/v1/chat/completions"
                  style={inputStyle}
                />
              </div>
            )}

            {/* Number of Runs */}
            <div>
              <label style={labelStyle}>Number of Runs (1-10)</label>
              <input
                type="number"
                min={1}
                max={10}
                value={runs}
                onChange={(e) => setRuns(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
                style={{ ...inputStyle, width: 100 }}
              />
            </div>

            {/* Callback URL */}
            <div>
              <label style={labelStyle}>Callback URL (optional)</label>
              <input
                type="text"
                value={callbackUrl}
                onChange={(e) => setCallbackUrl(e.target.value)}
                placeholder="https://your-server.com/webhook"
                style={inputStyle}
              />
            </div>

            {error && (
              <div style={{ color: ERROR, fontSize: 13 }}>{error}</div>
            )}

            <button
              onClick={() => void handleLaunch()}
              disabled={submitting || !modelName.trim()}
              style={{
                ...goldBtnStyle,
                width: '100%',
                opacity: submitting || !modelName.trim() ? 0.5 : 1,
                cursor: submitting || !modelName.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Launching...' : 'Launch Benchmark'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── ScenariosTab ────────────────────────────────────────────────────────── */

function ScenariosTab({
  scenarios,
  onLaunch,
}: {
  scenarios: Scenario[];
  onLaunch: (scenario: Scenario) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
        {scenarios.length} scenario{scenarios.length !== 1 ? 's' : ''} defined
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 16,
        }}
      >
        {scenarios.map((scenario) => {
          const tb = tierBadge(scenario.tier);
          const isTier3 = scenario.tier >= 3;
          return (
            <div
              key={scenario.id}
              style={{
                ...cardStyle,
                opacity: isTier3 ? 0.5 : 1,
                transition: 'border-color 0.2s',
              }}
              onMouseEnter={(e) => {
                if (!isTier3) (e.currentTarget.style.borderColor = GOLD + '40');
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = BORDER;
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 16, fontWeight: 600, color: TEXT_PRIMARY, margin: 0, flex: 1 }}>
                  {scenario.name}
                </h3>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 3,
                    color: tb.color,
                    background: tb.bg,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    whiteSpace: 'nowrap',
                    marginLeft: 8,
                  }}
                >
                  {tb.label}
                </span>
              </div>

              {/* Description */}
              <p style={{ fontSize: 13, color: TEXT_SECONDARY, margin: '0 0 12px 0', lineHeight: 1.5 }}>
                {scenario.description}
              </p>

              {/* Badges row */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                {scenario.difficulty && (
                  <span style={difficultyBadge(scenario.difficulty)}>
                    {scenario.difficulty}
                  </span>
                )}
                {scenario.category && (
                  <span
                    style={{
                      fontSize: 10,
                      padding: '1px 8px',
                      borderRadius: 3,
                      color: TEXT_SECONDARY,
                      background: 'rgba(136,136,136,0.1)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {scenario.category}
                  </span>
                )}
                <span
                  style={{
                    fontSize: 10,
                    padding: '1px 8px',
                    borderRadius: 3,
                    color: TEXT_SECONDARY,
                    background: 'rgba(136,136,136,0.1)',
                    fontFamily: 'monospace',
                  }}
                >
                  {scenario.runLength} ticks
                </span>
              </div>

              {/* Launch button */}
              {!isTier3 && (
                <button
                  onClick={() => onLaunch(scenario)}
                  style={{
                    ...goldBtnStyle,
                    width: '100%',
                    fontSize: 12,
                    padding: '6px 16px',
                  }}
                >
                  Launch Run
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── RunsTab ─────────────────────────────────────────────────────────────── */

function RunsTab({
  scenarios,
  runProgress,
}: {
  scenarios: Scenario[];
  runProgress: Record<string, { runId: string; percent: number; status?: string; grade?: string; composite?: number }>;
}) {
  const [runs, setRuns] = useState<BenchmarkRun[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  const scenarioMap = new Map(scenarios.map((s) => [s.id, s.name]));

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: page * PAGE_SIZE };
      if (filterStatus) params.status = filterStatus;
      if (filterModel.trim()) params.modelName = filterModel.trim();
      const res = await benchmarkApi.runs(params);
      const data = res.data as { runs: BenchmarkRun[]; total: number };
      setRuns(data.runs);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load runs');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterModel, page]);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  // Merge WS progress into runs
  const mergedRuns = runs.map((run) => {
    const prog = runProgress[run.id];
    if (prog) {
      return {
        ...run,
        status: prog.status ?? run.status,
        ticksCompleted: prog.percent != null ? Math.round((prog.percent / 100) * run.ticksTotal) : run.ticksCompleted,
        metricsReport: prog.composite != null
          ? { ...(run.metricsReport ?? {} as MetricsReport), composite: prog.composite, grade: prog.grade ?? '' }
          : run.metricsReport,
      };
    }
    return run;
  });

  function getDurationSeconds(run: BenchmarkRun): number | null {
    if (!run.startedAt) return null;
    const end = run.completedAt ? new Date(run.completedAt).getTime() : Date.now();
    return (end - new Date(run.startedAt).getTime()) / 1000;
  }

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={labelStyle}>Status</label>
          <select
            value={filterStatus}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(0); }}
            style={{ ...selectStyle, width: 160 }}
          >
            <option value="">All</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Model Name</label>
          <input
            type="text"
            value={filterModel}
            onChange={(e) => { setFilterModel(e.target.value); setPage(0); }}
            placeholder="Filter by model..."
            style={{ ...inputStyle, width: 200 }}
          />
        </div>
        <button
          onClick={() => void fetchRuns()}
          style={{ ...goldBtnStyle, fontSize: 12, padding: '8px 16px' }}
        >
          Refresh
        </button>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: TEXT_SECONDARY, alignSelf: 'flex-end', paddingBottom: 8 }}>
          {total} total run{total !== 1 ? 's' : ''}
        </div>
      </div>

      {loading && (
        <div style={{ ...cardStyle, textAlign: 'center', color: TEXT_SECONDARY, padding: 40 }}>
          Loading runs...
        </div>
      )}

      {error && (
        <div style={{ ...cardStyle, borderColor: 'rgba(244,67,54,0.3)', background: 'rgba(244,67,54,0.05)' }}>
          <span style={{ color: ERROR, fontSize: 13 }}>{error}</span>
        </div>
      )}

      {!loading && !error && mergedRuns.length === 0 && (
        <div style={{ ...cardStyle, textAlign: 'center', color: TEXT_SECONDARY, padding: 40 }}>
          No benchmark runs found.
        </div>
      )}

      {!loading && !error && mergedRuns.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mergedRuns.map((run) => {
            const isExpanded = expandedRun === run.id;
            const pct = run.ticksTotal > 0 ? Math.round((run.ticksCompleted / run.ticksTotal) * 100) : 0;
            const dur = getDurationSeconds(run);
            const report = run.metricsReport;

            return (
              <div key={run.id} style={{ ...cardStyle, padding: 0 }}>
                {/* Row */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '14px 20px',
                    cursor: run.status === 'completed' ? 'pointer' : 'default',
                    flexWrap: 'wrap',
                  }}
                  onClick={() => {
                    if (run.status === 'completed') setExpandedRun(isExpanded ? null : run.id);
                  }}
                >
                  {/* Scenario */}
                  <div style={{ minWidth: 140 }}>
                    <div style={{ fontSize: 13, color: TEXT_PRIMARY, fontWeight: 500 }}>
                      {scenarioMap.get(run.scenarioId) ?? run.scenarioId}
                    </div>
                    <div style={{ fontSize: 11, color: TEXT_SECONDARY, fontFamily: 'monospace' }}>
                      {run.modelName}
                    </div>
                  </div>

                  {/* Status badge */}
                  <div>
                    <span style={statusBadge(run.status)}>
                      {run.status === 'running' && (
                        <span
                          style={{
                            display: 'inline-block',
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: INFO,
                            animation: 'pulse 1.5s ease-in-out infinite',
                          }}
                        />
                      )}
                      {run.status}
                    </span>
                  </div>

                  {/* Progress */}
                  <div style={{ flex: 1, minWidth: 100 }}>
                    {(run.status === 'running' || run.status === 'completed') && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div
                          style={{
                            flex: 1,
                            height: 6,
                            borderRadius: 3,
                            background: 'rgba(255,255,255,0.05)',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              borderRadius: 3,
                              background: run.status === 'completed' ? SUCCESS : INFO,
                              width: `${pct}%`,
                              transition: 'width 0.5s ease',
                            }}
                          />
                        </div>
                        <span style={{ fontSize: 11, fontFamily: 'monospace', color: TEXT_SECONDARY, whiteSpace: 'nowrap' }}>
                          {run.ticksCompleted}/{run.ticksTotal}
                        </span>
                      </div>
                    )}
                    {run.status === 'failed' && run.errorMessage && (
                      <div style={{ fontSize: 11, color: ERROR }}>{run.errorMessage.slice(0, 80)}</div>
                    )}
                  </div>

                  {/* Composite score */}
                  <div style={{ textAlign: 'right', minWidth: 60 }}>
                    {report?.composite != null ? (
                      <>
                        <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: GOLD }}>
                          {report.composite.toFixed(1)}
                        </div>
                        <div style={{ fontSize: 10, color: TEXT_SECONDARY }}>composite</div>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: TEXT_SECONDARY }}>--</span>
                    )}
                  </div>

                  {/* Grade */}
                  <div style={{ textAlign: 'center', minWidth: 40 }}>
                    {report?.grade ? (
                      <span
                        style={{
                          fontFamily: 'Georgia, serif',
                          fontSize: 20,
                          fontWeight: 700,
                          color: gradeColor(report.grade),
                        }}
                      >
                        {report.grade}
                      </span>
                    ) : (
                      <span style={{ fontSize: 14, color: TEXT_SECONDARY }}>--</span>
                    )}
                  </div>

                  {/* Duration + time */}
                  <div style={{ textAlign: 'right', minWidth: 80 }}>
                    <div style={{ fontSize: 12, fontFamily: 'monospace', color: TEXT_SECONDARY }}>
                      {formatDuration(dur)}
                    </div>
                    <div style={{ fontSize: 10, color: TEXT_SECONDARY }}>
                      {relativeTime(run.createdAt)}
                    </div>
                  </div>

                  {/* Expand arrow */}
                  {run.status === 'completed' && (
                    <div style={{ color: TEXT_SECONDARY, fontSize: 12 }}>
                      {isExpanded ? 'v' : '>'}
                    </div>
                  )}
                </div>

                {/* Expanded metrics */}
                {isExpanded && report && (
                  <div
                    style={{
                      borderTop: `1px solid ${BORDER}`,
                      padding: 20,
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                      gap: 20,
                    }}
                  >
                    {/* Outcome Metrics */}
                    {report.outcomeMetrics && Object.keys(report.outcomeMetrics).length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, color: TEXT_GOLD, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                          Outcome Metrics
                        </div>
                        {Object.entries(report.outcomeMetrics).map(([key, value]) => (
                          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontSize: 12, color: TEXT_SECONDARY }}>{key}</span>
                            <span style={{ fontSize: 12, fontFamily: 'monospace', color: TEXT_PRIMARY }}>
                              {typeof value === 'number' ? value.toFixed(3) : String(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Agent Metrics */}
                    {report.agentMetrics && Object.keys(report.agentMetrics).length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, color: TEXT_GOLD, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                          Agent Metrics
                        </div>
                        {Object.entries(report.agentMetrics).map(([key, value]) => (
                          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontSize: 12, color: TEXT_SECONDARY }}>{key}</span>
                            <span style={{ fontSize: 12, fontFamily: 'monospace', color: TEXT_PRIMARY }}>
                              {typeof value === 'number' ? value.toFixed(3) : String(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Coordination Metrics */}
                    {report.coordinationMetrics && Object.keys(report.coordinationMetrics).length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, color: TEXT_GOLD, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                          Coordination Metrics
                        </div>
                        {Object.entries(report.coordinationMetrics).map(([key, value]) => (
                          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontSize: 12, color: TEXT_SECONDARY }}>{key}</span>
                            <span style={{ fontSize: 12, fontFamily: 'monospace', color: TEXT_PRIMARY }}>
                              {typeof value === 'number' ? value.toFixed(3) : String(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Dimensions fallback */}
                    {report.dimensions && !report.outcomeMetrics && !report.agentMetrics && !report.coordinationMetrics && (
                      <div>
                        <div style={{ fontSize: 11, color: TEXT_GOLD, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                          Dimensions
                        </div>
                        {Object.entries(report.dimensions).map(([key, value]) => (
                          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ fontSize: 12, color: TEXT_SECONDARY }}>{key}</span>
                            <span style={{ fontSize: 12, fontFamily: 'monospace', color: TEXT_PRIMARY }}>
                              {typeof value === 'number' ? value.toFixed(3) : String(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Run metadata */}
                    <div>
                      <div style={{ fontSize: 11, color: TEXT_GOLD, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                        Run Info
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 12, color: TEXT_SECONDARY }}>Run ID</span>
                          <span style={{ fontSize: 10, fontFamily: 'monospace', color: TEXT_PRIMARY }}>{run.id.slice(0, 12)}...</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 12, color: TEXT_SECONDARY }}>Backend</span>
                          <span style={{ fontSize: 12, fontFamily: 'monospace', color: TEXT_PRIMARY }}>{run.modelBackend}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 12, color: TEXT_SECONDARY }}>Duration</span>
                          <span style={{ fontSize: 12, fontFamily: 'monospace', color: TEXT_PRIMARY }}>{formatDuration(dur)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 12, color: TEXT_SECONDARY }}>Triggered</span>
                          <span style={{ fontSize: 12, color: TEXT_PRIMARY }}>{relativeTime(run.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 12 }}>
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                style={{
                  ...goldBtnStyle,
                  fontSize: 12,
                  padding: '6px 14px',
                  opacity: page === 0 ? 0.4 : 1,
                  cursor: page === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                Previous
              </button>
              <span style={{ fontSize: 12, color: TEXT_SECONDARY, alignSelf: 'center' }}>
                Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * PAGE_SIZE >= total}
                style={{
                  ...goldBtnStyle,
                  fontSize: 12,
                  padding: '6px 14px',
                  opacity: (page + 1) * PAGE_SIZE >= total ? 0.4 : 1,
                  cursor: (page + 1) * PAGE_SIZE >= total ? 'not-allowed' : 'pointer',
                }}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── LeaderboardTab ──────────────────────────────────────────────────────── */

function LeaderboardTab({ scenarios }: { scenarios: Scenario[] }) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterScenario, setFilterScenario] = useState('');

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await benchmarkApi.leaderboard(filterScenario || undefined);
      const data = res.data as { leaderboard: LeaderboardRow[] };
      setLeaderboard(data.leaderboard);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, [filterScenario]);

  useEffect(() => {
    void fetchLeaderboard();
  }, [fetchLeaderboard]);

  return (
    <div>
      {/* Filter */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'flex-end' }}>
        <div>
          <label style={labelStyle}>Filter by Scenario</label>
          <select
            value={filterScenario}
            onChange={(e) => setFilterScenario(e.target.value)}
            style={{ ...selectStyle, width: 240 }}
          >
            <option value="">All Scenarios</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && (
        <div style={{ ...cardStyle, textAlign: 'center', color: TEXT_SECONDARY, padding: 40 }}>
          Loading leaderboard...
        </div>
      )}

      {error && (
        <div style={{ ...cardStyle, borderColor: 'rgba(244,67,54,0.3)', background: 'rgba(244,67,54,0.05)' }}>
          <span style={{ color: ERROR, fontSize: 13 }}>{error}</span>
        </div>
      )}

      {!loading && !error && leaderboard.length === 0 && (
        <div style={{ ...cardStyle, textAlign: 'center', color: TEXT_SECONDARY, padding: 40 }}>
          No completed benchmark runs yet. Launch a run to see the leaderboard.
        </div>
      )}

      {!loading && !error && leaderboard.length > 0 && (
        <div style={{ borderRadius: 8, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                <th style={{ textAlign: 'left', padding: '10px 16px', color: TEXT_SECONDARY, fontWeight: 400, fontSize: 12 }}>Rank</th>
                <th style={{ textAlign: 'left', padding: '10px 16px', color: TEXT_SECONDARY, fontWeight: 400, fontSize: 12 }}>Model Name</th>
                <th style={{ textAlign: 'right', padding: '10px 16px', color: TEXT_SECONDARY, fontWeight: 400, fontSize: 12 }}>Avg Composite</th>
                <th style={{ textAlign: 'center', padding: '10px 16px', color: TEXT_SECONDARY, fontWeight: 400, fontSize: 12 }}>Best Grade</th>
                <th style={{ textAlign: 'right', padding: '10px 16px', color: TEXT_SECONDARY, fontWeight: 400, fontSize: 12 }}>Total Runs</th>
                <th style={{ textAlign: 'right', padding: '10px 16px', color: TEXT_SECONDARY, fontWeight: 400, fontSize: 12 }}>Avg Duration</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row) => (
                <tr
                  key={row.modelName}
                  style={{ borderTop: `1px solid ${BORDER}40` }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = BG_CARD_HOVER; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: row.rank <= 3 ? 'rgba(201,168,76,0.15)' : 'rgba(136,136,136,0.1)',
                        color: row.rank <= 3 ? GOLD : TEXT_SECONDARY,
                        fontSize: 13,
                        fontWeight: 700,
                        fontFamily: 'monospace',
                      }}
                    >
                      {row.rank}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', color: TEXT_PRIMARY, fontWeight: 500 }}>
                    {row.modelName}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', color: GOLD, fontWeight: 600 }}>
                    {row.avgComposite != null ? row.avgComposite.toFixed(1) : '--'}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                    {row.bestGrade ? (
                      <span
                        style={{
                          fontFamily: 'Georgia, serif',
                          fontSize: 16,
                          fontWeight: 700,
                          color: gradeColor(row.bestGrade),
                        }}
                      >
                        {row.bestGrade}
                      </span>
                    ) : (
                      <span style={{ color: TEXT_SECONDARY }}>--</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', color: TEXT_SECONDARY }}>
                    {row.totalRuns}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', color: TEXT_SECONDARY }}>
                    {formatDuration(row.avgDurationSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── ApiDocsTab ──────────────────────────────────────────────────────────── */

interface EndpointDoc {
  method: 'GET' | 'POST';
  path: string;
  description: string;
  curl: string;
}

const ENDPOINTS: EndpointDoc[] = [
  {
    method: 'GET',
    path: '/api/benchmark/scenarios',
    description: 'List all benchmark scenarios, ordered by tier and name.',
    curl: `curl -s https://YOUR_HOST/api/benchmark/scenarios | jq .`,
  },
  {
    method: 'GET',
    path: '/api/benchmark/scenarios/:id',
    description: 'Retrieve a single scenario by ID, including world config, agent config, seed data, and metric definitions.',
    curl: `curl -s https://YOUR_HOST/api/benchmark/scenarios/baseline-democracy | jq .`,
  },
  {
    method: 'POST',
    path: '/api/benchmark/run',
    description:
      'Trigger one or more benchmark runs for a given scenario. Requires owner auth. Runs are queued and processed asynchronously. Returns an array of run IDs.',
    curl: `curl -X POST https://YOUR_HOST/api/benchmark/run \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "scenarioId": "baseline-democracy",
    "modelName": "gpt-oss-20b",
    "modelBackend": "internal",
    "runs": 3
  }'`,
  },
  {
    method: 'GET',
    path: '/api/benchmark/results/:runId',
    description:
      'Fetch the full results for a single benchmark run, including status, metrics report, raw data, and timing information.',
    curl: `curl -s https://YOUR_HOST/api/benchmark/results/RUN_ID | jq .`,
  },
  {
    method: 'GET',
    path: '/api/benchmark/runs',
    description:
      'List benchmark runs with optional filters: scenarioId, modelName, status. Supports pagination via limit and offset query params.',
    curl: `curl -s "https://YOUR_HOST/api/benchmark/runs?status=completed&limit=10" | jq .`,
  },
  {
    method: 'GET',
    path: '/api/benchmark/runs/:runId/export',
    description:
      'Download the raw data for a completed run as a JSON file attachment.',
    curl: `curl -OJ https://YOUR_HOST/api/benchmark/runs/RUN_ID/export`,
  },
  {
    method: 'GET',
    path: '/api/benchmark/leaderboard',
    description:
      'Get model rankings sorted by average composite score. Optionally filter by scenarioId.',
    curl: `curl -s "https://YOUR_HOST/api/benchmark/leaderboard?scenarioId=baseline-democracy" | jq .`,
  },
];

function ApiDocsTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...cardStyle, background: 'rgba(201,168,76,0.03)', borderColor: 'rgba(201,168,76,0.2)' }}>
        <p style={{ fontSize: 13, color: TEXT_SECONDARY, margin: 0, lineHeight: 1.6 }}>
          The Benchmark API allows programmatic access to scenarios, run management, and leaderboard data.
          All endpoints are prefixed with <code style={{ color: GOLD, fontFamily: 'monospace', fontSize: 12 }}>/api</code>.
          Protected endpoints require an <code style={{ color: GOLD, fontFamily: 'monospace', fontSize: 12 }}>Authorization: Bearer</code> header
          with a valid session token.
        </p>
      </div>

      {ENDPOINTS.map((ep) => (
        <div key={ep.path + ep.method} style={cardStyle}>
          {/* Method + Path */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span
              style={{
                display: 'inline-block',
                padding: '2px 10px',
                borderRadius: 3,
                fontSize: 11,
                fontWeight: 700,
                fontFamily: 'monospace',
                color: ep.method === 'GET' ? SUCCESS : '#fff',
                background: ep.method === 'GET' ? 'rgba(76,175,80,0.15)' : 'rgba(33,150,243,0.15)',
                letterSpacing: '0.03em',
              }}
            >
              {ep.method}
            </span>
            <code style={{ fontSize: 14, color: TEXT_PRIMARY, fontFamily: 'monospace' }}>{ep.path}</code>
          </div>

          {/* Description */}
          <p style={{ fontSize: 13, color: TEXT_SECONDARY, margin: '0 0 12px 0', lineHeight: 1.5 }}>
            {ep.description}
          </p>

          {/* Curl example */}
          <div
            style={{
              background: BG_DARK,
              borderRadius: 6,
              padding: 14,
              overflow: 'auto',
            }}
          >
            <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: 12, color: TEXT_PRIMARY, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {ep.curl}
            </pre>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Pulse animation (injected once) ─────────────────────────────────────── */

let pulseStyleInjected = false;
function injectPulseStyle() {
  if (pulseStyleInjected) return;
  pulseStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
  `;
  document.head.appendChild(style);
}

/* ── Main Component ──────────────────────────────────────────────────────── */

export function BenchmarkPage() {
  const [activeTab, setActiveTab] = useState<Tab>('scenarios');
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [launchScenario, setLaunchScenario] = useState<Scenario | null>(null);
  const [runProgress, setRunProgress] = useState<
    Record<string, { runId: string; percent: number; status?: string; grade?: string; composite?: number }>
  >({});

  const { subscribe } = useWebSocket();

  // Inject pulse animation CSS
  useEffect(() => {
    injectPulseStyle();
  }, []);

  // Fetch scenarios on mount
  const fetchScenarios = useCallback(async () => {
    try {
      const res = await benchmarkApi.scenarios();
      const data = res.data as { scenarios: Scenario[] };
      setScenarios(data.scenarios);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scenarios');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchScenarios();
  }, [fetchScenarios]);

  // WebSocket progress updates
  useEffect(() => {
    const unsub = subscribe('benchmark:progress', (data) => {
      const d = data as { runId: string; percent: number; status?: string; grade?: string; composite?: number };
      setRunProgress((prev) => ({ ...prev, [d.runId]: d }));
    });
    return unsub;
  }, [subscribe]);

  function handleLaunchSuccess(_runIds: string[]) {
    // After launching, switch to runs tab to see the new runs
    // (modal will be closed by user)
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>
        <p style={{ color: TEXT_SECONDARY }}>Loading benchmark dashboard...</p>
      </div>
    );
  }

  if (error && scenarios.length === 0) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>
        <div
          style={{
            ...cardStyle,
            borderColor: 'rgba(244,67,54,0.3)',
            background: 'rgba(244,67,54,0.05)',
          }}
        >
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 18, color: ERROR, margin: '0 0 8px 0' }}>Error</h2>
          <p style={{ fontSize: 13, color: '#ef9a9a', margin: '0 0 12px 0' }}>{error}</p>
          <button
            onClick={() => { setLoading(true); void fetchScenarios(); }}
            style={{
              padding: '8px 16px',
              borderRadius: 4,
              border: `1px solid ${BORDER}`,
              background: 'transparent',
              color: TEXT_SECONDARY,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 32px' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 30, fontWeight: 600, color: TEXT_PRIMARY, margin: 0 }}>
          AgoraBench
        </h1>
        <p style={{ fontSize: 14, color: TEXT_SECONDARY, marginTop: 4 }}>
          Benchmark AI models against multi-agent democratic governance scenarios
        </p>
      </div>

      {/* Tab Bar */}
      <div style={tabBarStyle}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={tabStyle(activeTab === tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'scenarios' && (
        <ScenariosTab
          scenarios={scenarios}
          onLaunch={(s) => setLaunchScenario(s)}
        />
      )}
      {activeTab === 'runs' && (
        <RunsTab scenarios={scenarios} runProgress={runProgress} />
      )}
      {activeTab === 'leaderboard' && (
        <LeaderboardTab scenarios={scenarios} />
      )}
      {activeTab === 'docs' && <ApiDocsTab />}

      {/* Launch Modal */}
      {launchScenario && (
        <RunLaunchModal
          scenario={launchScenario}
          onClose={() => setLaunchScenario(null)}
          onSuccess={handleLaunchSuccess}
        />
      )}
    </div>
  );
}
