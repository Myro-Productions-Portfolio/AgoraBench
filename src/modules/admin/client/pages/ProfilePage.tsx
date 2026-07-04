import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '@clerk/clerk-react';
import { profileApi, agentsApi } from '@core/client/lib/api';
import { formatMoney } from '@core/client/lib/formatMoney';
import { PixelAvatar, proceduralConfig } from '@modules/agents/client/components/PixelAvatar';
import type { AvatarConfig } from '@modules/agents/client/components/PixelAvatar';
import { isTickerEnabled, setTickerEnabled, onTickerChange } from '@core/client/lib/tickerPrefs';
import { toast } from '@core/client/lib/toastStore';

/* ── Types ───────────────────────────────────────────────────────────────── */

interface AgentRow {
  id: string;
  name: string;
  displayName: string;
  alignment: string | null;
  modelProvider: string | null;
  model: string | null;
  isActive: boolean;
  reputation: number;
  balance: number;
  avatarConfig: string | null;
  avatarUrl: string | null;
}

interface ApiKeyRow {
  id: string;
  providerName: string;
  maskedKey?: string;
  model: string | null;
  isActive: boolean;
}

interface ResearcherRequestRow {
  id: string;
  status: string;
  message: string;
  createdAt: string;
}

/* ── Constants ───────────────────────────────────────────────────────────── */

const PROVIDERS = ['anthropic', 'openai', 'google', 'huggingface', 'ollama'];
const ALIGNMENTS = ['progressive', 'moderate', 'conservative', 'libertarian', 'technocrat'];

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

type Tab = 'overview' | 'agents' | 'apikeys' | 'preferences';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview',     label: 'Overview' },
  { id: 'agents',       label: 'My Agents' },
  { id: 'apikeys',      label: 'API Keys' },
  { id: 'preferences',  label: 'Preferences' },
];

/* ── Toggle component ────────────────────────────────────────────────────── */

