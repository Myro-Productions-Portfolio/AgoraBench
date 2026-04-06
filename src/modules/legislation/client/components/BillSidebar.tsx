import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useWebSocket } from '@core/client/lib/useWebSocket';
import { LobbyingFeed } from './LobbyingFeed';
import { DealLog } from './DealLog';

/* ── Types ─────────────────────────────────────────────────────────────── */

interface Statement {
  id: string;
  agentId: string;
  agentName: string;
  triggerType: string;
  statementText: string;
  createdAt: string;
}

/* ── Constants ─────────────────────────────────────────────────────────── */

const TRIGGER_LABELS: Record<string, string> = {
  bill_passed:    'Bill Passed',
  bill_failed:    'Bill Failed',
  bill_vetoed:    'Vetoed',
  election_won:   'Election Won',
  election_lost:  'Election Lost',
  deal_broken:    'Deal Broken',
  proactive:      'Proactive',
};

const TRIGGER_COLORS: Record<string, string> = {
  bill_passed:    'text-green-300 bg-green-900/20 border-green-700/30',
  bill_failed:    'text-red-300 bg-red-900/20 border-red-700/30',
  bill_vetoed:    'text-orange-300 bg-orange-900/20 border-orange-700/30',
  election_won:   'text-gold bg-yellow-900/20 border-yellow-700/30',
  election_lost:  'text-stone/60 bg-stone/10 border-stone/20',
  deal_broken:    'text-red-400 bg-red-900/30 border-red-700/40',
  proactive:      'text-blue-300 bg-blue-900/20 border-blue-700/30',
};

/* ── Helpers ───────────────────────────────────────────────────────────── */

function fmtRelative(s: string): string {
  const diff = Date.now() - new Date(s).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ── Statements panel ───────────────────────────────────────────────────── */

function StatementsList({ billId }: { billId: string }) {
  const [statements, setStatements] = useState<Statement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { subscribe } = useWebSocket();

  const fetchStatements = useCallback(() => {
    fetch(`/api/legislation/${billId}/statements`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load statements (${res.status})`);
        return res.json() as Promise<{ data: Statement[] }>;
      })
      .then((res) => setStatements(res.data ?? []))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [billId]);

  useEffect(() => { fetchStatements(); }, [fetchStatements]);

  useEffect(() => {
    const unsub = subscribe('agent:statement', fetchStatements);
    return () => unsub();
  }, [subscribe, fetchStatements]);

  if (loading) return <p className="text-sm text-text-muted animate-pulse">Loading statements...</p>;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (statements.length === 0) return <p className="text-sm text-text-muted">No statements have been issued on this bill.</p>;

  return (
    <div className="space-y-2">
      {statements.map((stmt) => {
        const label = TRIGGER_LABELS[stmt.triggerType] ?? stmt.triggerType;
        const color = TRIGGER_COLORS[stmt.triggerType] ?? 'text-text-muted bg-border/10 border-border/30';
        const excerpt = stmt.statementText.length > 120
          ? `${stmt.statementText.slice(0, 120)}…`
          : stmt.statementText;
        return (
          <div key={stmt.id} className="rounded border border-border/50 bg-capitol-deep/20 px-3 py-2 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                to={`/agents/${stmt.agentId}`}
                className="text-xs text-gold hover:underline font-medium"
              >
                {stmt.agentName}
              </Link>
              <span className={`badge border ${color}`}>{label}</span>
              <span className="ml-auto text-xs text-text-muted">{fmtRelative(stmt.createdAt)}</span>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed">{excerpt}</p>
          </div>
        );
      })}
    </div>
  );
}

/* ── BillSidebar ────────────────────────────────────────────────────────── */

type Tab = 'lobbying' | 'deals' | 'statements';

interface BillSidebarProps {
  billId: string;
}

export function BillSidebar({ billId }: BillSidebarProps) {
  const [activeTab, setActiveTab] = useState<Tab>('lobbying');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'lobbying',   label: 'Lobbying' },
    { id: 'deals',      label: 'Deals' },
    { id: 'statements', label: 'Statements' },
  ];

  return (
    <div className="rounded-lg border border-border bg-surface">
      {/* Tab bar */}
      <div className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-3 py-2.5 text-badge uppercase tracking-wider transition-colors ${
              activeTab === tab.id
                ? 'text-gold border-b-2 border-gold -mb-px'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-4">
        {activeTab === 'lobbying' && <LobbyingFeed billId={billId} />}
        {activeTab === 'deals' && <DealLog billId={billId} />}
        {activeTab === 'statements' && <StatementsList billId={billId} />}
      </div>
    </div>
  );
}
