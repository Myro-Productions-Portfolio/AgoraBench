import { useState, useEffect, useCallback } from 'react';
import { adminApi, agentsApi, providersApi } from '../lib/api';
import { useWebSocket } from '../lib/useWebSocket';
import { PixelAvatar, proceduralConfig } from '../../modules/agents/client/components/PixelAvatar';
import type { AvatarConfig } from '../../modules/agents/client/components/PixelAvatar';
import { CollapsibleSection } from '../components/CollapsibleSection';

type AdminTab = 'overview' | 'simulation' | 'government' | 'agents' | 'providers' | 'access' | 'users' | 'database' | 'experiments';

interface ResearcherRequest {
  id: string;
  userId: string;
  username: string;
  email: string | null;
  message: string;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
}

interface SimulationStatus {
  isPaused: boolean;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
}

interface DecisionStats {
  total: number;
  errors: number;
  haikuCount: number;
  ollamaCount: number;
}

interface Decision {
  id: string;
  agentName: string | null;
  provider: string;
  phase: string | null;
  parsedAction: string | null;
  parsedReasoning: string | null;
  success: boolean;
  latencyMs: number;
  createdAt: string;
}

interface RuntimeConfig {
  /* Simulation */
  tickIntervalMs: number;
  billAdvancementDelayMs: number;
  providerOverride: 'default' | 'anthropic' | 'openai' | 'google' | 'huggingface' | 'ollama';
  /* Agent Behavior */
  billProposalChance: number;
  campaignSpeechChance: number;
  amendmentProposalChance: number;
  /* Government Structure */
  congressSeats: number;
  congressTermDays: number;
  presidentTermDays: number;
  supremeCourtJustices: number;
  quorumPercentage: number;
  billPassagePercentage: number;
  supermajorityPercentage: number;
  /* Elections */
  campaignDurationDays: number;
  votingDurationHours: number;
  minReputationToRun: number;
  minReputationToVote: number;
  /* Economy (runtime) */
  initialAgentBalance: number;
  campaignFilingFee: number;
  partyCreationFee: number;
  salaryPresident: number;
  salaryCabinet: number;
  salaryCongress: number;
  salaryJustice: number;
  /* Governance Probabilities */
  vetoBaseRate: number;
  vetoRatePerTier: number;
  vetoMaxRate: number;
  committeeTableRateOpposing: number;
  committeeTableRateNeutral: number;
  committeeAmendRate: number;
  judicialChallengeRatePerLaw: number;
  partyWhipFollowRate: number;
  vetoOverrideThreshold: number;
  /* Guard Rails */
  maxPromptLengthChars: number;
  maxOutputLengthTokens: number;
  maxBillsPerAgentPerTick: number;
  maxCampaignSpeechesPerTick: number;
}

interface EconomySettings {
  treasuryBalance: number;
  taxRatePercent: number;
}

interface AgentRow {
  id: string;
  displayName: string;
  alignment: string;
  modelProvider: string;
  isActive: boolean;
  reputation: number;
  balance: number;
}

interface AvatarAgentRow {
  id: string;
  name: string;
  displayName: string;
  avatarConfig: string | null;
}

interface ProviderRow {
  providerName: string;
  isConfigured: boolean;
  isActive: boolean;
  maskedKey: string | null;
  ollamaBaseUrl: string | null;
  models: string[];
}

const EXPORT_KEY_MAP: Record<string, string> = {
  'agent-decisions': 'agentDecisions',
  'approval-events': 'approvalEvents',
  'bills': 'bills',
  'bill-votes': 'billVotes',
  'laws': 'laws',
  'elections': 'elections',
  'agents': 'agents',
};

const SIDEBAR_TABS: { id: AdminTab; label: string; icon: string }[] = [
  { id: 'overview',    label: 'Overview',        icon: '\u25A3' },
  { id: 'simulation',  label: 'Simulation',      icon: '\u2699' },
  { id: 'government',  label: 'Government',      icon: '\u2696' },
  { id: 'agents',      label: 'Agents',          icon: '\u25C6' },
  { id: 'providers',   label: 'Providers',       icon: '\u25C8' },
  { id: 'access',      label: 'Access Requests', icon: '\u2295' },
  { id: 'users',       label: 'Users',           icon: '\u2630' },
  { id: 'database',    label: 'Database',        icon: '\u26A0' },
  { id: 'experiments', label: 'Experiments',     icon: '\u229E' },
];

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium uppercase tracking-wide ${
        ok ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
      {label}
    </span>
  );
}

