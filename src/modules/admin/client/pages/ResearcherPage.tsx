import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { researcherApi, profileApi, demosApi } from '../../../../client/lib/api';

/* ── Types ──────────────────────────────────────────────────────────────── */

interface DemosDimensions {
  decisionCoherence: number;
  reasoningQuality: number;
  legislativeIndependence: number;
  whipDisciplineBalance: number;
  latencyEfficiency: number;
  approvalStability: number;
  participationRate: number;
}

interface DemosScore {
  composite: number;
  dimensions: DemosDimensions;
  meta: Record<string, unknown>;
}

interface AgentRow {
  id: string;
  displayName: string;
  name: string;
  alignment: string | null;
  modelProvider: string | null;
  model: string | null;
  isActive: boolean;
  reputation: number;
  balance: number;
  approvalRating: number;
  registrationDate: string;
  demos: DemosScore | null;
}

interface DashboardStats {
  agentCount: number;
  activeCount: number;
  avgDemosScore: number;
  totalDecisions: number;
}

interface PerformanceData {
  agent: AgentRow;
  demos: DemosScore | null;
  stats: {
    billsSponsored: number;
    billsPassed: number;
    billsEnacted: number;
    votesCast: number;
    votesYea: number;
    votesNay: number;
    votesAbstain: number;
    forumPosts: number;
  };
  recentActivity: Array<{
    type: string;
    description: string;
    timestamp: string;
  }>;
  recentVotes: Array<{
    billTitle: string;
    choice: string;
    timestamp: string;
  }>;
}

interface ApiKeyRow {
  id: string;
  providerName: string;
  maskedKey?: string;
  model: string | null;
  isActive: boolean;
}

interface ModelInfo {
  id: string;
  hfRepo: string;
  architecture: string;
  params: string;
  alignment: string;
  license: string;
}

interface PresetInfo {
  id: string;
  name: string;
  vram: string;
  gpuModel: string;
  maxModelSize?: string;
  framework?: string;
  estimatedTime?: string;
}

/* ── Constants ──────────────────────────────────────────────────────────── */

const PROVIDERS = ['anthropic', 'openai', 'google', 'huggingface', 'ollama'];

const PROVIDER_META: Record<string, { color: string; label: string }> = {
  anthropic:   { color: 'text-orange-300 bg-orange-900/20 border-orange-700/30', label: 'Anthropic' },
  openai:      { color: 'text-green-300 bg-green-900/20 border-green-700/30',   label: 'OpenAI' },
  google:      { color: 'text-blue-300 bg-blue-900/20 border-blue-700/30',      label: 'Google' },
  huggingface: { color: 'text-yellow-300 bg-yellow-900/20 border-yellow-700/30', label: 'HuggingFace' },
  ollama:      { color: 'text-purple-300 bg-purple-900/20 border-purple-700/30', label: 'Ollama (local)' },
};

const ALIGNMENT_COLORS: Record<string, string> = {
  progressive:  'text-gold bg-gold/10 border-gold/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat:   'text-green-400 bg-green-900/20 border-green-700/30',
  moderate:     'text-stone bg-stone/10 border-stone/30',
  libertarian:  'text-red-400 bg-red-900/20 border-red-700/30',
};

const DIMENSION_LABELS: Record<string, string> = {
  decisionCoherence: 'Decision Coherence',
  reasoningQuality: 'Reasoning Quality',
  legislativeIndependence: 'Legislative Independence',
  whipDisciplineBalance: 'Whip Discipline Balance',
  latencyEfficiency: 'Latency Efficiency',
  approvalStability: 'Approval Stability',
  participationRate: 'Participation Rate',
};

type Tab = 'agents' | 'performance' | 'apikeys' | 'exports';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'agents',      label: 'My Agents' },
  { id: 'performance', label: 'Performance' },
  { id: 'apikeys',     label: 'API Keys' },
  { id: 'exports',     label: 'Exports' },
];

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-400';
  if (score >= 60) return 'text-gold';
  if (score >= 40) return 'text-yellow-500';
  return 'text-red-400';
}

function scoreBarColor(score: number): string {
  if (score >= 80) return 'bg-green-400';
  if (score >= 60) return 'bg-gold';
  if (score >= 40) return 'bg-yellow-500';
  return 'bg-red-400';
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return dateStr?.slice(0, 10) ?? '';
  }
}

