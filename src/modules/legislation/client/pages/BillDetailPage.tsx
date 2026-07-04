import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { legislationApi } from '@core/client/lib/api';
import { useWebSocket } from '@core/client/lib/useWebSocket';
import { formatMoney } from '@core/client/lib/formatMoney';
import { AmendmentsList } from '../components/AmendmentsList';
import { BillSidebar } from '../components/BillSidebar';

/* ── Types ─────────────────────────────────────────────────────────────── */

interface RollCallEntry {
  voterId: string;
  voterName: string;
  choice: string;
  castAt: string | null;
  reasoning: string | null;
  followedWhip: boolean;
}

interface FiscalNote {
  kind: 'spend_once' | 'spend_recurring' | 'tax_change';
  oneTimeCost: number;
  perTickDelta: number;
  perCycleDelta: number;
  horizonTicks: number;
  projected10TickDelta: number;
  pctOfCurrentTreasury: number;
  expectedTickRevenue: number;
}

interface BillDetail {
  id: string;
  title: string;
  summary: string;
  fullText: string;
  sponsorId: string;
  sponsorDisplayName: string;
  committeeChairName: string | null;
  committee: string;
  status: string;
  billType: string;
  committeeDecision: string | null;
  introducedAt: string;
  lastActionAt: string;
  withdrawnAt?: string;
  tally: { yea: number; nay: number; abstain: number; total: number };
  rollCall: RollCallEntry[];
  law: { id: string; title: string; enactedDate: string; isActive: boolean } | null;
  /* Phase 3 fiscal provision (validated + clamped at proposal time) */
  fiscalKind: 'spend_once' | 'spend_recurring' | 'tax_change' | null;
  fiscalAmount: number | null;
  fiscalTaxDelta: number | null;
  fiscalProgramName: string | null;
  sunsetTicks: number | null;
  /* Deterministic server-side projection — null when the bill has no provision */
  fiscalNote: FiscalNote | null;
}

/* ── Constants ─────────────────────────────────────────────────────────── */

const STATUS_META: Record<string, { label: string; color: string }> = {
  proposed:          { label: 'Proposed',           color: 'text-blue-300 bg-blue-900/20 border-blue-700/30' },
  committee:         { label: 'In Committee',        color: 'text-yellow-300 bg-yellow-900/20 border-yellow-700/30' },
  floor:             { label: 'On the Floor',        color: 'text-orange-300 bg-orange-900/20 border-orange-700/30' },
  passed:            { label: 'Passed Legislature',   color: 'text-green-300 bg-green-900/20 border-green-700/30' },
  presidential_veto: { label: 'Presidential Veto',  color: 'text-red-300 bg-red-900/20 border-red-700/30' },
  failed:            { label: 'Failed Floor Vote',    color: 'text-red-400 bg-red-900/30 border-red-700/40' },
  vetoed:            { label: 'Vetoed',              color: 'text-red-400 bg-red-900/30 border-red-700/40' },
  law:               { label: 'Enacted into Law',   color: 'text-emerald-300 bg-emerald-900/20 border-emerald-700/30' },
  withdrawn:         { label: 'Withdrawn',           color: 'text-stone/60 bg-stone/10 border-stone/20' },
};

const VOTE_COLORS: Record<string, string> = {
  yea:     'text-green-400',
  nay:     'text-red-400',
  abstain: 'text-text-muted',
};

/* ── Helpers ───────────────────────────────────────────────────────────── */

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const fmtM = (v: number): string => formatMoney(v);

/* ── Component ─────────────────────────────────────────────────────────── */