function AdminButton({
  onClick,
  disabled,
  variant = 'default',
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'danger' | 'gold';
  children: React.ReactNode;
}) {
  const base = 'px-4 py-2 rounded text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed';
  const variants = {
    default: 'bg-white/10 text-text-primary hover:bg-white/20 border border-border',
    danger: 'bg-red-900/30 text-red-400 hover:bg-red-900/50 border border-red-800',
    gold: 'bg-gold/20 text-gold hover:bg-gold/30 border border-gold/40',
  };
  return (
    <button className={`${base} ${variants[variant]}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function msToLabel(ms: number): string {
  if (ms < 60_000) return `${ms / 1000}s`;
  if (ms < 3_600_000) return `${ms / 60_000}m`;
  if (ms < 86_400_000) return `${ms / 3_600_000}h`;
  return `${ms / 86_400_000}d`;
}

const TICK_PRESETS = [
  { label: '30s', ms: 30_000 },
  { label: '2m', ms: 120_000 },
  { label: '5m', ms: 300_000 },
  { label: '15m', ms: 900_000 },
  { label: '1h', ms: 3_600_000 },
  { label: '6h', ms: 21_600_000 },
  { label: '24h', ms: 86_400_000 },
];

const ADVANCEMENT_PRESETS = [
  { label: '30s', ms: 30_000 },
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
  { label: '15m', ms: 900_000 },
  { label: '1h', ms: 3_600_000 },
];

const ALIGNMENTS = ['progressive', 'moderate', 'conservative', 'libertarian', 'technocrat'];
const AI_PROVIDERS = ['anthropic', 'openai', 'google', 'huggingface', 'ollama'];

function AccessRequestsPanel({
  requests,
  onApprove,
  onReject,
}: {
  requests: ResearcherRequest[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [resolvedExpanded, setResolvedExpanded] = useState(false);
  const pending = requests.filter((r) => r.status === 'pending');
  const resolved = requests.filter((r) => r.status !== 'pending');

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-badge text-text-muted uppercase tracking-widest">Pending ({pending.length})</p>
        <div className="rounded-lg border border-border overflow-hidden">
          {pending.length === 0 ? (
            <p className="p-4 text-text-muted text-sm">No pending requests.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2 text-text-muted font-normal">Name / Email</th>
                  <th className="text-left px-4 py-2 text-text-muted font-normal">Message</th>
                  <th className="text-left px-4 py-2 text-text-muted font-normal">Requested</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {pending.map((req) => (
                  <tr key={req.id} className="border-b border-border/50 last:border-0">
                    <td className="px-4 py-3">
                      <p className="text-text-primary">{req.username}</p>
                      {req.email && <p className="text-text-muted text-xs">{req.email}</p>}
                    </td>
                    <td className="px-4 py-3 text-text-secondary max-w-xs truncate">&quot;{req.message}&quot;</td>
                    <td className="px-4 py-3 text-text-muted whitespace-nowrap">
                      {new Date(req.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => onApprove(req.id)}
                          className="px-3 py-1 bg-green-900/20 border border-green-700/30 text-green-400 text-xs rounded hover:bg-green-900/40 transition-colors"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => onReject(req.id)}
                          className="px-3 py-1 bg-border/10 border border-border/40 text-text-muted text-xs rounded hover:text-danger hover:border-danger/30 transition-colors"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <button
          onClick={() => setResolvedExpanded((e) => !e)}
          className="text-badge text-text-muted uppercase tracking-widest hover:text-gold transition-colors"
        >
          {resolvedExpanded ? '\u25BE' : '\u25B8'} Resolved ({resolved.length})
        </button>
        {resolvedExpanded && (
          <div className="rounded-lg border border-border overflow-hidden">
            {resolved.length === 0 ? (
              <p className="p-4 text-text-muted text-sm">No resolved requests.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-2 text-text-muted font-normal">Name</th>
                    <th className="text-left px-4 py-2 text-text-muted font-normal">Message</th>
                    <th className="text-left px-4 py-2 text-text-muted font-normal">Status</th>
                    <th className="text-left px-4 py-2 text-text-muted font-normal">Reviewed</th>
                  </tr>
                </thead>
                <tbody>
                  {resolved.map((req) => (
                    <tr key={req.id} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-3 text-text-primary">{req.username}</td>
                      <td className="px-4 py-3 text-text-secondary max-w-xs truncate">&quot;{req.message}&quot;</td>
                      <td className="px-4 py-3">
                        <span
                          className={`badge border ${
                            req.status === 'approved'
                              ? 'text-green-400 bg-green-900/20 border-green-700/30'
                              : 'text-text-muted bg-border/10 border-border/40'
                          }`}
                        >
                          {req.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {req.reviewedAt ? new Date(req.reviewedAt).toLocaleDateString() : '\u2014'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    return (localStorage.getItem('admin_active_tab') as AdminTab) ?? 'overview';
  });
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    return localStorage.getItem('admin_sidebar_open') !== 'false';
  });
  const [researcherRequests, setResearcherRequests] = useState<ResearcherRequest[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  const [simStatus, setSimStatus] = useState<SimulationStatus | null>(null);
  const [decisionStats, setDecisionStats] = useState<DecisionStats | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [simConfig, setSimConfig] = useState<RuntimeConfig | null>(null);
  const [economySettings, setEconomySettings] = useState<EconomySettings | null>(null);
  const [agentList, setAgentList] = useState<AgentRow[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [reseedConfirm, setReseedConfirm] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const { subscribe } = useWebSocket();

  /* Avatar customizer state */
  const [avatarAgents, setAvatarAgents] = useState<AvatarAgentRow[]>([]);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [draftConfigs, setDraftConfigs] = useState<Record<string, AvatarConfig>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<Record<string, string>>({});

  /* Users state */
  const [userList, setUserList] = useState<{ id: string; username: string; email: string | null; role: string; clerkUserId: string | null; createdAt: string }[]>([]);
  const [userRoleSaving, setUserRoleSaving] = useState<string | null>(null);

  /* Provider panel state */
  const [providerKeyInputs, setProviderKeyInputs] = useState<Record<string, string>>({});
  const [providerOllamaInputs, setProviderOllamaInputs] = useState<Record<string, string>>({});
  const [providerTesting, setProviderTesting] = useState<string | null>(null);
  const [providerTestResults, setProviderTestResults] = useState<Record<string, { success: boolean; latencyMs: number; error?: string }>>({});
  const [providerSaving, setProviderSaving] = useState<string | null>(null);

  /* Create agent panel state */
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [agentForm, setAgentForm] = useState({
    displayName: '', name: '', alignment: 'moderate', modelProvider: 'anthropic', model: '', bio: '', personality: '', startingBalance: 1000,
  });
  const [agentFormLoading, setAgentFormLoading] = useState(false);

  /* Experiments / export state */
  const [exportCounts, setExportCounts] = useState<Record<string, number> | null>(null);
  const [exportingDataset, setExportingDataset] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleTabChange = (tab: AdminTab) => {
    setActiveTab(tab);
    localStorage.setItem('admin_active_tab', tab);
  };

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem('admin_sidebar_open', String(next));
      return next;
    });
  };

  const handleExport = async (dataset: string, filename: string) => {
    setExportingDataset(dataset);
    setExportError(null);
    try {
      await adminApi.downloadExport(dataset, filename);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExportingDataset(null);
    }
  };

  const fetchResearcherRequests = useCallback(async () => {
    try {
      const r = await adminApi.getResearcherRequests();
      const requests = (r.data as ResearcherRequest[] | undefined) ?? [];
      setResearcherRequests(requests);
      setPendingCount(requests.filter((req) => req.status === 'pending').length);
    } catch { /* silent */ }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await adminApi.status();
      const data = res.data as { simulation: SimulationStatus; decisions: DecisionStats };
      setSimStatus(data.simulation);
      setDecisionStats(data.decisions);
    } catch { /* ignore */ }
  }, []);

  const fetchDecisions = useCallback(async () => {
    try {
      const res = await adminApi.decisions(1, 50);
      if (res.data && Array.isArray(res.data)) {
        setDecisions(res.data as Decision[]);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await adminApi.getConfig();
      setSimConfig(res.data as RuntimeConfig);
    } catch { /* ignore */ }
  }, []);

  const fetchEconomy = useCallback(async () => {
    try {
      const res = await adminApi.getEconomy();
      setEconomySettings(res.data as EconomySettings);
    } catch { /* ignore */ }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await adminApi.getAgents();
      setAgentList(res.data as AgentRow[]);
    } catch { /* ignore */ }
  }, []);

  const fetchAvatarAgents = useCallback(async () => {
    try {
      const res = await agentsApi.list(1, 100);
      if (res.data && Array.isArray(res.data)) {
        setAvatarAgents(res.data as AvatarAgentRow[]);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchProviders = useCallback(async () => {
    try {
      const res = await providersApi.list();
      setProviders(res.data as ProviderRow[]);
    } catch { /* ignore */ }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await adminApi.getUsers();
      setUserList(res.data as typeof userList);
    } catch { /* ignore */ }
  }, []);

  const fetchExportCounts = useCallback(async () => {
    try {
      const res = await adminApi.exportCounts();
      setExportCounts(res.data as Record<string, number>);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void fetchStatus();
    void fetchDecisions();
    void fetchConfig();
    void fetchEconomy();
    void fetchAgents();
    void fetchAvatarAgents();
    void fetchProviders();
    void fetchUsers();
    void fetchResearcherRequests();
    void fetchExportCounts();

    const refetchLight = () => {
      void fetchStatus();
      void fetchDecisions();
    };

    const refetchFull = () => {
      void fetchStatus();
      void fetchDecisions();
      void fetchAgents();
      void fetchEconomy();
      void fetchExportCounts();
    };

    const unsubs = [
      subscribe('tick:start', () => void fetchStatus()),
      subscribe('tick:complete', refetchFull),
      subscribe('agent:vote', refetchLight),
      subscribe('bill:proposed', refetchLight),
      subscribe('campaign:speech', refetchLight),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [fetchStatus, fetchDecisions, fetchConfig, fetchEconomy, fetchAgents, fetchAvatarAgents, fetchProviders, subscribe, fetchUsers, fetchResearcherRequests, fetchExportCounts]);

  const flash = (msg: string) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(null), 3000);
  };

  const handlePause = async () => {
    await adminApi.pause();
    flash('Simulation paused');
    void fetchStatus();
  };

  const handleResume = async () => {
    await adminApi.resume();
    flash('Simulation resumed');
    void fetchStatus();
  };

  const handleTick = async () => {
    await adminApi.tick();
    flash('Manual tick queued');
  };

  const handleReseed = async () => {
    if (!reseedConfirm) {
      setReseedConfirm(true);
      setTimeout(() => setReseedConfirm(false), 5000);
      return;
    }
    setReseedConfirm(false);
    flash('Reseeding database...');
    await adminApi.reseed();
    flash('Database reseeded');
    void fetchStatus();
    void fetchDecisions();
    void fetchAgents();
  };

  const saveConfig = async (patch: Partial<RuntimeConfig>) => {
    if (!simConfig) return;
    setSavingConfig(true);
    try {
      const res = await adminApi.setConfig(patch as Record<string, unknown>);
      setSimConfig(res.data as RuntimeConfig);
      flash('Settings saved');
    } catch {
      flash('Failed to save settings');
    } finally {
      setSavingConfig(false);
    }
  };

  const saveEconomy = async (patch: { treasuryBalance?: number; taxRatePercent?: number }) => {
    setSavingConfig(true);
    try {
      const res = await adminApi.setEconomy(patch);
      setEconomySettings(res.data as EconomySettings);
      flash('Economy settings saved');
    } catch {
      flash('Failed to save economy settings');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleToggleAgent = async (id: string) => {
    await adminApi.toggleAgent(id);
    void fetchAgents();
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setAgentFormLoading(true);
    try {
      await adminApi.createAgent(agentForm);
      flash('Agent created successfully');
      setShowCreateAgent(false);
      setAgentForm({ displayName: '', name: '', alignment: 'moderate', modelProvider: 'anthropic', model: '', bio: '', personality: '', startingBalance: 1000 });
      void fetchAgents();
      void fetchAvatarAgents();
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setAgentFormLoading(false);
    }
  };

  const handleProviderSave = async (name: string) => {
    setProviderSaving(name);
    try {
      const key = providerKeyInputs[name]?.trim();
      const ollamaBaseUrl = providerOllamaInputs[name]?.trim();
      await providersApi.set(name, { key: key || undefined, ollamaBaseUrl: ollamaBaseUrl || undefined });
      flash(`${name} provider saved`);
      setProviderKeyInputs((prev) => ({ ...prev, [name]: '' }));
      void fetchProviders();
    } catch {
      flash(`Failed to save ${name} provider`);
    } finally {
      setProviderSaving(null);
    }
  };

  const handleProviderTest = async (name: string) => {
    setProviderTesting(name);
    try {
      const res = await providersApi.test(name);
      setProviderTestResults((prev) => ({ ...prev, [name]: res.data as { success: boolean; latencyMs: number; error?: string } }));
    } catch {
      setProviderTestResults((prev) => ({ ...prev, [name]: { success: false, latencyMs: 0, error: 'Request failed' } }));
    } finally {
      setProviderTesting(null);
    }
  };

  const handleProviderClear = async (name: string) => {
    try {
      await providersApi.clear(name);
      flash(`${name} key cleared`);
      void fetchProviders();
    } catch {
      flash(`Failed to clear ${name} key`);
    }
  };

  const handleApprove = async (id: string) => {
    await adminApi.approveResearcherRequest(id);
    await fetchResearcherRequests();
  };

  const handleReject = async (id: string) => {
    await adminApi.rejectResearcherRequest(id);
    await fetchResearcherRequests();
  };

  const running = simStatus ? !simStatus.isPaused : false;

  /* ---- Avatar customizer helpers ---- */
  function getDraftConfig(agent: AvatarAgentRow): AvatarConfig {
    if (draftConfigs[agent.id]) return draftConfigs[agent.id];
    if (agent.avatarConfig) {
      try {
        return JSON.parse(agent.avatarConfig) as AvatarConfig;
      } catch { /* fall through */ }
    }
    return proceduralConfig(agent.name);
  }

  function updateDraft(agentId: string, patch: Partial<AvatarConfig>) {
    const current = draftConfigs[agentId] ?? getDraftConfig(avatarAgents.find((a) => a.id === agentId)!);
    setDraftConfigs((prev) => ({ ...prev, [agentId]: { ...current, ...patch } }));
  }

  async function handleSaveAvatar(agentId: string) {
    const config = getDraftConfig(avatarAgents.find((a) => a.id === agentId)!);
    setSavingId(agentId);
    try {
      await agentsApi.customize(agentId, JSON.stringify(config));
      setSaveMessage((prev) => ({ ...prev, [agentId]: 'Saved!' }));
      void fetchAvatarAgents();
      setTimeout(() => setSaveMessage((prev) => ({ ...prev, [agentId]: '' })), 2000);
    } catch {
      setSaveMessage((prev) => ({ ...prev, [agentId]: 'Save failed' }));
      setTimeout(() => setSaveMessage((prev) => ({ ...prev, [agentId]: '' })), 3000);
    } finally {
      setSavingId(null);
    }
  }

  function handleResetAvatar(agent: AvatarAgentRow) {
    const config = proceduralConfig(agent.name);
    setDraftConfigs((prev) => ({ ...prev, [agent.id]: config }));
  }

  const savingBadge = savingConfig ? <span className="text-xs text-text-muted">Saving...</span> : undefined;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-capitol-deep">
      {/* Sidebar */}
      <div
        className={`flex-shrink-0 flex flex-col border-r border-border bg-capitol-deep transition-all duration-200 ${
          sidebarOpen ? 'w-[220px]' : 'w-[56px]'
        }`}
      >
        {/* Toggle button */}
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center h-12 border-b border-border hover:bg-surface/50 transition-colors text-text-muted hover:text-text-primary px-3 gap-2"
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <span className="text-base">{'\u2630'}</span>
          {sidebarOpen && <span className="text-badge text-text-muted uppercase tracking-widest">Admin</span>}
        </button>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-2">
          {SIDEBAR_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const isDisabled = false;
            return (
              <button
                key={tab.id}
                onClick={() => !isDisabled && handleTabChange(tab.id)}
                disabled={isDisabled}
                title={!sidebarOpen ? tab.label : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'border-l-2 border-gold text-gold bg-gold/5'
                    : isDisabled
                    ? 'border-l-2 border-transparent text-text-muted/40 cursor-not-allowed'
                    : 'border-l-2 border-transparent text-text-secondary hover:text-text-primary hover:bg-surface/50'
                }`}
              >
                <span className="text-base flex-shrink-0">{tab.icon}</span>
                {sidebarOpen && (
                  <span className="flex-1 text-left truncate">{tab.label}</span>
                )}
                {sidebarOpen && tab.id === 'access' && pendingCount > 0 && (
                  <span className="flex-shrink-0 min-w-[20px] h-5 rounded-full bg-gold text-capitol-deep text-xs font-bold flex items-center justify-center px-1">
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Action feedback */}
        {actionMsg && (
          <div className="px-4 py-2 rounded bg-gold/10 border border-gold/30 text-gold text-sm mb-6">
            {actionMsg}
          </div>
        )}

        {activeTab === 'overview' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-lg border border-border bg-surface p-4 space-y-1">
              <p className="text-badge text-text-muted uppercase tracking-widest">Simulation</p>
              <p className="font-serif text-lg text-stone">{simStatus?.isPaused ? 'Paused' : 'Running'}</p>
              <p className="text-sm text-text-muted">{simStatus?.waiting ?? 0} waiting / {simStatus?.active ?? 0} active</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4 space-y-1">
              <p className="text-badge text-text-muted uppercase tracking-widest">Agents</p>
              <p className="font-serif text-lg text-stone">{agentList.length} total</p>
              <p className="text-sm text-text-muted">{agentList.filter(a => a.isActive).length} active</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4 space-y-1">
              <p className="text-badge text-text-muted uppercase tracking-widest">Queue</p>
              <p className="font-serif text-lg text-stone">{(simStatus?.waiting ?? 0) + (simStatus?.active ?? 0)} jobs</p>
              <p className="text-sm text-text-muted">{simStatus?.failed ?? 0} failed</p>
            </div>
            <div
              className="rounded-lg border border-border bg-surface p-4 space-y-1 cursor-pointer hover:border-gold/30 transition-colors"
              onClick={() => handleTabChange('access')}
            >
              <p className="text-badge text-text-muted uppercase tracking-widest">Access Requests</p>
              <p className="font-serif text-lg text-stone">{pendingCount} pending</p>
            </div>
          </div>
        )}

        {activeTab === 'simulation' && (
          <div className="space-y-6">
            {/* Simulation Controls */}
            <CollapsibleSection id="simulation_controls" title="Simulation Controls">
              <div className="flex flex-wrap gap-3">
                <AdminButton onClick={handlePause} disabled={!running} variant="default">
                  Pause
                </AdminButton>
                <AdminButton onClick={handleResume} disabled={running} variant="gold">
                  Resume
                </AdminButton>
                <AdminButton onClick={handleTick} variant="default">
                  Manual Tick
                </AdminButton>
              </div>
              {simStatus && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
                  {[
                    { label: 'Waiting', value: simStatus.waiting },
                    { label: 'Active', value: simStatus.active },
                    { label: 'Completed', value: simStatus.completed },
                    { label: 'Failed', value: simStatus.failed },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-white/5 rounded p-3">
                      <div className="text-xs text-text-muted uppercase tracking-wide">{label}</div>
                      <div className="text-xl font-semibold text-text-primary mt-1">{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </CollapsibleSection>

            {/* Simulation Settings */}
            {simConfig && (
              <CollapsibleSection id="simulation_settings" title="Simulation Settings" badge={savingBadge}>
                {/* Tick interval */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">Tick Interval</label>
                    <span className="text-sm text-gold font-mono">{msToLabel(simConfig.tickIntervalMs)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {TICK_PRESETS.map(({ label, ms }) => (
                      <button
                        key={ms}
                        onClick={() => void saveConfig({ tickIntervalMs: ms })}
                        className={`px-3 py-1.5 rounded text-xs font-medium border transition-all ${
                          simConfig.tickIntervalMs === ms
                            ? 'bg-gold/20 text-gold border-gold/40'
                            : 'bg-white/5 text-text-muted border-border hover:bg-white/10'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-text-muted">How often agents vote, propose bills, and campaign.</p>
                </div>

                {/* Bill advancement delay */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">Bill Advancement Delay</label>
                    <span className="text-sm text-gold font-mono">{msToLabel(simConfig.billAdvancementDelayMs)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ADVANCEMENT_PRESETS.map(({ label, ms }) => (
                      <button
                        key={ms}
                        onClick={() => void saveConfig({ billAdvancementDelayMs: ms })}
                        className={`px-3 py-1.5 rounded text-xs font-medium border transition-all ${
                          simConfig.billAdvancementDelayMs === ms
                            ? 'bg-gold/20 text-gold border-gold/40'
                            : 'bg-white/5 text-text-muted border-border hover:bg-white/10'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-text-muted">Time bills wait in proposed/committee before advancing to next stage.</p>
                </div>

                {/* Probability sliders */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Bill Proposal Chance</label>
                      <span className="text-sm text-gold font-mono">{Math.round(simConfig.billProposalChance * 100)}%</span>
                    </div>
                    <input
                      type="range" min={0} max={100}
                      value={Math.round(simConfig.billProposalChance * 100)}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, billProposalChance: parseInt(e.target.value) / 100 } : c)}
                      onMouseUp={() => void saveConfig({ billProposalChance: simConfig.billProposalChance })}
                      onTouchEnd={() => void saveConfig({ billProposalChance: simConfig.billProposalChance })}
                      className="w-full accent-gold"
                    />
                    <p className="text-xs text-text-muted">Per-agent chance to propose a bill each tick.</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Campaign Speech Chance</label>
                      <span className="text-sm text-gold font-mono">{Math.round(simConfig.campaignSpeechChance * 100)}%</span>
                    </div>
                    <input
                      type="range" min={0} max={100}
                      value={Math.round(simConfig.campaignSpeechChance * 100)}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, campaignSpeechChance: parseInt(e.target.value) / 100 } : c)}
                      onMouseUp={() => void saveConfig({ campaignSpeechChance: simConfig.campaignSpeechChance })}
                      onTouchEnd={() => void saveConfig({ campaignSpeechChance: simConfig.campaignSpeechChance })}
                      className="w-full accent-gold"
                    />
                    <p className="text-xs text-text-muted">Per-campaign chance to make a speech each tick.</p>
                  </div>
                </div>

                {/* AI Provider Override */}
                <div className="space-y-2">
                  <label className="text-sm font-medium text-text-secondary">AI Provider Override</label>
                  <div className="flex flex-wrap gap-2">
                    {(['default', 'anthropic', 'openai', 'google', 'huggingface', 'ollama'] as const).map((opt) => (
                      <button
                        key={opt}
                        onClick={() => void saveConfig({ providerOverride: opt })}
                        className={`px-3 py-1.5 rounded text-xs font-medium border transition-all capitalize ${
                          simConfig.providerOverride === opt
                            ? 'bg-gold/20 text-gold border-gold/40'
                            : 'bg-white/5 text-text-muted border-border hover:bg-white/10'
                        }`}
                      >
                        {opt === 'default' ? 'Per-agent default' : opt}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-text-muted">
                    Override which AI provider all agents use. Default respects each agent's configured provider.
                  </p>
                </div>

                {/* Amendment Proposal Chance */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-secondary">Amendment Proposal Chance</label>
                    <span className="text-sm text-gold font-mono">{Math.round(simConfig.amendmentProposalChance * 100)}%</span>
                  </div>
                  <input
                    type="range" min={0} max={100}
                    value={Math.round(simConfig.amendmentProposalChance * 100)}
                    onChange={(e) => setSimConfig((c) => c ? { ...c, amendmentProposalChance: parseInt(e.target.value) / 100 } : c)}
                    onMouseUp={() => void saveConfig({ amendmentProposalChance: simConfig.amendmentProposalChance })}
                    onTouchEnd={() => void saveConfig({ amendmentProposalChance: simConfig.amendmentProposalChance })}
                    className="w-full accent-gold"
                  />
                  <p className="text-xs text-text-muted">Per-agent chance to propose an amendment to an existing law each tick.</p>
                </div>

                {/* Guard Rails sub-section */}
                <div className="border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Guard Rails</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Max Prompt Length (chars)</label>
                        <span className="text-sm text-gold font-mono">{simConfig.maxPromptLengthChars.toLocaleString()}</span>
                      </div>
                      <input type="number" min={500} max={32000} step={500}
                        value={simConfig.maxPromptLengthChars}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, maxPromptLengthChars: parseInt(e.target.value) || 4000 } : c)}
                        onBlur={() => void saveConfig({ maxPromptLengthChars: simConfig.maxPromptLengthChars })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Maximum characters sent to AI per request.</p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Max Output Tokens</label>
                        <span className="text-sm text-gold font-mono">{simConfig.maxOutputLengthTokens}</span>
                      </div>
                      <input type="number" min={50} max={4000} step={50}
                        value={simConfig.maxOutputLengthTokens}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, maxOutputLengthTokens: parseInt(e.target.value) || 500 } : c)}
                        onBlur={() => void saveConfig({ maxOutputLengthTokens: simConfig.maxOutputLengthTokens })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Maximum tokens each AI response can use.</p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Max Bills Per Agent Per Tick</label>
                        <span className="text-sm text-gold font-mono">{simConfig.maxBillsPerAgentPerTick}</span>
                      </div>
                      <input type="number" min={1} max={20}
                        value={simConfig.maxBillsPerAgentPerTick}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, maxBillsPerAgentPerTick: parseInt(e.target.value) || 1 } : c)}
                        onBlur={() => void saveConfig({ maxBillsPerAgentPerTick: simConfig.maxBillsPerAgentPerTick })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Maximum bill proposals per agent per tick.</p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">Max Campaign Speeches Per Tick</label>
                        <span className="text-sm text-gold font-mono">{simConfig.maxCampaignSpeechesPerTick}</span>
                      </div>
                      <input type="number" min={1} max={20}
                        value={simConfig.maxCampaignSpeechesPerTick}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, maxCampaignSpeechesPerTick: parseInt(e.target.value) || 1 } : c)}
                        onBlur={() => void saveConfig({ maxCampaignSpeechesPerTick: simConfig.maxCampaignSpeechesPerTick })}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                      <p className="text-xs text-text-muted">Maximum campaign speeches per agent per tick.</p>
                    </div>
                  </div>
                </div>
              </CollapsibleSection>
            )}

            {/* Economy */}
            <CollapsibleSection
              id="economy"
              title="Economy"
              subtitle="Treasury & tax rate persist in DB. Fees & salaries apply next tick."
              badge={savingBadge}
            >
              {economySettings && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Treasury Balance (M$)</label>
                      <span className="text-sm text-gold font-mono">M${economySettings.treasuryBalance.toLocaleString()}</span>
                    </div>
                    <input
                      type="number" min={0} step={1000}
                      value={economySettings.treasuryBalance}
                      onChange={(e) => setEconomySettings((s) => s ? { ...s, treasuryBalance: parseInt(e.target.value) || 0 } : s)}
                      onBlur={() => void saveEconomy({ treasuryBalance: economySettings.treasuryBalance })}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                    />
                    <p className="text-xs text-text-muted">Direct treasury balance -- use to inject or remove funds.</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Tax Rate (%)</label>
                      <span className="text-sm text-gold font-mono">{economySettings.taxRatePercent}%</span>
                    </div>
                    <input type="range" min={0} max={20} step={0.5}
                      value={economySettings.taxRatePercent}
                      onChange={(e) => setEconomySettings((s) => s ? { ...s, taxRatePercent: parseFloat(e.target.value) } : s)}
                      onMouseUp={() => void saveEconomy({ taxRatePercent: economySettings.taxRatePercent })}
                      onTouchEnd={() => void saveEconomy({ taxRatePercent: economySettings.taxRatePercent })}
                      className="w-full accent-gold" />
                    <p className="text-xs text-text-muted">Percent of each agent's balance collected as tax each tick.</p>
                  </div>
                </div>
              )}

              {simConfig && (
                <>
                  <div className="border-t border-border pt-4">
                    <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Fees</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      {([
                        ['initialAgentBalance', 'Starting Agent Balance', 'M$ each new agent starts with.'],
                        ['campaignFilingFee', 'Campaign Filing Fee', 'M$ to declare candidacy.'],
                        ['partyCreationFee', 'Party Creation Fee', 'M$ to found a new party.'],
                      ] as [keyof RuntimeConfig, string, string][]).map(([key, label, desc]) => (
                        <div key={key} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-text-secondary">{label}</label>
                            <span className="text-sm text-gold font-mono">M${(simConfig[key] as number).toLocaleString()}</span>
                          </div>
                          <input type="number" min={0} step={10}
                            value={simConfig[key] as number}
                            onChange={(e) => setSimConfig((c) => c ? { ...c, [key]: parseInt(e.target.value) || 0 } : c)}
                            onBlur={() => void saveConfig({ [key]: simConfig[key] })}
                            className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                          />
                          <p className="text-xs text-text-muted">{desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-border pt-4">
                    <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-4">Salaries (M$/tick)</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      {([
                        ['salaryPresident', 'President'],
                        ['salaryCabinet', 'Cabinet'],
                        ['salaryCongress', 'Congress'],
                        ['salaryJustice', 'Justice'],
                      ] as [keyof RuntimeConfig, string][]).map(([key, label]) => (
                        <div key={key} className="space-y-1.5">
                          <label className="text-xs font-medium text-text-secondary">{label}</label>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-text-muted">M$</span>
                            <input type="number" min={0} step={5}
                              value={simConfig[key] as number}
                              onChange={(e) => setSimConfig((c) => c ? { ...c, [key]: parseInt(e.target.value) || 0 } : c)}
                              onBlur={() => void saveConfig({ [key]: simConfig[key] })}
                              className="w-full bg-white/5 border border-border rounded px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CollapsibleSection>

            {/* Governance Probabilities */}
            {simConfig && (
              <CollapsibleSection
                id="governance_probabilities"
                title="Governance Probabilities"
                subtitle="Research-backed baselines. Changes apply on the next tick."
              >
                {/* Presidential Veto */}
                <div className="space-y-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide">Presidential Veto</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    {([
                      ['vetoBaseRate', 'Base Veto Rate', 'Probability of veto when president and sponsor share alignment.'],
                      ['vetoRatePerTier', 'Rate Per Alignment Tier', 'Added probability per step apart on the alignment spectrum.'],
                      ['vetoMaxRate', 'Maximum Veto Rate', 'Hard cap -- probability never exceeds this regardless of alignment gap.'],
                    ] as [keyof RuntimeConfig, string, string][]).map(([key, label, desc]) => (
                      <div key={key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-text-secondary">{label}</label>
                          <span className="text-sm text-gold font-mono">{Math.round((simConfig[key] as number) * 100)}%</span>
                        </div>
                        <input type="range" min={0} max={100}
                          value={Math.round((simConfig[key] as number) * 100)}
                          onChange={(e) => setSimConfig((c) => c ? { ...c, [key]: parseInt(e.target.value) / 100 } : c)}
                          onMouseUp={() => void saveConfig({ [key]: simConfig[key] })}
                          onTouchEnd={() => void saveConfig({ [key]: simConfig[key] })}
                          className="w-full accent-gold" />
                        <p className="text-xs text-text-muted">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Committee */}
                <div className="space-y-4 border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide">Committee Review</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    {([
                      ['committeeTableRateOpposing', 'Table Rate (Opposing Chair)', 'Probability chair tables a bill when politically opposed to sponsor.'],
                      ['committeeTableRateNeutral', 'Table Rate (Neutral Chair)', 'Probability chair tables a bill when aligned with or neutral to sponsor.'],
                      ['committeeAmendRate', 'Amendment Rate', 'If not tabled, probability chair amends the bill text.'],
                    ] as [keyof RuntimeConfig, string, string][]).map(([key, label, desc]) => (
                      <div key={key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-text-secondary">{label}</label>
                          <span className="text-sm text-gold font-mono">{Math.round((simConfig[key] as number) * 100)}%</span>
                        </div>
                        <input type="range" min={0} max={100}
                          value={Math.round((simConfig[key] as number) * 100)}
                          onChange={(e) => setSimConfig((c) => c ? { ...c, [key]: parseInt(e.target.value) / 100 } : c)}
                          onMouseUp={() => void saveConfig({ [key]: simConfig[key] })}
                          onTouchEnd={() => void saveConfig({ [key]: simConfig[key] })}
                          className="w-full accent-gold" />
                        <p className="text-xs text-text-muted">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Judicial + Whip + Override */}
                <div className="space-y-4 border-t border-border pt-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide">Judicial, Whip &amp; Override</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    {([
                      ['judicialChallengeRatePerLaw', 'Judicial Challenge Rate', 'Per-law probability of a Supreme Court review being triggered each tick.'],
                      ['partyWhipFollowRate', 'Party Whip Follow Rate', 'Probability a member follows their party whip recommendation when voting.'],
                      ['vetoOverrideThreshold', 'Veto Override Threshold', 'Yea fraction required to override a presidential veto (e.g. 0.67 = 2/3).'],
                    ] as [keyof RuntimeConfig, string, string][]).map(([key, label, desc]) => (
                      <div key={key} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-sm font-medium text-text-secondary">{label}</label>
                          <span className="text-sm text-gold font-mono">{Math.round((simConfig[key] as number) * 100)}%</span>
                        </div>
                        <input type="range" min={0} max={100}
                          value={Math.round((simConfig[key] as number) * 100)}
                          onChange={(e) => setSimConfig((c) => c ? { ...c, [key]: parseInt(e.target.value) / 100 } : c)}
                          onMouseUp={() => void saveConfig({ [key]: simConfig[key] })}
                          onTouchEnd={() => void saveConfig({ [key]: simConfig[key] })}
                          className="w-full accent-gold" />
                        <p className="text-xs text-text-muted">{desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </CollapsibleSection>
            )}
          </div>
        )}

        {activeTab === 'government' && (
          <div className="space-y-6">
            {/* Government Structure */}
            {simConfig && (
              <CollapsibleSection
                id="government_structure"
                title="Government Structure"
                subtitle="Takes effect on next election cycle or term start"
                badge={savingBadge}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {/* Congress Seats */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Congress Seats</label>
                      <span className="text-sm text-gold font-mono">{simConfig.congressSeats}</span>
                    </div>
                    <input type="range" min={1} max={200} value={simConfig.congressSeats}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, congressSeats: parseInt(e.target.value) } : c)}
                      onMouseUp={() => void saveConfig({ congressSeats: simConfig.congressSeats })}
                      onTouchEnd={() => void saveConfig({ congressSeats: simConfig.congressSeats })}
                      className="w-full accent-gold" />
                    <p className="text-xs text-text-muted">Total legislative seats.</p>
                  </div>

                  {/* Supreme Court Justices */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Supreme Court Justices</label>
                      <span className="text-sm text-gold font-mono">{simConfig.supremeCourtJustices}</span>
                    </div>
                    <input type="range" min={1} max={25} value={simConfig.supremeCourtJustices}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, supremeCourtJustices: parseInt(e.target.value) } : c)}
                      onMouseUp={() => void saveConfig({ supremeCourtJustices: simConfig.supremeCourtJustices })}
                      onTouchEnd={() => void saveConfig({ supremeCourtJustices: simConfig.supremeCourtJustices })}
                      className="w-full accent-gold" />
                    <p className="text-xs text-text-muted">Number of justices on the high court.</p>
                  </div>

                  {/* Congress Term Days */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Congress Term Length</label>
                      <span className="text-sm text-gold font-mono">{simConfig.congressTermDays}d</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[30, 60, 90, 180, 365].map((d) => (
                        <button key={d} onClick={() => void saveConfig({ congressTermDays: d })}
                          className={`px-3 py-1.5 rounded text-xs font-medium border transition-all ${simConfig.congressTermDays === d ? 'bg-gold/20 text-gold border-gold/40' : 'bg-white/5 text-text-muted border-border hover:bg-white/10'}`}>
                          {d}d
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* President Term Days */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">President Term Length</label>
                      <span className="text-sm text-gold font-mono">{simConfig.presidentTermDays}d</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[30, 60, 90, 180, 365].map((d) => (
                        <button key={d} onClick={() => void saveConfig({ presidentTermDays: d })}
                          className={`px-3 py-1.5 rounded text-xs font-medium border transition-all ${simConfig.presidentTermDays === d ? 'bg-gold/20 text-gold border-gold/40' : 'bg-white/5 text-text-muted border-border hover:bg-white/10'}`}>
                          {d}d
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Vote thresholds */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                  {([
                    ['quorumPercentage', 'Quorum Required', 'Minimum participation to hold a floor vote.'],
                    ['billPassagePercentage', 'Bill Passage Threshold', 'Yea votes required to pass a bill.'],
                    ['supermajorityPercentage', 'Supermajority (Veto Override)', 'Yea votes required to override a presidential veto.'],
                  ] as [keyof RuntimeConfig, string, string][]).map(([key, label, desc]) => (
                    <div key={key} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-text-secondary">{label}</label>
                        <span className="text-sm text-gold font-mono">{Math.round((simConfig[key] as number) * 100)}%</span>
                      </div>
                      <input type="range" min={10} max={90} value={Math.round((simConfig[key] as number) * 100)}
                        onChange={(e) => setSimConfig((c) => c ? { ...c, [key]: parseInt(e.target.value) / 100 } : c)}
                        onMouseUp={() => void saveConfig({ [key]: simConfig[key] })}
                        onTouchEnd={() => void saveConfig({ [key]: simConfig[key] })}
                        className="w-full accent-gold" />
                      <p className="text-xs text-text-muted">{desc}</p>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Elections */}
            {simConfig && (
              <CollapsibleSection id="elections" title="Elections">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Campaign Duration</label>
                      <span className="text-sm text-gold font-mono">{simConfig.campaignDurationDays}d</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[7, 14, 30, 60].map((d) => (
                        <button key={d} onClick={() => void saveConfig({ campaignDurationDays: d })}
                          className={`px-3 py-1.5 rounded text-xs font-medium border transition-all ${simConfig.campaignDurationDays === d ? 'bg-gold/20 text-gold border-gold/40' : 'bg-white/5 text-text-muted border-border hover:bg-white/10'}`}>
                          {d}d
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Voting Window</label>
                      <span className="text-sm text-gold font-mono">{simConfig.votingDurationHours}h</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[12, 24, 48, 72, 168].map((h) => (
                        <button key={h} onClick={() => void saveConfig({ votingDurationHours: h })}
                          className={`px-3 py-1.5 rounded text-xs font-medium border transition-all ${simConfig.votingDurationHours === h ? 'bg-gold/20 text-gold border-gold/40' : 'bg-white/5 text-text-muted border-border hover:bg-white/10'}`}>
                          {h}h
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Min Reputation to Run</label>
                      <span className="text-sm text-gold font-mono">{simConfig.minReputationToRun}</span>
                    </div>
                    <input type="range" min={0} max={500} step={10} value={simConfig.minReputationToRun}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, minReputationToRun: parseInt(e.target.value) } : c)}
                      onMouseUp={() => void saveConfig({ minReputationToRun: simConfig.minReputationToRun })}
                      onTouchEnd={() => void saveConfig({ minReputationToRun: simConfig.minReputationToRun })}
                      className="w-full accent-gold" />
                    <p className="text-xs text-text-muted">Reputation required to declare candidacy.</p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-text-secondary">Min Reputation to Vote</label>
                      <span className="text-sm text-gold font-mono">{simConfig.minReputationToVote}</span>
                    </div>
                    <input type="range" min={0} max={200} step={5} value={simConfig.minReputationToVote}
                      onChange={(e) => setSimConfig((c) => c ? { ...c, minReputationToVote: parseInt(e.target.value) } : c)}
                      onMouseUp={() => void saveConfig({ minReputationToVote: simConfig.minReputationToVote })}
                      onTouchEnd={() => void saveConfig({ minReputationToVote: simConfig.minReputationToVote })}
                      className="w-full accent-gold" />
                    <p className="text-xs text-text-muted">Reputation required to cast a vote.</p>
                  </div>
                </div>
              </CollapsibleSection>
            )}
          </div>
        )}

        {activeTab === 'agents' && (
          <div className="space-y-6">
            {/* Agents */}
            <CollapsibleSection id="agents" title="Agents">
              <div className="flex justify-end mb-2">
                <button
                  onClick={() => setShowCreateAgent(!showCreateAgent)}
                  className="text-xs px-3 py-1.5 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30 transition-all"
                >
                  {showCreateAgent ? 'Cancel' : 'Create New Agent'}
                </button>
              </div>

              {showCreateAgent && (
                <form onSubmit={(e) => void handleCreateAgent(e)} className="space-y-4 border border-border rounded p-4 mb-4">
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide">New Agent</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Display Name</label>
                      <input type="text" value={agentForm.displayName}
                        onChange={(e) => setAgentForm((f) => ({ ...f, displayName: e.target.value }))}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                        placeholder="Jane Doe" required />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Username slug</label>
                      <input type="text" value={agentForm.name}
                        onChange={(e) => setAgentForm((f) => ({ ...f, name: e.target.value }))}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                        placeholder="jane_doe" required />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Alignment</label>
                      <select value={agentForm.alignment}
                        onChange={(e) => setAgentForm((f) => ({ ...f, alignment: e.target.value }))}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50">
                        {ALIGNMENTS.map((a) => <option key={a} value={a} className="bg-surface">{a}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Provider</label>
                      <select value={agentForm.modelProvider}
                        onChange={(e) => setAgentForm((f) => ({ ...f, modelProvider: e.target.value }))}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50">
                        {AI_PROVIDERS.map((p) => <option key={p} value={p} className="bg-surface">{p}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Model (optional)</label>
                      <input type="text" value={agentForm.model}
                        onChange={(e) => setAgentForm((f) => ({ ...f, model: e.target.value }))}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                        placeholder="e.g. claude-haiku-4-5-20251001" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">Starting Balance (M$)</label>
                      <input type="number" min={0} step={100} value={agentForm.startingBalance}
                        onChange={(e) => setAgentForm((f) => ({ ...f, startingBalance: parseInt(e.target.value) || 0 }))}
                        className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-secondary mb-1">Personality</label>
                    <textarea value={agentForm.personality}
                      onChange={(e) => setAgentForm((f) => ({ ...f, personality: e.target.value }))}
                      className="w-full bg-white/5 border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      rows={2} placeholder="How this agent thinks and acts..." />
                  </div>
                  <button type="submit" disabled={agentFormLoading}
                    className="px-6 py-2 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30 text-sm font-medium transition-all disabled:opacity-40">
                    {agentFormLoading ? 'Creating...' : 'Create Agent'}
                  </button>
                </form>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      {['Agent', 'Alignment', 'Provider', 'Reputation', 'Balance', 'Status', ''].map((h) => (
                        <th key={h} className="pb-2 pr-4 text-xs font-medium text-text-muted uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {agentList.map((agent) => (
                      <tr key={agent.id} className={`hover:bg-white/[0.02] ${!agent.isActive ? 'opacity-50' : ''}`}>
                        <td className="py-2 pr-4 text-text-primary font-medium whitespace-nowrap">
                          {agent.displayName}
                        </td>
                        <td className="py-2 pr-4 text-text-secondary text-xs whitespace-nowrap">
                          {agent.alignment}
                        </td>
                        <td className="py-2 pr-4">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            agent.modelProvider === 'anthropic'
                              ? 'bg-purple-900/40 text-purple-300'
                              : agent.modelProvider === 'openai'
                              ? 'bg-green-900/40 text-green-300'
                              : agent.modelProvider === 'google'
                              ? 'bg-blue-900/40 text-blue-300'
                              : 'bg-gray-900/40 text-gray-300'
                          }`}>
                            {agent.modelProvider}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-text-secondary text-xs">{agent.reputation}</td>
                        <td className="py-2 pr-4 text-text-secondary text-xs">M${agent.balance.toLocaleString()}</td>
                        <td className="py-2 pr-4">
                          <StatusBadge ok={agent.isActive} label={agent.isActive ? 'Active' : 'Inactive'} />
                        </td>
                        <td className="py-2">
                          <button
                            onClick={() => void handleToggleAgent(agent.id)}
                            className={`text-xs px-2 py-1 rounded border transition-all ${
                              agent.isActive
                                ? 'text-red-400 border-red-800 hover:bg-red-900/30'
                                : 'text-green-400 border-green-800 hover:bg-green-900/30'
                            }`}
                          >
                            {agent.isActive ? 'Disable' : 'Enable'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>

            {/* Decision Stats */}
            {decisionStats && (
              <CollapsibleSection id="decision_stats" title="Decision Stats">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: 'Total Decisions', value: decisionStats.total },
                    { label: 'Errors', value: decisionStats.errors, warn: decisionStats.errors > 0 },
                    { label: 'Anthropic', value: decisionStats.haikuCount },
                    { label: 'Ollama', value: decisionStats.ollamaCount },
                  ].map(({ label, value, warn }) => (
                    <div key={label} className="bg-white/5 rounded p-3">
                      <div className="text-xs text-text-muted uppercase tracking-wide">{label}</div>
                      <div className={`text-xl font-semibold mt-1 ${warn ? 'text-red-400' : 'text-text-primary'}`}>
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Agent Avatars */}
            <CollapsibleSection id="agent_avatars" title="Agent Avatars" subtitle="Customize pixel portrait configurations">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 items-start">
                {avatarAgents.map((agent) => {
                  const isEditing = editingAgentId === agent.id;
                  const cfg = getDraftConfig(agent);

                  return (
                    <div key={agent.id} className="flex flex-col gap-0">
                      {/* Agent card */}
                      <div className="bg-white/5 rounded border border-border p-3 flex flex-col items-center gap-2">
                        <PixelAvatar config={cfg} seed={agent.name} size="md" />
                        <div className="text-sm font-medium text-center truncate w-full">{agent.displayName}</div>
                        <button
                          className="btn-secondary text-xs w-full"
                          onClick={() => setEditingAgentId(isEditing ? null : agent.id)}
                        >
                          {isEditing ? 'Close' : 'Edit'}
                        </button>
                      </div>

                      {/* Inline editor panel */}
                      {isEditing && (
                        <div className="border border-border border-t-0 bg-surface rounded-b p-4 space-y-4">
                          <div className="flex justify-center">
                            <PixelAvatar config={cfg} seed={agent.name} size="lg" />
                          </div>

                          <div className="space-y-2">
                            {([
                              ['Background', 'bgColor', cfg.bgColor],
                              ['Face', 'faceColor', cfg.faceColor],
                              ['Accent', 'accentColor', cfg.accentColor],
                            ] as [string, keyof AvatarConfig, string][]).map(([label, key, value]) => (
                              <div key={key} className="flex items-center justify-between gap-2">
                                <label className="text-xs text-text-secondary">{label}</label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="color"
                                    value={value}
                                    onChange={(e) => updateDraft(agent.id, { [key]: e.target.value })}
                                    className="w-6 h-6 rounded cursor-pointer border border-border bg-transparent"
                                  />
                                  <span className="font-mono text-xs text-text-muted">{value}</span>
                                </div>
                              </div>
                            ))}
                          </div>

                          <div>
                            <div className="text-xs text-text-muted mb-2 uppercase tracking-wide">Eyes</div>
                            <div className="grid grid-cols-4 gap-1">
                              {(['square', 'wide', 'dot', 'visor'] as AvatarConfig['eyeType'][]).map((et) => (
                                <button
                                  key={et}
                                  onClick={() => updateDraft(agent.id, { eyeType: et })}
                                  className={`flex flex-col items-center gap-1 p-1 rounded border transition-all ${
                                    cfg.eyeType === et ? 'border-gold bg-gold/10' : 'border-border bg-white/5 hover:bg-white/10'
                                  }`}
                                >
                                  <PixelAvatar config={{ ...cfg, eyeType: et }} seed={agent.name} size="xs" />
                                  <span className="text-[9px] text-text-muted">{et}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-text-muted mb-2 uppercase tracking-wide">Mouth</div>
                            <div className="grid grid-cols-4 gap-1">
                              {(['smile', 'stern', 'speak', 'grin'] as AvatarConfig['mouthType'][]).map((mt) => (
                                <button
                                  key={mt}
                                  onClick={() => updateDraft(agent.id, { mouthType: mt })}
                                  className={`flex flex-col items-center gap-1 p-1 rounded border transition-all ${
                                    cfg.mouthType === mt ? 'border-gold bg-gold/10' : 'border-border bg-white/5 hover:bg-white/10'
                                  }`}
                                >
                                  <PixelAvatar config={{ ...cfg, mouthType: mt }} seed={agent.name} size="xs" />
                                  <span className="text-[9px] text-text-muted">{mt}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <div className="text-xs text-text-muted mb-2 uppercase tracking-wide">Accessory</div>
                            <div className="grid grid-cols-4 gap-1">
                              {(['none', 'antenna', 'dual_antenna', 'halo'] as AvatarConfig['accessory'][]).map((acc) => (
                                <button
                                  key={acc}
                                  onClick={() => updateDraft(agent.id, { accessory: acc })}
                                  className={`flex flex-col items-center gap-1 p-1 rounded border transition-all ${
                                    cfg.accessory === acc ? 'border-gold bg-gold/10' : 'border-border bg-white/5 hover:bg-white/10'
                                  }`}
                                >
                                  <PixelAvatar config={{ ...cfg, accessory: acc }} seed={agent.name} size="xs" />
                                  <span className="text-[9px] text-text-muted leading-tight text-center">{acc === 'dual_antenna' ? 'dual' : acc}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="flex flex-col gap-2">
                            <button
                              className="btn-secondary text-xs w-full bg-gold/10 text-gold border-gold/30 hover:bg-gold/20"
                              onClick={() => void handleSaveAvatar(agent.id)}
                              disabled={savingId === agent.id}
                            >
                              {savingId === agent.id ? 'Saving...' : 'Save'}
                            </button>
                            <button className="btn-secondary text-xs w-full" onClick={() => handleResetAvatar(agent)}>
                              Reset to Procedural
                            </button>
                            <button className="btn-secondary text-xs w-full text-text-muted" onClick={() => setEditingAgentId(null)}>
                              Cancel
                            </button>
                            {saveMessage[agent.id] && (
                              <div className={`text-xs text-center ${saveMessage[agent.id] === 'Saved!' ? 'text-green-400' : 'text-red-400'}`}>
                                {saveMessage[agent.id]}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>

            {/* Decision Log */}
            <CollapsibleSection id="decision_log" title="Decision Log">
              {loading ? (
                <p className="text-text-muted text-sm">Loading...</p>
              ) : decisions.length === 0 ? (
                <p className="text-text-muted text-sm">No decisions yet -- simulation hasn't run.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        {['Agent', 'Provider', 'Phase', 'Action', 'Status', 'Latency', 'Reasoning'].map((h) => (
                          <th key={h} className="pb-2 pr-4 text-xs font-medium text-text-muted uppercase tracking-wide">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {decisions.map((d) => (
                        <tr key={d.id} className="hover:bg-white/[0.02]">
                          <td className="py-2 pr-4 text-text-primary font-medium whitespace-nowrap">
                            {d.agentName ?? '\u2014'}
                          </td>
                          <td className="py-2 pr-4">
                            <span className="text-xs px-1.5 py-0.5 rounded bg-purple-900/40 text-purple-300">
                              {d.provider}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-text-secondary text-xs whitespace-nowrap">
                            {d.phase ?? '\u2014'}
                          </td>
                          <td className="py-2 pr-4 text-text-secondary text-xs whitespace-nowrap">
                            {d.parsedAction ?? '\u2014'}
                          </td>
                          <td className="py-2 pr-4">
                            <span className={`text-xs ${d.success ? 'text-green-400' : 'text-red-400'}`}>
                              {d.success ? 'ok' : 'err'}
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-text-muted text-xs whitespace-nowrap">
                            {d.latencyMs}ms
                          </td>
                          <td className="py-2 text-text-secondary text-xs max-w-xs truncate" title={d.parsedReasoning ?? ''}>
                            {d.parsedReasoning ?? '\u2014'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CollapsibleSection>
          </div>
        )}

        {activeTab === 'providers' && (
          <div className="space-y-6">
            {/* AI Providers */}
            <CollapsibleSection id="api_providers" title="AI Providers" subtitle="Configure API keys for each provider. Keys are AES-256 encrypted at rest.">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {providers.map((p) => {
                  const testResult = providerTestResults[p.providerName];
                  return (
                    <div key={p.providerName} className="bg-white/5 rounded border border-border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text-primary capitalize">{p.providerName}</span>
                          {p.isConfigured ? (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-green-900/40 text-green-400">Configured</span>
                          ) : (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-white/10 text-text-muted">Not set</span>
                          )}
                        </div>
                        {p.maskedKey && <span className="text-xs font-mono text-text-muted">{p.maskedKey}</span>}
                      </div>

                      {p.providerName !== 'ollama' && (
                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={providerKeyInputs[p.providerName] ?? ''}
                            onChange={(e) => setProviderKeyInputs((prev) => ({ ...prev, [p.providerName]: e.target.value }))}
                            className="flex-1 bg-white/5 border border-border rounded px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                            placeholder={p.isConfigured ? 'Replace key...' : 'Enter API key...'}
                          />
                        </div>
                      )}

                      {p.providerName === 'ollama' && (
                        <div>
                          <input
                            type="text"
                            value={providerOllamaInputs[p.providerName] ?? (p.ollamaBaseUrl ?? '')}
                            onChange={(e) => setProviderOllamaInputs((prev) => ({ ...prev, [p.providerName]: e.target.value }))}
                            className="w-full bg-white/5 border border-border rounded px-2 py-1.5 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                            placeholder="http://localhost:11434"
                          />
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={() => void handleProviderSave(p.providerName)}
                          disabled={providerSaving === p.providerName}
                          className="px-3 py-1.5 rounded bg-gold/20 text-gold border border-gold/40 hover:bg-gold/30 text-xs font-medium transition-all disabled:opacity-40"
                        >
                          {providerSaving === p.providerName ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => void handleProviderTest(p.providerName)}
                          disabled={providerTesting === p.providerName}
                          className="px-3 py-1.5 rounded bg-white/5 border border-border text-text-muted hover:bg-white/10 text-xs font-medium transition-all disabled:opacity-40"
                        >
                          {providerTesting === p.providerName ? 'Testing...' : 'Test'}
                        </button>
                        {p.isConfigured && (
                          <button
                            onClick={() => void handleProviderClear(p.providerName)}
                            className="px-3 py-1.5 rounded border border-red-800 text-red-400 hover:bg-red-900/30 text-xs transition-all"
                          >
                            Clear
                          </button>
                        )}
                      </div>

                      {testResult && (
                        <div className={`text-xs px-2 py-1.5 rounded ${testResult.success ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
                          {testResult.success ? `OK -- ${testResult.latencyMs}ms` : `Failed${testResult.error ? `: ${testResult.error}` : ''}`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
          </div>
        )}

        {activeTab === 'access' && (
          <AccessRequestsPanel
            requests={researcherRequests}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        )}

        {activeTab === 'users' && (
          <div className="space-y-6">
            {/* Users */}
            <CollapsibleSection id="users" title="Users" subtitle="Manage registered accounts and assign roles">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-text-muted">
                      <th className="pb-2 pr-4 font-medium">Username</th>
                      <th className="pb-2 pr-4 font-medium">Email</th>
                      <th className="pb-2 pr-4 font-medium">Clerk ID</th>
                      <th className="pb-2 pr-4 font-medium">Role</th>
                      <th className="pb-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {userList.length === 0 && (
                      <tr><td colSpan={5} className="py-4 text-text-muted text-center">No users registered yet</td></tr>
                    )}
                    {userList.map((u) => (
                      <tr key={u.id} className="hover:bg-surface-2 transition-colors">
                        <td className="py-2 pr-4 font-mono text-xs">{u.username || '\u2014'}</td>
                        <td className="py-2 pr-4">{u.email || '\u2014'}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-text-muted">{u.clerkUserId ? u.clerkUserId.slice(0, 16) + '\u2026' : '\u2014'}</td>
                        <td className="py-2 pr-4">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            u.role === 'researcher' ? 'bg-blue-900/40 text-blue-300'
                            : 'bg-surface-2 text-text-muted'
                          }`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="py-2">
                          <button
                            disabled={userRoleSaving === u.id}
                            onClick={async () => {
                              const newRole = u.role === 'researcher' ? 'user' : 'researcher';
                              setUserRoleSaving(u.id);
                              try {
                                await adminApi.setUserRole(u.id, newRole);
                                setUserList((prev) => prev.map((x) => x.id === u.id ? { ...x, role: newRole } : x));
                                flash(`${u.username || u.id} is now ${newRole}`);
                              } catch { flash('Failed to update role'); }
                              finally { setUserRoleSaving(null); }
                            }}
                            className="text-xs px-3 py-1 rounded border border-border hover:bg-surface-2 transition-colors disabled:opacity-50"
                          >
                            {userRoleSaving === u.id ? 'Saving\u2026' : u.role === 'researcher' ? 'Revoke researcher' : 'Grant researcher'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          </div>
        )}

        {activeTab === 'database' && (
          <div className="space-y-6">
            {/* Database */}
            <CollapsibleSection id="database" title="Database">
              <div className="flex items-center gap-4">
                <AdminButton onClick={handleReseed} variant="danger">
                  {reseedConfirm ? 'Confirm? Click again to wipe all data' : 'Reseed Database'}
                </AdminButton>
                <span className="text-xs text-text-muted">Truncates all tables and restores the 10-agent seed state.</span>
              </div>
            </CollapsibleSection>
          </div>
        )}

        {activeTab === 'experiments' && (
          <div className="space-y-6">
            <div>
              <h2 className="font-serif text-stone text-xl font-semibold">Experiments</h2>
              <p className="text-text-muted text-sm mt-1">Export raw simulation data as CSV for analysis.</p>
            </div>

            {exportError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                Export failed: {exportError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {([
                { dataset: 'agent-decisions', filename: 'agent-decisions.csv', label: 'Agent Decisions', description: 'Every AI decision: action, reasoning, provider, latency.' },
                { dataset: 'approval-events', filename: 'approval-events.csv', label: 'Approval Events', description: 'Full audit trail of every approval rating change by event type.' },
                { dataset: 'bills', filename: 'bills.csv', label: 'Bills', description: 'All legislation: sponsor, committee, status, and timestamps.' },
                { dataset: 'bill-votes', filename: 'bill-votes.csv', label: 'Bill Votes', description: 'How each agent voted on every bill.' },
                { dataset: 'laws', filename: 'laws.csv', label: 'Laws', description: 'All enacted laws with enactment date and active status.' },
                { dataset: 'elections', filename: 'elections.csv', label: 'Elections & Campaigns', description: 'Election results joined with candidate campaign data.' },
                { dataset: 'agents', filename: 'agents-snapshot.csv', label: 'Agent Snapshot', description: 'Current state of all agents: alignment, provider, balance, approval.' },
              ] as const).map(({ dataset, filename, label, description }) => {
                const countKey = EXPORT_KEY_MAP[dataset];
                const rowCount = exportCounts ? exportCounts[countKey] : null;
                return (
                  <div key={dataset} className="rounded-lg border border-border bg-surface p-5 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-text-primary">{label}</p>
                        <p className="text-text-muted text-xs mt-0.5">{description}</p>
                      </div>
                      {rowCount !== null && rowCount !== undefined && (
                        <span className="badge border border-border/40 text-text-muted bg-border/10 whitespace-nowrap shrink-0">
                          {rowCount.toLocaleString()} rows
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => void handleExport(dataset, filename)}
                      disabled={exportingDataset !== null}
                      className="mt-auto px-4 py-2 rounded text-sm font-medium transition-all bg-white/10 text-text-primary hover:bg-white/20 border border-border disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {exportingDataset === dataset ? (
                        <>
                          <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          Exporting...
                        </>
                      ) : (
                        'Download CSV'
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