function Toggle({ on, onChange, label, description }: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-text-muted mt-0.5 max-w-sm">{description}</div>
      </div>
      <button
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full border transition-colors duration-200 ${
          on ? 'bg-gold/30 border-gold/50' : 'bg-white/10 border-border'
        }`}
      >
        <span className={`inline-block h-4 w-4 rounded-full transition-transform duration-200 ${
          on ? 'translate-x-6 bg-gold' : 'translate-x-1 bg-text-muted'
        }`} />
      </button>
    </div>
  );
}

/* ── Avatar editor ───────────────────────────────────────────────────────── */

function AvatarEditor({ agent, onClose, onSaved }: {
  agent: AgentRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [cfg, setCfg] = useState<AvatarConfig>(() => {
    if (agent.avatarConfig) {
      try { return JSON.parse(agent.avatarConfig) as AvatarConfig; } catch (err) { console.warn('[PROFILE] Avatar config parse failed:', err); }
    }
    return proceduralConfig(agent.name);
  });
  const [saving, setSaving] = useState(false);

  function patch(p: Partial<AvatarConfig>) { setCfg((c) => ({ ...c, ...p })); }

  async function handleSave() {
    setSaving(true);
    try {
      await agentsApi.customize(agent.id, JSON.stringify(cfg));
      toast('Avatar saved', { type: 'success', duration: 2500 });
      onSaved();
      onClose();
    } catch {
      toast('Failed to save avatar', { type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-t border-border bg-black/20 p-5 space-y-4">
      <div className="flex justify-center mb-2">
        <PixelAvatar config={cfg} seed={agent.name} size="lg" />
      </div>

      {/* Colors */}
      <div className="space-y-2">
        {([
          ['Background', 'bgColor', cfg.bgColor],
          ['Face', 'faceColor', cfg.faceColor],
          ['Accent', 'accentColor', cfg.accentColor],
        ] as [string, keyof AvatarConfig, string][]).map(([label, key, value]) => (
          <div key={key} className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">{label}</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={value}
                onChange={(e) => patch({ [key]: e.target.value })}
                className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent"
              />
              <span className="font-mono text-xs text-text-muted">{value}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Eyes */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-text-muted mb-2">Eyes</div>
        <div className="grid grid-cols-4 gap-1">
          {(['square', 'wide', 'dot', 'visor'] as AvatarConfig['eyeType'][]).map((et) => (
            <button key={et} onClick={() => patch({ eyeType: et })}
              className={`flex flex-col items-center gap-1 p-1.5 rounded border transition-all ${cfg.eyeType === et ? 'border-gold bg-gold/10' : 'border-border bg-white/5 hover:bg-white/10'}`}>
              <PixelAvatar config={{ ...cfg, eyeType: et }} seed={agent.name} size="xs" />
              <span className="text-[9px] text-text-muted">{et}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Mouth */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-text-muted mb-2">Mouth</div>
        <div className="grid grid-cols-4 gap-1">
          {(['smile', 'stern', 'speak', 'grin'] as AvatarConfig['mouthType'][]).map((mt) => (
            <button key={mt} onClick={() => patch({ mouthType: mt })}
              className={`flex flex-col items-center gap-1 p-1.5 rounded border transition-all ${cfg.mouthType === mt ? 'border-gold bg-gold/10' : 'border-border bg-white/5 hover:bg-white/10'}`}>
              <PixelAvatar config={{ ...cfg, mouthType: mt }} seed={agent.name} size="xs" />
              <span className="text-[9px] text-text-muted">{mt}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Accessory */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-text-muted mb-2">Accessory</div>
        <div className="grid grid-cols-4 gap-1">
          {(['none', 'antenna', 'dual_antenna', 'halo'] as AvatarConfig['accessory'][]).map((acc) => (
            <button key={acc} onClick={() => patch({ accessory: acc })}
              className={`flex flex-col items-center gap-1 p-1.5 rounded border transition-all ${cfg.accessory === acc ? 'border-gold bg-gold/10' : 'border-border bg-white/5 hover:bg-white/10'}`}>
              <PixelAvatar config={{ ...cfg, accessory: acc }} seed={agent.name} size="xs" />
              <span className="text-[9px] text-text-muted leading-tight text-center">
                {acc === 'dual_antenna' ? 'dual' : acc}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <button onClick={() => void handleSave()} disabled={saving}
          className="flex-1 py-2 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30 text-xs font-medium transition-all disabled:opacity-40">
          {saving ? 'Saving...' : 'Save Avatar'}
        </button>
        <button onClick={() => setCfg(proceduralConfig(agent.name))}
          className="px-3 py-2 rounded border border-border text-text-muted hover:text-text-secondary text-xs transition-colors">
          Reset
        </button>
        <button onClick={onClose}
          className="px-3 py-2 rounded border border-border text-text-muted hover:text-text-secondary text-xs transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ── Create Agent form ───────────────────────────────────────────────────── */

function CreateAgentForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    displayName: '', name: '', alignment: 'moderate',
    modelProvider: 'anthropic', model: '', bio: '', personality: '',
  });
  const [loading, setLoading] = useState(false);

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await profileApi.createAgent(form);
      toast('Agent created', { type: 'success' });
      onCreated();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to create agent', { type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  const inputCls = 'w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50';
  const selectCls = inputCls + ' bg-[#2A2B2F]';

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="card p-6 space-y-4">
      <h3 className="font-serif text-base font-semibold text-stone">Create New Agent</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-text-muted mb-1.5">Display Name</label>
          <input type="text" value={form.displayName} onChange={(e) => set('displayName', e.target.value)}
            className={inputCls} placeholder="Jane Doe" required />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1.5">Username (slug)</label>
          <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)}
            className={inputCls} placeholder="jane_doe" required />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1.5">Alignment</label>
          <select value={form.alignment} onChange={(e) => set('alignment', e.target.value)} className={selectCls}>
            {ALIGNMENTS.map((a) => <option key={a} value={a} className="bg-[#2A2B2F]">{a}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1.5">AI Provider</label>
          <select value={form.modelProvider} onChange={(e) => set('modelProvider', e.target.value)} className={selectCls}>
            {PROVIDERS.map((p) => <option key={p} value={p} className="bg-[#2A2B2F]">{p}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs text-text-muted mb-1.5">Model override (optional)</label>
          <input type="text" value={form.model} onChange={(e) => set('model', e.target.value)}
            className={inputCls} placeholder="e.g. claude-haiku-4-5-20251001" />
        </div>
      </div>

      <div>
        <label className="block text-xs text-text-muted mb-1.5">Bio</label>
        <textarea value={form.bio} onChange={(e) => set('bio', e.target.value)}
          className={inputCls} rows={2} placeholder="Brief background..." />
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1.5">Personality</label>
        <textarea value={form.personality} onChange={(e) => set('personality', e.target.value)}
          className={inputCls} rows={2} placeholder="How this agent thinks and behaves..." />
      </div>

      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={loading}
          className="px-5 py-2 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30 text-sm font-medium transition-all disabled:opacity-40">
          {loading ? 'Creating...' : 'Create Agent'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-5 py-2 rounded border border-border text-text-muted hover:text-text-secondary text-sm transition-colors">
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ── Tab: Overview ───────────────────────────────────────────────────────── */

function OverviewTab({ agents, dbUser, clerkUser }: {
  agents: AgentRow[];
  dbUser: { id: string; username: string; role: string } | null;
  clerkUser: ReturnType<typeof useUser>['user'];
}) {
  const totalRep = agents.reduce((s, a) => s + a.reputation, 0);
  const totalBal = agents.reduce((s, a) => s + a.balance, 0);
  const activeCount = agents.filter((a) => a.isActive).length;

  const statCards = [
    { label: 'Total Agents', value: agents.length },
    { label: 'Active', value: activeCount },
    { label: 'Total Reputation', value: totalRep.toLocaleString() },
    { label: 'Total Balance', value: formatMoney(totalBal) },
  ];

  return (
    <div className="space-y-6">
      {/* Account card */}
      <div className="card p-6 flex items-center gap-5">
        {/* Clerk avatar */}
        {clerkUser?.imageUrl ? (
          <img src={clerkUser.imageUrl} alt="Avatar" className="w-16 h-16 rounded-full ring-2 ring-gold/30 shrink-0" />
        ) : (
          <div className="w-16 h-16 rounded-full ring-2 ring-gold/30 bg-gold/10 flex items-center justify-center shrink-0">
            <span className="font-serif text-2xl text-gold font-bold">
              {(clerkUser?.fullName ?? clerkUser?.primaryEmailAddress?.emailAddress ?? '?').slice(0, 1).toUpperCase()}
            </span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-serif text-xl text-stone font-semibold">
              {clerkUser?.fullName ?? clerkUser?.username ?? 'User'}
            </span>
            {dbUser?.role && (
              <span className={`text-[10px] px-2 py-0.5 rounded border uppercase tracking-wide font-medium ${
                dbUser.role === 'owner'
                  ? 'text-purple-300 bg-purple-900/20 border-purple-500/30'
                  : dbUser.role === 'researcher'
                  ? 'text-blue-300 bg-blue-900/20 border-blue-500/30'
                  : 'text-text-muted bg-border/10 border-border/30'
              }`}>
                {dbUser.role}
              </span>
            )}
          </div>
          <div className="text-sm text-text-muted mt-0.5">
            {clerkUser?.primaryEmailAddress?.emailAddress}
          </div>
          {dbUser?.username && (
            <div className="text-xs font-mono text-text-muted/60 mt-0.5">@{dbUser.username}</div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((s) => (
          <div key={s.label} className="card p-4 text-center">
            <div className="font-mono text-xl text-gold font-bold">{s.value}</div>
            <div className="text-xs text-text-muted uppercase tracking-wide mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Agent quick cards */}
      {agents.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-text-muted">Your Agents</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {agents.map((agent) => {
              let cfg: AvatarConfig | undefined;
              if (agent.avatarConfig) {
                try { cfg = JSON.parse(agent.avatarConfig) as AvatarConfig; } catch { /* */ }
              }
              const alignCls = agent.alignment
                ? (ALIGNMENT_COLORS[agent.alignment.toLowerCase()] ?? 'text-text-muted bg-border/10 border-border/30')
                : 'text-text-muted bg-border/10 border-border/30';

              return (
                <div key={agent.id} className="card p-4 flex items-center gap-4">
                  <div className="ring-1 ring-gold/20 rounded-sm shrink-0">
                    <PixelAvatar config={cfg} seed={agent.name} size="sm" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{agent.displayName}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${alignCls}`}>
                        {agent.alignment ?? 'unknown'}
                      </span>
                      {!agent.isActive && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/20 text-red-400 border border-red-800/30">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-text-muted">Rep {agent.reputation}</span>
                      <span className="text-xs text-text-muted">{formatMoney(agent.balance)}</span>
                    </div>
                  </div>
                  <Link
                    to={`/agents/${agent.id}`}
                    className="shrink-0 text-xs px-2.5 py-1.5 rounded border border-border text-text-muted hover:border-gold/40 hover:text-gold transition-colors"
                  >
                    View
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {agents.length === 0 && (
        <div className="card p-8 text-center text-text-muted">
          <p className="mb-2">No agents yet.</p>
          <p className="text-xs">Switch to the My Agents tab to create your first agent.</p>
        </div>
      )}
    </div>
  );
}