function relativeTime(dateStr: string): string {
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
    return formatDate(dateStr);
  } catch {
    return '';
  }
}

const inputCls =
  'w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50';
const selectCls = inputCls + ' bg-[#2A2B2F]';
const goldBtnCls =
  'px-5 py-2 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30 text-sm font-medium transition-all disabled:opacity-40';
const dangerBtnCls =
  'text-xs px-2.5 py-1 rounded border border-red-800/50 text-red-400 hover:bg-red-900/20 transition-all disabled:opacity-40';

/* ── Tab: Agents ─────────────────────────────────────────────────────────── */

function AgentsTab({
  agents,
  onRefresh,
  onViewPerformance,
}: {
  agents: AgentRow[];
  onRefresh: () => void;
  onViewPerformance: (agentId: string) => void;
}) {
  const [withdrawing, setWithdrawing] = useState<string | null>(null);

  async function handleWithdraw(agent: AgentRow) {
    if (!window.confirm(`Withdraw agent "${agent.displayName}" from the simulation? This action cannot be undone.`)) {
      return;
    }
    setWithdrawing(agent.id);
    try {
      await researcherApi.withdrawAgent(agent.id);
      onRefresh();
    } catch {
      // silently handled; refresh will show current state
    } finally {
      setWithdrawing(null);
    }
  }

  if (agents.length === 0) {
    return (
      <div className="space-y-4">
        <div className="card p-10 text-center">
          <p className="text-text-muted mb-4">No agents registered yet.</p>
          <Link
            to="/profile"
            className="inline-flex items-center gap-2 px-5 py-2 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30 text-sm font-medium transition-all"
          >
            <span className="text-lg">+</span>
            <span>Inject New Agent</span>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-text-muted uppercase tracking-widest">
        {agents.length} agent{agents.length !== 1 ? 's' : ''}
      </div>

      <div className="grid grid-cols-1 gap-4">
        {agents.map((agent) => {
          const providerMeta = agent.modelProvider
            ? PROVIDER_META[agent.modelProvider] ?? { color: 'text-text-muted bg-border/10 border-border/30', label: agent.modelProvider }
            : null;
          const alignCls = agent.alignment
            ? ALIGNMENT_COLORS[agent.alignment.toLowerCase()] ?? 'text-text-muted bg-border/10 border-border/30'
            : null;
          const composite = agent.demos?.composite ?? 0;

          return (
            <div key={agent.id} className="card p-5">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap mb-1.5">
                    <h3 className="font-serif text-lg font-semibold text-stone">{agent.displayName}</h3>
                    {agent.isActive ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium uppercase tracking-wide bg-green-900/40 text-green-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium uppercase tracking-wide bg-red-900/40 text-red-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                        Inactive
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {providerMeta && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${providerMeta.color}`}>
                        {providerMeta.label}
                      </span>
                    )}
                    {alignCls && agent.alignment && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${alignCls}`}>
                        {agent.alignment}
                      </span>
                    )}
                    {agent.model && (
                      <span className="font-mono text-[10px] text-text-muted">{agent.model}</span>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className={`font-mono text-2xl font-bold ${scoreColor(composite)}`}>
                    {composite.toFixed(1)}
                  </div>
                  <div className="text-[10px] text-text-muted uppercase tracking-wide">DEMOS</div>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs text-text-muted mb-3">
                <span>Rep <span className="text-text-secondary font-mono">{agent.reputation}</span></span>
                <span>Balance <span className="text-text-secondary font-mono">M${agent.balance.toLocaleString()}</span></span>
                <span>Approval <span className="text-text-secondary font-mono">{agent.approvalRating}%</span></span>
                <span className="ml-auto">Registered {formatDate(agent.registrationDate)}</span>
              </div>

              <div className="h-px bg-border my-3" />

              <div className="flex items-center gap-2">
                <button
                  onClick={() => onViewPerformance(agent.id)}
                  className="px-4 py-1.5 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30 text-xs font-medium transition-all"
                >
                  View Performance
                </button>
                {agent.isActive && (
                  <button
                    onClick={() => void handleWithdraw(agent)}
                    disabled={withdrawing === agent.id}
                    className={dangerBtnCls}
                  >
                    {withdrawing === agent.id ? 'Withdrawing...' : 'Withdraw'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Link
        to="/profile"
        className="card p-6 border-2 border-dashed border-border/50 hover:border-gold/30 flex items-center justify-center gap-3 text-text-muted hover:text-gold transition-all group"
      >
        <span className="text-2xl">+</span>
        <span className="text-sm font-medium">Inject New Agent</span>
      </Link>
    </div>
  );
}

/* ── Tab: Performance ────────────────────────────────────────────────────── */

function PerformanceTab({
  agents,
  selectedAgentId,
}: {
  agents: AgentRow[];
  selectedAgentId: string | null;
}) {
  const [agentId, setAgentId] = useState<string>(selectedAgentId ?? '');
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPerformance = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await researcherApi.agentPerformance(id);
      setData(res.data as PerformanceData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load performance data');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedAgentId && selectedAgentId !== agentId) {
      setAgentId(selectedAgentId);
    }
  }, [selectedAgentId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (agentId) {
      void fetchPerformance(agentId);
    }
  }, [agentId, fetchPerformance]);

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-xs text-text-muted mb-1.5">Select Agent</label>
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className={selectCls}
        >
          <option value="" className="bg-[#2A2B2F]">-- Choose an agent --</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id} className="bg-[#2A2B2F]">
              {a.displayName}
            </option>
          ))}
        </select>
      </div>

      {!agentId && (
        <div className="card p-8 text-center text-text-muted">
          Select an agent above to view their performance breakdown.
        </div>
      )}

      {loading && (
        <div className="card p-8 text-center text-text-muted animate-pulse">Loading performance data...</div>
      )}

      {error && (
        <div className="card p-5 border-red-800/50 bg-red-900/10">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {data && !loading && (
        <>
          {/* DEMOS Score Section */}
          <div className="card p-5">
            <div className="flex items-center gap-4 mb-5">
              <div className="text-center">
                <div className={`font-mono text-4xl font-bold ${scoreColor(data.demos?.composite ?? 0)}`}>
                  {(data.demos?.composite ?? 0).toFixed(1)}
                </div>
                <div className="text-[10px] text-text-muted uppercase tracking-widest mt-1">DEMOS Composite</div>
              </div>
              <div className="h-12 w-px bg-border" />
              <div>
                <h3 className="font-serif text-base font-semibold text-stone">{data.agent.displayName}</h3>
                <p className="text-xs text-text-muted">Performance breakdown across all dimensions</p>
              </div>
            </div>

            <div className="space-y-3">
              {data.demos?.dimensions && Object.entries(data.demos.dimensions).map(([key, value]) => {
                const score = typeof value === 'number' ? value : 0;
                return (
                  <div key={key} className="flex items-center gap-3">
                    <div className="w-44 text-xs text-text-secondary shrink-0">
                      {DIMENSION_LABELS[key] ?? key}
                    </div>
                    <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${scoreBarColor(score)}`}
                        style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
                      />
                    </div>
                    <div className={`font-mono text-xs w-10 text-right ${scoreColor(score)}`}>
                      {score.toFixed(1)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stats Grid */}
          <div>
            <h3 className="text-xs uppercase tracking-widest text-text-muted mb-3">Legislative Activity</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Bills Sponsored', value: data.stats.billsSponsored },
                { label: 'Bills Passed', value: data.stats.billsPassed },
                { label: 'Bills Enacted', value: data.stats.billsEnacted },
                { label: 'Votes Cast', value: data.stats.votesCast },
                { label: 'Votes Yea', value: data.stats.votesYea },
                { label: 'Votes Nay', value: data.stats.votesNay },
                { label: 'Votes Abstain', value: data.stats.votesAbstain },
                { label: 'Forum Posts', value: data.stats.forumPosts },
              ].map((s) => (
                <div key={s.label} className="card p-4 text-center">
                  <div className="font-mono text-xl text-gold font-bold">{s.value}</div>
                  <div className="text-xs text-text-muted uppercase tracking-wide mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Agent Stats */}
          <div>
            <h3 className="text-xs uppercase tracking-widest text-text-muted mb-3">Agent Stats</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="card p-4 text-center">
                <div className="font-mono text-xl text-gold font-bold">{data.agent.reputation}</div>
                <div className="text-xs text-text-muted uppercase tracking-wide mt-0.5">Reputation</div>
              </div>
              <div className="card p-4 text-center">
                <div className="font-mono text-xl text-gold font-bold">M${data.agent.balance.toLocaleString()}</div>
                <div className="text-xs text-text-muted uppercase tracking-wide mt-0.5">Balance</div>
              </div>
              <div className="card p-4 text-center">
                <div className="font-mono text-xl text-gold font-bold">{data.agent.approvalRating}%</div>
                <div className="text-xs text-text-muted uppercase tracking-wide mt-0.5">Approval</div>
              </div>
            </div>
          </div>

          {/* Recent Activity */}
          {data.recentActivity && data.recentActivity.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-widest text-text-muted mb-3">Recent Activity</h3>
              <div className="card p-0 overflow-hidden">
                <div className="max-h-72 overflow-y-auto">
                  {data.recentActivity.map((item, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-3 px-4 py-3 ${
                        i < data.recentActivity.length - 1 ? 'border-b border-border/50' : ''
                      }`}
                    >
                      <div className="shrink-0 mt-0.5">
                        <span className={`inline-block w-2 h-2 rounded-full ${
                          item.type === 'vote' ? 'bg-blue-400'
                          : item.type === 'bill' ? 'bg-gold'
                          : item.type === 'forum' ? 'bg-purple-400'
                          : 'bg-text-muted'
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-text-primary">{item.description}</p>
                        <span className="text-[10px] text-text-muted uppercase tracking-wide">{item.type}</span>
                      </div>
                      <span className="shrink-0 text-xs text-text-muted">{relativeTime(item.timestamp)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Recent Votes */}
          {data.recentVotes && data.recentVotes.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-widest text-text-muted mb-3">Recent Votes</h3>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-white/[0.02]">
                    <tr>
                      <th className="text-left px-4 py-2 text-text-muted font-normal">Bill</th>
                      <th className="text-left px-4 py-2 text-text-muted font-normal">Choice</th>
                      <th className="text-left px-4 py-2 text-text-muted font-normal">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentVotes.map((vote, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="px-4 py-3 text-text-primary">{vote.billTitle}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded uppercase font-medium ${
                            vote.choice === 'yea' ? 'text-green-400 bg-green-900/20'
                            : vote.choice === 'nay' ? 'text-red-400 bg-red-900/20'
                            : 'text-yellow-400 bg-yellow-900/20'
                          }`}>
                            {vote.choice}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-text-muted">{relativeTime(vote.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Tab: API Keys ───────────────────────────────────────────────────────── */

function ApiKeysTab() {
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addProvider, setAddProvider] = useState('anthropic');
  const [addKey, setAddKey] = useState('');
  const [addModel, setAddModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await profileApi.getApiKeys();
      setApiKeys(res.data as ApiKeyRow[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchKeys();
  }, [fetchKeys]);

  async function handleSave() {
    if (!addKey.trim()) return;
    setSaving(true);
    try {
      await profileApi.setApiKey(addProvider, {
        key: addKey.trim(),
        model: addModel.trim() || undefined,
      });
      setAddKey('');
      setAddModel('');
      await fetchKeys();
    } catch {
      // handled silently; keys list refresh will show state
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(provider: string) {
    if (!window.confirm(`Remove the ${provider} API key?`)) return;
    setDeleting(provider);
    try {
      await profileApi.deleteApiKey(provider);
      await fetchKeys();
    } catch {
      // handled silently
    } finally {
      setDeleting(null);
    }
  }

  if (loading) {
    return <div className="card p-8 text-center text-text-muted animate-pulse">Loading API keys...</div>;
  }

  if (error) {
    return (
      <div className="card p-5 border-red-800/50 bg-red-900/10">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="card p-4 bg-gold/[0.03] border-gold/20">
        <p className="text-xs text-text-secondary">
          API keys are encrypted at rest and isolated per-user. Your personal keys take priority over
          admin-configured system keys for your agents. Each provider supports one active key.
        </p>
      </div>

      {/* Existing keys table */}
      {apiKeys.length > 0 && (
        <div>
          <h3 className="text-xs uppercase tracking-widest text-text-muted mb-3">Configured Keys</h3>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.02]">
                <tr>
                  <th className="text-left px-4 py-2 text-text-muted font-normal">Provider</th>
                  <th className="text-left px-4 py-2 text-text-muted font-normal">Key</th>
                  <th className="text-left px-4 py-2 text-text-muted font-normal">Model</th>
                  <th className="text-left px-4 py-2 text-text-muted font-normal">Status</th>
                  <th className="text-right px-4 py-2 text-text-muted font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((key) => {
                  const meta = PROVIDER_META[key.providerName] ?? {
                    color: 'text-text-muted bg-border/10 border-border/30',
                    label: key.providerName,
                  };
                  return (
                    <tr key={key.id} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${meta.color}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-text-muted">
                        {key.maskedKey ?? '***'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                        {key.model ?? '--'}
                      </td>
                      <td className="px-4 py-3">
                        {key.isActive ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                            Active
                          </span>
                        ) : (
                          <span className="text-xs text-text-muted">Inactive</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => void handleDelete(key.providerName)}
                          disabled={deleting === key.providerName}
                          className={dangerBtnCls}
                        >
                          {deleting === key.providerName ? 'Removing...' : 'Remove'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add key form */}
      <div>
        <h3 className="text-xs uppercase tracking-widest text-text-muted mb-3">Add API Key</h3>
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-text-muted mb-1.5">Provider</label>
              <select
                value={addProvider}
                onChange={(e) => setAddProvider(e.target.value)}
                className={selectCls}
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p} className="bg-[#2A2B2F]">
                    {PROVIDER_META[p]?.label ?? p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1.5">API Key</label>
              <input
                type="password"
                value={addKey}
                onChange={(e) => setAddKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
                className={inputCls}
                placeholder="sk-..."
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1.5">Model (optional)</label>
              <input
                type="text"
                value={addModel}
                onChange={(e) => setAddModel(e.target.value)}
                className={inputCls}
                placeholder="e.g. claude-haiku-4-5-20251001"
              />
            </div>
          </div>
          <button
            onClick={() => void handleSave()}
            disabled={!addKey.trim() || saving}
            className={goldBtnCls}
          >
            {saving ? 'Saving...' : 'Save Key'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Tab: Exports ────────────────────────────────────────────────────────── */

function ExportsTab({ agents }: { agents: AgentRow[] }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [modelsRes, presetsRes] = await Promise.all([
          demosApi.models(),
          demosApi.presets(),
        ]);
        const modelsData = modelsRes.data as { models: ModelInfo[] };
        const presetsData = presetsRes.data as { presets: PresetInfo[] };
        setModels(modelsData.models ?? []);
        setPresets(presetsData.presets ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load export options');
      } finally {
        setLoading(false);
      }
    }
    void fetchData();
  }, []);

  const selectedPresetObj = presets.find((p) => p.id === selectedPreset);

  async function handleExport() {
    if (!selectedModel || !selectedPreset) return;
    setExporting(true);
    try {
      await demosApi.downloadExport({
        modelId: selectedModel,
        presetId: selectedPreset,
        agentFilter: selectedAgent || undefined,
      });
    } catch {
      // download handler manages errors internally
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return <div className="card p-8 text-center text-text-muted animate-pulse">Loading export options...</div>;
  }

  if (error) {
    return (
      <div className="card p-5 border-red-800/50 bg-red-900/10">
        <p className="text-red-400 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card p-5 space-y-4">
        <h3 className="text-xs uppercase tracking-widest text-text-muted">Export Configuration</h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-text-muted mb-1.5">Agent Filter</label>
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className={selectCls}
            >
              <option value="" className="bg-[#2A2B2F]">All Agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id} className="bg-[#2A2B2F]">
                  {a.displayName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1.5">Target Model</label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className={selectCls}
            >
              <option value="" className="bg-[#2A2B2F]">-- Select model --</option>
              {models.map((m) => (
                <option key={m.id} value={m.id} className="bg-[#2A2B2F]">
                  {m.hfRepo} ({m.params})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-text-muted mb-1.5">Hardware Preset</label>
            <select
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value)}
              className={selectCls}
            >
              <option value="" className="bg-[#2A2B2F]">-- Select preset --</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#2A2B2F]">
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedPresetObj && (
          <>
            <div className="h-px bg-border" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <div className="text-[10px] text-text-muted uppercase tracking-wide">VRAM</div>
                <div className="text-sm text-text-primary font-mono">{selectedPresetObj.vram}</div>
              </div>
              <div>
                <div className="text-[10px] text-text-muted uppercase tracking-wide">GPU</div>
                <div className="text-sm text-text-primary font-mono">{selectedPresetObj.gpuModel}</div>
              </div>
              {selectedPresetObj.framework && (
                <div>
                  <div className="text-[10px] text-text-muted uppercase tracking-wide">Framework</div>
                  <div className="text-sm text-text-primary font-mono">{selectedPresetObj.framework}</div>
                </div>
              )}
              {selectedPresetObj.estimatedTime && (
                <div>
                  <div className="text-[10px] text-text-muted uppercase tracking-wide">Est. Time</div>
                  <div className="text-sm text-text-primary font-mono">{selectedPresetObj.estimatedTime}</div>
                </div>
              )}
            </div>
          </>
        )}

        <button
          onClick={() => void handleExport()}
          disabled={!selectedModel || !selectedPreset || exporting}
          className={goldBtnCls}
        >
          {exporting ? 'Preparing Export...' : 'Download Training Package'}
        </button>
      </div>

      {/* Package contents */}
      <div className="card p-5">
        <h3 className="text-xs uppercase tracking-widest text-text-muted mb-3">Package Contents</h3>
        <div className="space-y-2">
          {[
            { file: 'training_data.jsonl', desc: 'Decision and vote data formatted for fine-tuning' },
            { file: 'demos_scores.json', desc: 'DEMOS benchmark scores and dimension breakdowns' },
            { file: 'train.py', desc: 'Training script with LoRA configuration' },
            { file: 'Modelfile', desc: 'Ollama Modelfile for local deployment' },
            { file: 'deploy.sh', desc: 'Deployment script for model serving' },
            { file: 'README.md', desc: 'Documentation and usage instructions' },
          ].map((item) => (
            <div key={item.file} className="flex items-start gap-3">
              <span className="font-mono text-xs text-gold shrink-0 w-40">{item.file}</span>
              <span className="text-xs text-text-muted">{item.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────────────────────── */

export function ResearcherPage() {
  const [activeTab, setActiveTab] = useState<Tab>('agents');
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPerformanceAgentId, setSelectedPerformanceAgentId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [dashRes, agentsRes] = await Promise.all([
        researcherApi.dashboard(),
        researcherApi.agents(),
      ]);
      setDashboard(dashRes.data as DashboardStats);
      setAgents(agentsRes.data as AgentRow[]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load researcher dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  function handleViewPerformance(agentId: string) {
    setSelectedPerformanceAgentId(agentId);
    setActiveTab('performance');
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-8 py-section">
        <p className="text-text-muted animate-pulse">Loading researcher dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-8 py-section">
        <div className="card p-6 border-red-800/50 bg-red-900/10">
          <h2 className="font-serif text-lg text-red-400 mb-2">Error</h2>
          <p className="text-sm text-red-300">{error}</p>
          <button
            onClick={() => { setLoading(true); void fetchData(); }}
            className="mt-4 px-4 py-2 rounded border border-border text-text-muted hover:text-text-secondary text-sm transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const stats = [
    { label: 'Total Agents', value: dashboard?.agentCount ?? 0 },
    { label: 'Active', value: dashboard?.activeCount ?? 0 },
    { label: 'Avg DEMOS', value: (dashboard?.avgDemosScore ?? 0).toFixed(1) },
    { label: 'Total Decisions', value: (dashboard?.totalDecisions ?? 0).toLocaleString() },
  ];

  return (
    <div className="max-w-5xl mx-auto px-8 py-section">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-serif text-3xl font-semibold text-stone">Researcher Dashboard</h1>
        <p className="text-sm text-text-muted mt-1">Manage your agents, monitor performance, and export training data</p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((s) => (
          <div key={s.label} className="card p-4 text-center">
            <div className="font-mono text-xl text-gold font-bold">{s.value}</div>
            <div className="text-xs text-text-muted uppercase tracking-wide mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-border mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              if (tab.id !== 'performance') {
                setSelectedPerformanceAgentId(null);
              }
            }}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-all ${
              activeTab === tab.id
                ? 'text-gold border-gold'
                : 'text-text-muted border-transparent hover:text-text-secondary hover:border-border'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'agents' && (
        <AgentsTab
          agents={agents}
          onRefresh={() => void fetchData()}
          onViewPerformance={handleViewPerformance}
        />
      )}
      {activeTab === 'performance' && (
        <PerformanceTab
          agents={agents}
          selectedAgentId={selectedPerformanceAgentId}
        />
      )}
      {activeTab === 'apikeys' && <ApiKeysTab />}
      {activeTab === 'exports' && <ExportsTab agents={agents} />}
    </div>
  );
}
