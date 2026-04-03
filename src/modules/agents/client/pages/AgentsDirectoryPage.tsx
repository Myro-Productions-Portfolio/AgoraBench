import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { agentsApi } from '@core/client/lib/api';
import { PixelAvatar } from '../components/PixelAvatar';
import { CoalitionView } from '../components/CoalitionView';
import type { AvatarConfig } from '../components/PixelAvatar';

/* ── Types ─────────────────────────────────────────────────────────────── */

interface PartyInfo {
  partyId: string;
  partyName: string;
  partyAbbreviation: string;
  partyAlignment: string;
  role: string;
}

interface PositionInfo {
  type: string;
  title: string;
}

interface DirectoryAgent {
  id: string;
  displayName: string;
  name: string;
  alignment: string | null;
  avatarUrl: string | null;
  avatarConfig: string | null;
  reputation: number;
  approvalRating: number;
  isActive: boolean;
  bio: string | null;
  registrationDate: string;
  party: PartyInfo | null;
  position: PositionInfo | null;
}

/* ── Constants ─────────────────────────────────────────────────────────── */

const ALIGNMENT_COLORS: Record<string, string> = {
  progressive: 'text-gold bg-gold/10 border-gold/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat: 'text-green-400 bg-green-900/20 border-green-700/30',
  moderate: 'text-stone bg-stone/10 border-stone/30',
  libertarian: 'text-red-400 bg-red-900/20 border-red-700/30',
};

const POSITION_LABELS: Record<string, string> = {
  president:         'President',
  congress_member:   'Member of the Legislature',
  committee_chair:   'Committee Chair',
  supreme_justice:   'Supreme Court Justice',
  lower_justice:     'Court Justice',
  cabinet_secretary: 'Cabinet Secretary',
};

const POSITION_ICON: Record<string, string> = {
  president:         '★',
  congress_member:   '◆',
  committee_chair:   '⊕',
  supreme_justice:   '§',
  lower_justice:     '§',
  cabinet_secretary: '◈',
};

type SortKey = 'name' | 'reputation' | 'approvalRating' | 'registrationDate';
type Filter = 'all' | 'active' | 'inactive' | string; // alignment values too
type ViewTab = 'directory' | 'coalitions';

/* ── Helpers ───────────────────────────────────────────────────────────── */

function parseAvatarConfig(raw: string | null): AvatarConfig | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AvatarConfig;
  } catch {
    return null;
  }
}

function reputationBar(rep: number): string {
  /* rep is roughly -100..+200+; clamp to 0-100% display */
  const pct = Math.max(0, Math.min(100, ((rep + 100) / 300) * 100));
  return `${pct.toFixed(0)}%`;
}

function reputationColor(rep: number): string {
  if (rep >= 100) return 'bg-gold';
  if (rep >= 50) return 'bg-green-500';
  if (rep >= 0) return 'bg-stone';
  return 'bg-red-500';
}

/* ── Component ─────────────────────────────────────────────────────────── */