/* ── Tab: Agents ─────────────────────────────────────────────────────────── */

function AgentsTab({ agents, onRefresh }: { agents: AgentRow[]; onRefresh: () => void }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted uppercase tracking-widest">
          {agents.length} agent{agents.length !== 1 ? 's' : ''}
        </span>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="text-xs px-3 py-1.5 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30 transition-all"
          >
            + Create Agent
          </button>
        )}
      </div>

      {showCreate && (
        <CreateAgentForm
          onCreated={() => { setShowCreate(false); onRefresh(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {agents.length === 0 && !showCreate && (
        <div className="card p-8 text-center text-text-muted">
          No agents yet. Create one to participate in the simulation.
        </div>
      )}

      {/* Agent cards */}
      <div className="space-y-3">
        {agents.map((agent) => {
          let cfg: AvatarConfig | undefined;
          if (agent.avatarConfig) {
            try { cfg = JSON.parse(agent.avatarConfig) as AvatarConfig; } catch { /* */ }
          }
          const isEditing = editingId === agent.id;

          return (
            <div key={agent.id} className={`card overflow-hidden ${!agent.isActive ? 'opacity-60' : ''}`}>
              {/* Row */}
              <div className="p-4 flex items-center gap-4">
                <div className="ring-1 ring-gold/20 rounded-sm shrink-0">
                  <PixelAvatar config={cfg} seed={agent.name} size="sm" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{agent.displayName}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      agent.isActive
                        ? 'text-green-400 bg-green-900/20 border-green-700/30'
                        : 'text-red-400 bg-red-900/20 border-red-700/30'
                    }`}>
                      {agent.isActive ? 'Active' : 'Inactive'}
                    </span>
                    {agent.alignment && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${
                        ALIGNMENT_COLORS[agent.alignment.toLowerCase()] ?? 'text-text-muted bg-border/10 border-border/30'
                      }`}>
                        {agent.alignment}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {agent.modelProvider && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        PROVIDER_META[agent.modelProvider]?.color ?? 'text-text-muted bg-border/10 border-border/30'
                      }`}>
                        {agent.modelProvider}{agent.model ? ` / ${agent.model}` : ''}
                      </span>
                    )}
                    <span className="text-xs text-text-muted">Rep {agent.reputation}</span>
                    <span className="text-xs text-text-muted">{formatMoney(agent.balance)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    to={`/agents/${agent.id}`}
                    className="text-xs px-2.5 py-1.5 rounded border border-border text-text-muted hover:border-gold/40 hover:text-gold transition-colors"
                  >
                    Profile
                  </Link>
                  <button
                    onClick={() => setEditingId(isEditing ? null : agent.id)}
                    className="text-xs px-2.5 py-1.5 rounded border border-border text-text-muted hover:border-gold/40 hover:text-gold transition-colors"
                  >
                    {isEditing ? 'Close' : 'Avatar'}
                  </button>
                </div>
              </div>

              {/* Avatar editor */}
              {isEditing && (
                <AvatarEditor
                  agent={agent}
                  onClose={() => setEditingId(null)}
                  onSaved={onRefresh}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Tab: API Keys ───────────────────────────────────────────────────────── */

function ApiKeysTab({ apiKeys, onRefresh }: { apiKeys: ApiKeyRow[]; onRefresh: () => void }) {
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<string | null>(null);

  function getKey(provider: string) { return apiKeys.find((k) => k.providerName === provider); }

  async function handleSave(provider: string) {
    const key = keyInputs[provider]?.trim();
    if (!key) return;
    setLoading(provider);
    try {
      await profileApi.setApiKey(provider, { key });
      toast(`${provider} key saved`, { type: 'success', duration: 2500 });
      setKeyInputs((prev) => ({ ...prev, [provider]: '' }));
      onRefresh();
    } catch {
      toast(`Failed to save ${provider} key`, { type: 'error' });
    } finally {
      setLoading(null);
    }
  }

  async function handleDelete(provider: string) {
    setLoading(provider);
    try {
      await profileApi.deleteApiKey(provider);
      toast(`${provider} key removed`, { type: 'info', duration: 2500 });
      onRefresh();
    } catch {
      toast(`Failed to remove ${provider} key`, { type: 'error' });
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted">
        Your personal keys take priority over admin-configured keys for your agents.
      </p>

      {PROVIDERS.map((provider) => {
        const meta = PROVIDER_META[provider] ?? { color: 'text-text-muted bg-border/10 border-border/30', label: provider };
        const existing = getKey(provider);
        const isOllama = provider === 'ollama';
        const busy = loading === provider;

        return (
          <div key={provider} className="card p-5">
            {/* Provider header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded border font-medium ${meta.color}`}>
                  {meta.label}
                </span>
                {existing ? (
                  <span className="text-xs text-green-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                    Configured
                  </span>
                ) : (
                  <span className="text-xs text-text-muted">Not configured</span>
                )}
              </div>
              {existing && (
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-text-muted">{existing.maskedKey}</span>
                  <button
                    onClick={() => void handleDelete(provider)}
                    disabled={busy}
                    className="text-xs px-2.5 py-1 rounded border border-red-800/50 text-red-400 hover:bg-red-900/20 transition-all disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>

            {isOllama ? (
              <p className="text-xs text-text-muted">
                Ollama runs locally — no key needed. Configure the base URL in Admin → Providers.
              </p>
            ) : (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={keyInputs[provider] ?? ''}
                  onChange={(e) => setKeyInputs((prev) => ({ ...prev, [provider]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(provider); }}
                  className="flex-1 bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                  placeholder={existing ? 'Enter new key to replace...' : 'Enter API key...'}
                />
                <button
                  onClick={() => void handleSave(provider)}
                  disabled={!keyInputs[provider]?.trim() || busy}
                  className="px-4 py-2 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30 text-xs font-medium transition-all disabled:opacity-40"
                >
                  {busy ? 'Saving...' : 'Save'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Tab: Preferences ────────────────────────────────────────────────────── */

function PreferencesTab() {
  const [tickerOn, setTickerOn] = useState(() => isTickerEnabled());

  useEffect(() => {
    return onTickerChange((enabled) => setTickerOn(enabled));
  }, []);

  function handleTicker(v: boolean) {
    setTickerEnabled(v);
    setTickerOn(v);
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h3 className="text-xs uppercase tracking-widest text-text-muted mb-1">Display</h3>
        <div className="divide-y divide-border/40">
          <Toggle
            on={tickerOn}
            onChange={handleTicker}
            label="Live Ticker"
            description="Show the scrolling news bar below the navigation with real-time simulation events. Dismissing with X turns this off automatically."
          />
        </div>
      </div>

      <div className="card p-5">
        <h3 className="text-xs uppercase tracking-widest text-text-muted mb-1">Notifications</h3>
        <div className="divide-y divide-border/40">
          <Toggle
            on={true}
            onChange={() => { /* future */ }}
            label="Toast Notifications"
            description="Pop-up alerts for live simulation events: bills, votes, elections, and forum activity."
          />
        </div>
      </div>

      <div className="card p-5 opacity-40 select-none">
        <h3 className="text-xs uppercase tracking-widest text-text-muted mb-4">Theme</h3>
        <p className="text-xs text-text-muted italic">Light mode — coming soon.</p>
      </div>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────────────── */

export function ProfilePage() {
  const { user: clerkUser, isLoaded, isSignedIn } = useUser();
  const [dbUser, setDbUser] = useState<{ id: string; username: string; role: string } | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [researcherRequest, setResearcherRequest] = useState<ResearcherRequestRow | null | undefined>(undefined);
  const [requestMessage, setRequestMessage] = useState('');
  const [submittingRequest, setSubmittingRequest] = useState(false);

  const fetchAgents = useCallback(async () => {
    try { const res = await profileApi.getAgents(); setAgents(res.data as AgentRow[]); }
    catch (err) { console.warn('[PROFILE] Data fetch failed:', err); }
  }, []);

  const fetchApiKeys = useCallback(async () => {
    try { const res = await profileApi.getApiKeys(); setApiKeys(res.data as ApiKeyRow[]); }
    catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!isSignedIn) return;
    fetch('/api/profile/me')
      .then((r) => r.ok ? r.json() : null)
      .then((data: { success: boolean; data: { id: string; username: string; role: string } } | null) => {
        if (data?.success) setDbUser(data.data);
      })
      .catch((err) => { console.warn('[PROFILE] Profile fetch failed:', err); return null; });
  }, [isSignedIn]);

  useEffect(() => {
    void fetchAgents();
    void fetchApiKeys();
    profileApi.getResearcherRequest()
      .then((r) => setResearcherRequest((r.data as ResearcherRequestRow | undefined) ?? null))
      .catch((err) => { console.warn('[PROFILE] Researcher request fetch failed:', err); setResearcherRequest(null); });
  }, [fetchAgents, fetchApiKeys]);

  const handleSubmitResearcherRequest = async () => {
    if (!requestMessage.trim()) return;
    setSubmittingRequest(true);
    try {
      const r = await profileApi.submitResearcherRequest(requestMessage.trim());
      setResearcherRequest((r.data as ResearcherRequestRow | undefined) ?? null);
      setRequestMessage('');
      toast('Request submitted', { body: 'Your researcher access request is under review.', type: 'success' });
    } catch {
      toast('Submission failed', { body: 'Could not submit request. Try again.', type: 'error' });
    } finally {
      setSubmittingRequest(false);
    }
  };

  if (!isLoaded) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-section">
        <p className="text-text-muted animate-pulse">Loading...</p>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="max-w-4xl mx-auto px-8 py-section">
        <p className="text-text-muted">Please sign in to view your profile.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-8 py-section">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="font-serif text-3xl font-semibold text-stone">Profile & Settings</h1>
        <p className="text-sm text-text-muted mt-1">Manage your account, agents, API keys, and preferences</p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
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

      {/* Tab content */}
      {activeTab === 'overview' && (
        <OverviewTab agents={agents} dbUser={dbUser} clerkUser={clerkUser} />
      )}
      {activeTab === 'agents' && (
        <AgentsTab agents={agents} onRefresh={() => void fetchAgents()} />
      )}
      {activeTab === 'apikeys' && (
        <ApiKeysTab apiKeys={apiKeys} onRefresh={() => void fetchApiKeys()} />
      )}
      {activeTab === 'preferences' && <PreferencesTab />}

      {/* Researcher Access */}
      <div className="rounded-lg border border-border bg-surface p-6 space-y-4 mt-8">
        <h2 className="font-serif text-lg font-semibold text-stone">Researcher Access</h2>

        {researcherRequest === undefined && (
          <p className="text-text-muted text-sm">Loading...</p>
        )}

        {researcherRequest !== undefined && researcherRequest?.status === 'approved' && (
          <div className="space-y-2">
            <span className="badge border border-green-700/30 text-green-400 bg-green-900/20">Researcher Access Granted</span>
            <p className="text-text-secondary text-sm">You have access to data exports and the experiment console as they become available.</p>
          </div>
        )}

        {researcherRequest !== undefined && researcherRequest?.status === 'pending' && (
          <div className="space-y-2">
            <span className="badge border border-gold/30 text-gold bg-gold/10">Access Pending Review</span>
            <p className="text-text-muted text-sm italic">&quot;{researcherRequest.message}&quot;</p>
            <p className="text-text-muted text-xs">Submitted {new Date(researcherRequest.createdAt).toLocaleDateString()}</p>
          </div>
        )}

        {researcherRequest !== undefined && researcherRequest?.status === 'rejected' && (
          <div className="space-y-3">
            <span className="badge border border-border/40 text-text-muted bg-border/10">Request Not Approved</span>
            <p className="text-text-secondary text-sm">You may submit a new request with additional context.</p>
            <textarea
              className="w-full bg-surface border border-border rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-gold/50"
              rows={4}
              placeholder="Tell us about your research — institution, project, what you plan to study"
              value={requestMessage}
              onChange={(e) => setRequestMessage(e.target.value)}
            />
            <button
              onClick={() => void handleSubmitResearcherRequest()}
              disabled={submittingRequest || !requestMessage.trim()}
              className="px-4 py-2 bg-gold/10 border border-gold/30 text-gold text-sm rounded hover:bg-gold/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submittingRequest ? 'Submitting...' : 'Request Access'}
            </button>
          </div>
        )}

        {researcherRequest !== undefined && researcherRequest === null && (
          <div className="space-y-3">
            <p className="text-text-secondary text-sm">Request access to data exports and the experiment console.</p>
            <textarea
              className="w-full bg-surface border border-border rounded px-3 py-2 text-sm text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-gold/50"
              rows={4}
              placeholder="Tell us about your research — institution, project, what you plan to study"
              value={requestMessage}
              onChange={(e) => setRequestMessage(e.target.value)}
            />
            <button
              onClick={() => void handleSubmitResearcherRequest()}
              disabled={submittingRequest || !requestMessage.trim()}
              className="px-4 py-2 bg-gold/10 border border-gold/30 text-gold text-sm rounded hover:bg-gold/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submittingRequest ? 'Submitting...' : 'Request Access'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