export function BillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [bill, setBill] = useState<BillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fullTextOpen, setFullTextOpen] = useState(false);
  const [expandedVoters, setExpandedVoters] = useState<Set<string>>(new Set());
  const { subscribe } = useWebSocket();

  const toggleVoter = useCallback((voterId: string) => {
    setExpandedVoters((prev) => {
      const next = new Set(prev);
      if (next.has(voterId)) next.delete(voterId);
      else next.add(voterId);
      return next;
    });
  }, []);

  const fetchBill = useCallback(() => {
    if (!id) return;
    legislationApi
      .getById(id)
      .then((res) => setBill(res.data as BillDetail))
      .catch(() => setError('Bill not found.'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { fetchBill(); }, [fetchBill]);

  /* Refresh on live bill activity — votes, status changes, resolution */
  useEffect(() => {
    const unsubs = [
      subscribe('agent:vote', fetchBill),
      subscribe('bill:advanced', fetchBill),
      subscribe('bill:resolved', fetchBill),
      subscribe('bill:presidential_veto', fetchBill),
      subscribe('bill:floor_amendment_proposed', fetchBill),
      subscribe('bill:amended', fetchBill),
      subscribe('bill:withdrawn', fetchBill),
      subscribe('agent:lobby', fetchBill),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe, fetchBill]);

  if (loading) {
    return <div className="max-w-4xl mx-auto px-6 py-20 text-center text-text-muted text-sm">Loading...</div>;
  }
  if (error || !bill) {
    return <div className="max-w-4xl mx-auto px-6 py-20 text-center text-danger text-sm">{error ?? 'Bill not found.'}</div>;
  }

  const statusMeta = STATUS_META[bill.status] ?? { label: bill.status, color: 'text-text-muted bg-border/10 border-border/30' };
  const { yea, nay, abstain, total } = bill.tally;
  const votedCount = yea + nay;
  const yeaPct = votedCount > 0 ? (yea / votedCount) * 100 : 0;
  const nayPct = votedCount > 0 ? (nay / votedCount) * 100 : 0;

  const showSidebar = bill.status === 'floor' || bill.status === 'passed' || bill.status === 'presidential_veto';

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      {/* Back link */}
      <Link to="/legislation" className="text-badge text-text-muted hover:text-gold transition-colors">
        ← Back to Legislation
      </Link>

      {/* Header card */}
      <div className="rounded-lg border border-border bg-surface p-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`badge border ${statusMeta.color}`}>{statusMeta.label}</span>
              <span className="badge border border-border/40 text-text-muted bg-border/10">
                {bill.billType === 'amendment' ? 'Amendment' : 'Original Bill'}
              </span>
              <span className="badge border border-border/40 text-text-muted bg-border/10">
                {bill.committee.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} Committee
              </span>
            </div>
            <h1 className="font-serif text-2xl font-semibold text-stone leading-snug">{bill.title}</h1>
          </div>
        </div>

        {/* Meta row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 border-t border-border/50">
          <MetaCell label="Sponsor">
            <Link to={`/agents/${bill.sponsorId}`} className="text-gold hover:underline">
              {bill.sponsorDisplayName}
            </Link>
          </MetaCell>
          {bill.committeeChairName && (
            <MetaCell label="Committee Chair">{bill.committeeChairName}</MetaCell>
          )}
          <MetaCell label="Introduced">{fmtDate(bill.introducedAt)}</MetaCell>
          <MetaCell label="Last Action">{fmtDate(bill.lastActionAt)}</MetaCell>
          {bill.committeeDecision && (
            <MetaCell label="Committee Decision">
              <span className="capitalize">{bill.committeeDecision.replace(/_/g, ' ')}</span>
            </MetaCell>
          )}
        </div>

        {/* Enacted law banner */}
        {bill.law && (
          <div className="rounded border border-emerald-700/30 bg-emerald-900/10 px-4 py-2.5 text-sm text-emerald-300">
            Enacted into law on {fmtDate(bill.law.enactedDate)}
            {!bill.law.isActive && <span className="ml-2 text-text-muted">(repealed)</span>}
          </div>
        )}

        {/* Withdrawal banner */}
        {bill.status === 'withdrawn' && bill.withdrawnAt && (
          <div className="rounded border border-stone/30 bg-stone/10 px-4 py-2.5 text-sm text-stone/70">
            {bill.sponsorDisplayName} withdrew this bill on {fmtDate(bill.withdrawnAt)}.
          </div>
        )}
      </div>

      {/* Two-column layout on lg+ when sidebar is active */}
      <div className={`grid grid-cols-1 gap-6 items-start ${showSidebar ? 'lg:grid-cols-[1fr_300px]' : ''}`}>
        {/* Main content column */}
        <div className="space-y-6">
          {/* Summary */}
          <Section title="Summary">
            <p className="text-sm text-text-secondary leading-relaxed">{bill.summary}</p>
          </Section>

          {/* Fiscal Note — only when the bill carries a validated provision */}
          {bill.fiscalNote && <FiscalNoteSection bill={bill} note={bill.fiscalNote} />}

          {/* Floor Amendments */}
          <AmendmentsList billId={bill.id} billStatus={bill.status} />

          {/* Vote Tally */}
          {total > 0 && (
            <Section title={`Vote Tally — ${total} vote${total !== 1 ? 's' : ''} cast`}>
              {/* Breakdown bar */}
              <div className="h-3 rounded-full overflow-hidden flex mb-3">
                {yeaPct > 0 && (
                  <div className="h-full bg-green-500 transition-all" style={{ width: `${yeaPct}%` }} title={`Yea: ${yea}`} />
                )}
                {nayPct > 0 && (
                  <div className="h-full bg-red-500 transition-all" style={{ width: `${nayPct}%` }} title={`Nay: ${nay}`} />
                )}
                {abstain > 0 && (
                  <div className="h-full bg-border flex-1" title={`Abstain: ${abstain}`} />
                )}
              </div>
              <div className="flex gap-6 text-sm mb-4">
                <span className="text-green-400 font-medium">{yea} Yea</span>
                <span className="text-red-400 font-medium">{nay} Nay</span>
                {abstain > 0 && <span className="text-text-muted">{abstain} Abstain</span>}
              </div>

              {/* Roll call table */}
              {bill.rollCall.length > 0 && (
                <div className="rounded border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-capitol-deep/60">
                        <th className="text-left px-4 py-2 text-badge text-text-muted font-medium uppercase tracking-wider">Agent</th>
                        <th className="text-left px-4 py-2 text-badge text-text-muted font-medium uppercase tracking-wider">Vote</th>
                        <th className="text-left px-4 py-2 text-badge text-text-muted font-medium uppercase tracking-wider hidden sm:table-cell">Cast At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bill.rollCall.map((entry, i) => {
                        const expanded = expandedVoters.has(entry.voterId);
                        return (
                          <VoteRow
                            key={entry.voterId}
                            entry={entry}
                            zebra={i % 2 === 1}
                            expanded={expanded}
                            onToggle={() => toggleVoter(entry.voterId)}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          )}

          {/* Full Text */}
          <Section title="Full Text">
            <button
              onClick={() => setFullTextOpen((v) => !v)}
              className="mb-3 text-badge text-gold hover:text-gold/80 transition-colors"
            >
              {fullTextOpen ? '▲ Collapse' : '▼ Expand full text'}
            </button>
            {fullTextOpen && (
              <div className="rounded border border-border bg-capitol-deep/40 p-4 text-sm text-text-secondary leading-relaxed whitespace-pre-wrap font-mono text-xs">
                {bill.fullText}
              </div>
            )}
          </Section>
        </div>

        {/* Sidebar column */}
        {showSidebar && <BillSidebar billId={bill.id} />}
      </div>
    </div>
  );
}

/* ── Shared sub-components ──────────────────────────────────────────────── */

/* Roll-call row: click to expand the voter's stored reasoning. Every row is
   expandable for consistency — rows without reasoning show a fallback. */
function VoteRow({ entry, zebra, expanded, onToggle }: {
  entry: RollCallEntry;
  zebra: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className={`border-b border-border/40 cursor-pointer hover:bg-white/[0.03] transition-colors ${zebra ? 'bg-white/[0.01]' : ''}`}
      >
        <td className="px-4 py-2">
          <span className={`inline-block mr-2 text-badge text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden="true">
            ▶
          </span>
          <Link
            to={`/agents/${entry.voterId}`}
            onClick={(e) => e.stopPropagation()}
            className="text-text-secondary hover:text-gold transition-colors"
          >
            {entry.voterName}
          </Link>
        </td>
        <td className={`px-4 py-2 font-medium capitalize ${VOTE_COLORS[entry.choice] ?? 'text-text-muted'}`}>
          {entry.choice}
        </td>
        <td className="px-4 py-2 text-text-muted hidden sm:table-cell">{fmtDateTime(entry.castAt)}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/40 bg-capitol-deep/40">
          <td colSpan={3} className="px-4 py-3 pl-10">
            {entry.reasoning ? (
              <p className="text-xs text-text-secondary leading-relaxed">{entry.reasoning}</p>
            ) : entry.followedWhip ? (
              <span className="badge border text-yellow-300 bg-yellow-900/20 border-yellow-700/30">
                Followed party whip
              </span>
            ) : (
              <p className="text-xs text-text-muted italic">No reasoning recorded</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-6 space-y-3">
      <h2 className="font-serif text-lg font-semibold text-stone">{title}</h2>
      {children}
    </div>
  );
}

/* ── Fiscal Note (Phase 3) — deterministic "CBO score" projection ─────── */

const FISCAL_KIND_LABELS: Record<FiscalNote['kind'], string> = {
  spend_once: 'One-Time Appropriation',
  spend_recurring: 'Recurring Spending Program',
  tax_change: 'Revenue Law',
};

function FiscalNoteSection({ bill, note }: { bill: BillDetail; note: FiscalNote }) {
  const pctOfRevenue = note.expectedTickRevenue > 0 && note.perTickDelta !== 0
    ? Math.round((Math.abs(note.perTickDelta) / note.expectedTickRevenue) * 1000) / 10
    : null;

  return (
    <Section title="Fiscal Note">
      <div className="flex flex-wrap gap-2">
        <span className="badge border text-badge uppercase tracking-widest text-gold bg-gold/10 border-gold/30">
          {FISCAL_KIND_LABELS[note.kind]}
        </span>
        {bill.sunsetTicks !== null && (
          <span className="badge border text-badge uppercase tracking-widest text-orange-300 bg-orange-900/20 border-orange-700/30">
            Sunsets after {bill.sunsetTicks} tick{bill.sunsetTicks !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="text-sm text-text-secondary leading-relaxed space-y-1">
        {note.kind === 'spend_once' && (
          <p>
            Estimated cost: <span className="font-mono text-red-400">−{fmtM(note.oneTimeCost)}</span> from the treasury,
            once, at enactment{note.pctOfCurrentTreasury > 0 && <> — {note.pctOfCurrentTreasury}% of the current treasury</>}.
          </p>
        )}
        {note.kind === 'spend_recurring' && (
          <>
            <p>
              Estimated cost: <span className="font-mono text-red-400">{fmtM(note.perTickDelta)}/tick</span>{' '}
              ({fmtM(note.perCycleDelta)} per budget cycle)
              {pctOfRevenue !== null && <> — {pctOfRevenue}% of expected tick revenue</>}.
            </p>
            {bill.fiscalProgramName && (
              <p>Establishes the program &quot;{bill.fiscalProgramName}&quot;, funded until it lapses at a budget session or is renewed.</p>
            )}
          </>
        )}
        {note.kind === 'tax_change' && (
          <p>
            Moves the tax rate by <span className={`font-mono ${(bill.fiscalTaxDelta ?? 0) > 0 ? 'text-red-400' : 'text-green-400'}`}>
              {(bill.fiscalTaxDelta ?? 0) > 0 ? '+' : ''}{bill.fiscalTaxDelta ?? 0} point{Math.abs(bill.fiscalTaxDelta ?? 0) !== 1 ? 's' : ''}
            </span>{' '}
            at enactment — projected revenue change of{' '}
            <span className={`font-mono ${note.perTickDelta >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtM(note.perTickDelta)}/tick</span>{' '}
            at current agent balances.
          </p>
        )}
        <p>
          Projected 10-tick treasury impact:{' '}
          <span className={`font-mono ${note.projected10TickDelta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {fmtM(note.projected10TickDelta)}
          </span>
          {note.kind !== 'spend_once' && note.pctOfCurrentTreasury > 0 && (
            <> · full-horizon impact ≈ {note.pctOfCurrentTreasury}% of the current treasury</>
          )}
          .
        </p>
      </div>

      <p className="text-xs text-text-muted">
        Deterministic projection from the bill&apos;s validated, clamped fiscal provision — computed by the bench, not the sponsor.
      </p>
    </Section>
  );
}

function MetaCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-badge text-text-muted mb-0.5">{label}</div>
      <div className="text-sm text-text-secondary">{children}</div>
    </div>
  );
}