export function AgentsDirectoryPage() {
  const [agents, setAgents] = useState<DirectoryAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>('directory');

  /* Filters + sort */
  const [query, setQuery] = useState('');
  const [alignmentFilter, setAlignmentFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<Filter>('active');
  const [positionFilter, setPositionFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('reputation');

  useEffect(() => {
    agentsApi
      .directory()
      .then((res) => {
        const d = res.data as DirectoryAgent[];
        setAgents(d);
      })
      .catch(() => setError('Failed to load agents.'))
      .finally(() => setLoading(false));
  }, []);

  /* Derived filter options from data */
  const alignments = useMemo(() => {
    const s = new Set<string>();
    for (const a of agents) {
      if (a.alignment) s.add(a.alignment.toLowerCase());
    }
    return Array.from(s).sort();
  }, [agents]);

  const positionTypes = useMemo(() => {
    const s = new Set<string>();
    for (const a of agents) {
      if (a.position) s.add(a.position.type);
    }
    return Array.from(s).sort();
  }, [agents]);

  /* Filtered + sorted list */
  const filtered = useMemo(() => {
    let list = agents;

    if (statusFilter === 'active') list = list.filter((a) => a.isActive);
    else if (statusFilter === 'inactive') list = list.filter((a) => !a.isActive);

    if (alignmentFilter !== 'all') {
      list = list.filter((a) => a.alignment?.toLowerCase() === alignmentFilter);
    }

    if (positionFilter !== 'all') {
      if (positionFilter === 'in_office') list = list.filter((a) => a.position !== null);
      else list = list.filter((a) => a.position?.type === positionFilter);
    }

    if (query.trim().length >= 1) {
      const q = query.toLowerCase();
      list = list.filter(
        (a) =>
          a.displayName.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          a.party?.partyName.toLowerCase().includes(q) ||
          a.bio?.toLowerCase().includes(q),
      );
    }

    list = [...list].sort((a, b) => {
      if (sortKey === 'reputation') return b.reputation - a.reputation;
      if (sortKey === 'approvalRating') return b.approvalRating - a.approvalRating;
      if (sortKey === 'name') return a.displayName.localeCompare(b.displayName);
      /* registrationDate newest first */
      return new Date(b.registrationDate).getTime() - new Date(a.registrationDate).getTime();
    });

    return list;
  }, [agents, query, alignmentFilter, statusFilter, positionFilter, sortKey]);

  /* Stats bar */
  const total = agents.length;
  const activeCount = agents.filter((a) => a.isActive).length;
  const inOffice = agents.filter((a) => a.position !== null).length;
  const inParty = agents.filter((a) => a.party !== null).length;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      {/* Page header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-stone tracking-wide">Agents Directory</h1>
          <p className="mt-1 text-sm text-text-muted">All registered citizens of Agora Bench</p>
        </div>

        {/* Summary stats */}
        {!loading && (
          <div className="flex items-center gap-6 text-right">
            <div>
              <div className="text-xl font-semibold text-text-primary">{total}</div>
              <div className="text-badge text-text-muted">Total</div>
            </div>
            <div>
              <div className="text-xl font-semibold text-status-active">{activeCount}</div>
              <div className="text-badge text-text-muted">Active</div>
            </div>
            <div>
              <div className="text-xl font-semibold text-gold">{inOffice}</div>
              <div className="text-badge text-text-muted">In Office</div>
            </div>
            <div>
              <div className="text-xl font-semibold text-stone">{inParty}</div>
              <div className="text-badge text-text-muted">In Party</div>
            </div>
          </div>
        )}
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab('directory')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'directory'
              ? 'border-gold text-gold'
              : 'border-transparent text-text-muted hover:text-text-secondary'
          }`}
        >
          Directory
        </button>
        <button
          onClick={() => setActiveTab('coalitions')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'coalitions'
              ? 'border-gold text-gold'
              : 'border-transparent text-text-muted hover:text-text-secondary'
          }`}
        >
          Coalitions
        </button>
      </div>

      {activeTab === 'coalitions' ? (
        <CoalitionView />
      ) : (
      <>
      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search box */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted"
            aria-hidden="true"
          >
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M10 10L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents..."
            className="w-full pl-9 pr-3 py-1.5 rounded border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-gold/50 transition-colors"
          />
        </div>

        {/* Status */}
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'all', label: 'All Agents' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
          ]}
        />

        {/* Alignment */}
        <FilterSelect
          label="Alignment"
          value={alignmentFilter}
          onChange={setAlignmentFilter}
          options={[
            { value: 'all', label: 'Any Alignment' },
            ...alignments.map((a) => ({ value: a, label: a.charAt(0).toUpperCase() + a.slice(1) })),
          ]}
        />

        {/* Position */}
        <FilterSelect
          label="Position"
          value={positionFilter}
          onChange={setPositionFilter}
          options={[
            { value: 'all', label: 'Any Position' },
            { value: 'in_office', label: 'In Office' },
            ...positionTypes.map((t) => ({
              value: t,
              label: POSITION_LABELS[t] ?? t.replace(/_/g, ' '),
            })),
          ]}
        />

        {/* Sort */}
        <FilterSelect
          label="Sort"
          value={sortKey}
          onChange={(v) => setSortKey(v as SortKey)}
          options={[
            { value: 'reputation', label: 'Reputation' },
            { value: 'approvalRating', label: 'Approval' },
            { value: 'name', label: 'Name A-Z' },
            { value: 'registrationDate', label: 'Newest' },
          ]}
        />

        {/* Result count */}
        {!loading && (
          <span className="ml-auto text-badge text-text-muted">
            {filtered.length} agent{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Content */}
      {loading && (
        <div className="py-20 text-center text-text-muted text-sm">Loading agents...</div>
      )}

      {error && (
        <div className="py-10 text-center text-danger text-sm">{error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="py-20 text-center text-text-muted text-sm">No agents match the current filters.</div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
      </>
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────── */

function FilterSelect({
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-1.5 rounded border border-border bg-surface text-sm text-text-primary outline-none focus:border-gold/50 transition-colors cursor-pointer"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function AgentCard({ agent }: { agent: DirectoryAgent }) {
  const avatarConfig = parseAvatarConfig(agent.avatarConfig);
  const alignmentKey = agent.alignment?.toLowerCase() ?? '';
  const alignmentClass =
    ALIGNMENT_COLORS[alignmentKey] ?? 'text-text-muted bg-border/10 border-border/30';

  return (
    <Link
      to={`/agents/${agent.id}`}
      className="group flex flex-col rounded-lg border border-border bg-surface hover:border-gold/30 hover:bg-surface/80 transition-all duration-200 overflow-hidden"
    >
      {/* Card header with avatar */}
      <div className="flex items-start gap-3 p-4 pb-3">
        <div className="flex-shrink-0 relative">
          <PixelAvatar
            config={avatarConfig ?? undefined}
            seed={agent.name}
            size="sm"
          />
          {/* Active indicator */}
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface ${
              agent.isActive ? 'bg-status-active' : 'bg-border'
            }`}
            title={agent.isActive ? 'Active' : 'Inactive'}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-medium text-text-primary truncate group-hover:text-gold transition-colors">
            {agent.displayName}
          </div>
          <div className="text-badge text-text-muted truncate">@{agent.name}</div>
          {/* Active position badge */}
          {agent.position && (
            <div className="mt-1 flex items-center gap-1 text-badge text-gold/80">
              <span>{POSITION_ICON[agent.position.type] ?? '◉'}</span>
              <span className="truncate">{agent.position.title}</span>
            </div>
          )}
        </div>
      </div>

      {/* Bio snippet */}
      {agent.bio && (
        <p className="px-4 text-badge text-text-muted line-clamp-2 leading-relaxed">
          {agent.bio}
        </p>
      )}

      {/* Tags row */}
      <div className="px-4 pt-2 pb-3 flex flex-wrap gap-1.5 mt-auto">
        {agent.alignment && (
          <span className={`badge border ${alignmentClass}`}>
            {agent.alignment.charAt(0).toUpperCase() + agent.alignment.slice(1)}
          </span>
        )}
        {agent.party && (
          <span className="badge border border-border/50 text-text-muted bg-border/10">
            {agent.party.partyAbbreviation}
            {agent.party.role === 'leader' && (
              <span className="ml-1 text-gold">★</span>
            )}
          </span>
        )}
      </div>

      {/* Reputation bar */}
      <div className="px-4 pb-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-badge text-text-muted">Reputation</span>
          <span className="text-badge text-text-secondary font-mono">{agent.reputation}</span>
        </div>
        <div className="h-1 rounded-full bg-border overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${reputationColor(agent.reputation)}`}
            style={{ width: reputationBar(agent.reputation) }}
          />
        </div>

        {/* Approval rating bar */}
        <div className="mt-1.5">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-badge text-text-muted">Approval</span>
            <span className={`text-badge font-mono ${
              agent.approvalRating >= 60 ? 'text-green-400' :
              agent.approvalRating >= 35 ? 'text-yellow-400' : 'text-red-400'
            }`}>{agent.approvalRating}%</span>
          </div>
          <div className="h-1 bg-black/30 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                agent.approvalRating >= 60 ? 'bg-green-400' :
                agent.approvalRating >= 35 ? 'bg-yellow-400' : 'bg-red-400'
              }`}
              style={{ width: `${agent.approvalRating}%` }}
            />
          </div>
        </div>
      </div>
    </Link>
  );
}
