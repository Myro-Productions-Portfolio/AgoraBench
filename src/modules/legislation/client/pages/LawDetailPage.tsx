import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { legislationApi } from '@core/client/lib/api';
import { useWebSocket } from '@core/client/lib/useWebSocket';
import { PixelAvatar } from '@modules/agents/client/components/PixelAvatar';
import type { AvatarConfig } from '@modules/agents/client/components/PixelAvatar';

/* ── Types ─────────────────────────────────────────────────────────────── */

interface AmendmentBill {
  id: string;
  title: string;
  status: string;
  introducedAt: string;
}

interface LawFiscal {
  kind: 'spend_once' | 'spend_recurring' | 'tax_change';
  amount: number | null;
  taxDelta: number | null;
  programName: string | null;
  sunsetTicks: number | null;
  programActive: boolean;
  enactedTick: number | null;
  lastRenewedTick: number | null;
  currentTickNumber: number;
  budgetCycleTicks: number;
  ticksUntilSunset: number | null;
  ticksUntilLapse: number | null;
  cumulativeImpact: number;
}

interface LawDetail {
  id: string;
  title: string;
  text: string;
  enactedDate: string;
  isActive: boolean;
  amendmentHistory: string; // JSON string
  sourceBill: {
    id: string;
    title: string;
    committee: string;
    status: string;
    introducedAt: string;
  } | null;
  sponsor: {
    id: string;
    displayName: string;
    avatarConfig: string | null;
    alignment: string | null;
  } | null;
  amendmentBills: AmendmentBill[];
  /* Phase 3: null on every legacy law (NULL fiscal_kind) — renders nothing */
  fiscal: LawFiscal | null;
}

/* ── Constants ─────────────────────────────────────────────────────────── */

const ALIGNMENT_COLORS: Record<string, string> = {
  progressive:  'text-gold bg-gold/10 border-gold/30',
  conservative: 'text-slate-300 bg-slate-800/40 border-slate-600/30',
  technocrat:   'text-green-400 bg-green-900/20 border-green-700/30',
  moderate:     'text-stone bg-stone/10 border-stone/30',
  libertarian:  'text-red-400 bg-red-900/20 border-red-700/30',
};

const BILL_STATUS_META: Record<string, { label: string; color: string }> = {
  proposed:          { label: 'Proposed',          color: 'text-blue-300 bg-blue-900/20 border-blue-700/30' },
  committee:         { label: 'In Committee',       color: 'text-yellow-300 bg-yellow-900/20 border-yellow-700/30' },
  floor:             { label: 'On the Floor',       color: 'text-orange-300 bg-orange-900/20 border-orange-700/30' },
  passed:            { label: 'Passed',             color: 'text-green-300 bg-green-900/20 border-green-700/30' },
  presidential_veto: { label: 'Presidential Veto', color: 'text-red-300 bg-red-900/20 border-red-700/30' },
  failed:            { label: 'Failed Floor Vote',  color: 'text-red-400 bg-red-900/30 border-red-700/40' },
  vetoed:            { label: 'Vetoed',             color: 'text-red-400 bg-red-900/30 border-red-700/40' },
  law:               { label: 'Enacted',            color: 'text-emerald-300 bg-emerald-900/20 border-emerald-700/30' },
};

/* ── Helpers ───────────────────────────────────────────────────────────── */

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtM(v: number): string {
  return v < 0 ? `−M$${Math.abs(v).toLocaleString()}` : `M$${v.toLocaleString()}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-6 space-y-3">
      <h2 className="font-serif text-lg font-semibold text-stone">{title}</h2>
      {children}
    </div>
  );
}

/* ── Component ─────────────────────────────────────────────────────────── */

export function LawDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [law, setLaw] = useState<LawDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const { subscribe } = useWebSocket();

  const fetchLaw = useCallback(() => {
    if (!id) return;
    legislationApi.lawById(id)
      .then((res) => {
        if (res.data) {
          setLaw(res.data as LawDetail);
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { fetchLaw(); }, [fetchLaw]);

  /* Refresh when this law is amended or struck down */
  useEffect(() => {
    const unsubs = [
      subscribe('law:amended', fetchLaw),
      subscribe('law:struck_down', fetchLaw),
      subscribe('law:sunset', fetchLaw),
      subscribe('budget:session', fetchLaw),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe, fetchLaw]);

  if (loading) {
    return <div className="max-w-4xl mx-auto px-6 py-8 text-text-muted">Loading...</div>;
  }
  if (notFound || !law) {
    return <div className="max-w-4xl mx-auto px-6 py-8 text-text-muted">Law not found.</div>;
  }

  const sponsorAvatarConfig = law.sponsor?.avatarConfig
    ? (JSON.parse(law.sponsor.avatarConfig) as AvatarConfig)
    : undefined;
  const alignKey = law.sponsor?.alignment?.toLowerCase() ?? '';
  const alignColor = ALIGNMENT_COLORS[alignKey] ?? 'text-text-muted bg-border/10 border-border/30';

  /* Parse amendment history */
  type AmendmentEntry = { date: string; billId: string; previousText: string };
  let amendmentHistory: AmendmentEntry[] = [];
  try {
    const parsed = JSON.parse(law.amendmentHistory);
    if (Array.isArray(parsed)) amendmentHistory = parsed as AmendmentEntry[];
  } catch { /* leave empty */ }

  const billStatus = law.sourceBill ? (BILL_STATUS_META[law.sourceBill.status] ?? { label: law.sourceBill.status, color: 'text-text-muted bg-border/10 border-border/30' }) : null;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      {/* Back */}
      <Link to="/laws" className="text-badge text-text-muted hover:text-gold transition-colors">
        ← Back to Laws
      </Link>

      {/* Header card */}
      <div className="rounded-lg border border-border bg-surface p-6 space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <h1 className="font-serif text-2xl font-semibold text-stone flex-1">{law.title}</h1>
          <span
            className={`badge border text-badge uppercase tracking-widest shrink-0 ${
              law.isActive
                ? 'text-green-400 bg-green-900/20 border-green-700/30'
                : 'text-red-400 bg-red-900/20 border-red-700/30'
            }`}
          >
            {law.isActive ? 'Active' : 'Repealed'}
          </span>
        </div>
        <p className="text-text-muted text-sm">Enacted {fmtDate(law.enactedDate)}</p>
      </div>

      {/* Sponsor */}
      {law.sponsor && (
        <Section title="Sponsor">
          <div className="flex items-center gap-3">
            <PixelAvatar config={sponsorAvatarConfig} seed={law.sponsor.displayName} size="md" />
            <div className="space-y-1">
              <Link
                to={`/agents/${law.sponsor.id}`}
                className="text-gold hover:underline font-medium"
              >
                {law.sponsor.displayName}
              </Link>
              {alignKey && (
                <div>
                  <span className={`badge border text-badge uppercase tracking-widest ${alignColor}`}>
                    {alignKey}
                  </span>
                </div>
              )}
            </div>
          </div>
        </Section>
      )}

      {/* Source bill */}
      {law.sourceBill && (
        <Section title="Source Bill">
          <div className="space-y-2">
            <Link
              to={`/legislation/${law.sourceBill.id}`}
              className="text-gold hover:underline font-medium leading-snug block"
            >
              {law.sourceBill.title}
            </Link>
            <div className="flex flex-wrap gap-2">
              {billStatus && (
                <span className={`badge border text-badge uppercase tracking-widest ${billStatus.color}`}>
                  {billStatus.label}
                </span>
              )}
              <span className="badge border border-border/40 text-text-muted bg-border/10">
                {law.sourceBill.committee}
              </span>
            </div>
            <p className="text-text-muted text-xs">Introduced {fmtDate(law.sourceBill.introducedAt)}</p>
          </div>
        </Section>
      )}

      {/* Fiscal effects — only when the law carries a provision (legacy laws render nothing) */}
      {law.fiscal && <FiscalEffectsSection fiscal={law.fiscal} lawActive={law.isActive} />}

      {/* Full text */}
      <Section title="Full Text">
        <pre className="text-text-secondary text-sm whitespace-pre-wrap leading-relaxed font-sans">
          {law.text}
        </pre>
      </Section>

      {/* Amendment history — only if non-empty */}
      {amendmentHistory.length > 0 && (
        <Section title="Amendment History">
          <ol className="space-y-4 list-decimal list-inside">
            {amendmentHistory.map((entry, i) => (
              <li key={i} className="text-text-secondary text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-text-muted text-xs">{fmtDate(entry.date)}</span>
                  <Link to={`/legislation/${entry.billId}`} className="text-gold hover:underline text-xs">
                    View Amendment Bill →
                  </Link>
                </div>
                <pre className="text-text-muted text-xs whitespace-pre-wrap leading-relaxed font-sans line-clamp-3 opacity-60">
                  {entry.previousText}
                </pre>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* Amended by — bills that reference this law */}
      {law.amendmentBills.length > 0 && (
        <Section title="Amended By">
          <div className="space-y-2">
            {law.amendmentBills.map((b) => {
              const s = BILL_STATUS_META[b.status] ?? { label: b.status, color: 'text-text-muted bg-border/10 border-border/30' };
              return (
                <div key={b.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-border/30 last:border-0">
                  <Link to={`/legislation/${b.id}`} className="text-gold hover:underline text-sm">
                    {b.title}
                  </Link>
                  <span className={`badge border text-badge uppercase tracking-widest shrink-0 ${s.color}`}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

/* ── Fiscal effects (Phase 3) ──────────────────────────────────────────── */

function FiscalRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-border/30 last:border-0 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-secondary text-right">{children}</span>
    </div>
  );
}

function FiscalEffectsSection({ fiscal, lawActive }: { fiscal: LawFiscal; lawActive: boolean }) {
  /* Status badge: program funding state, or sunset countdown */
  let statusBadge: { label: string; color: string } | null = null;
  if (fiscal.kind === 'spend_recurring') {
    statusBadge = fiscal.programActive
      ? { label: 'Program Active', color: 'text-green-400 bg-green-900/20 border-green-700/30' }
      : { label: 'Funding Lapsed', color: 'text-yellow-300 bg-yellow-900/20 border-yellow-700/30' };
  }
  const sunsetExpired = !lawActive && fiscal.ticksUntilSunset === 0;

  return (
    <Section title="Fiscal Effects">
      <div className="flex flex-wrap gap-2">
        {statusBadge && (
          <span className={`badge border text-badge uppercase tracking-widest ${statusBadge.color}`}>
            {statusBadge.label}
          </span>
        )}
        {fiscal.ticksUntilSunset !== null && (
          sunsetExpired ? (
            <span className="badge border text-badge uppercase tracking-widest text-red-400 bg-red-900/20 border-red-700/30">
              Expired by Sunset
            </span>
          ) : lawActive ? (
            <span className="badge border text-badge uppercase tracking-widest text-orange-300 bg-orange-900/20 border-orange-700/30">
              {fiscal.ticksUntilSunset === 0
                ? 'Sunset due next tick'
                : `Sunsets in ${fiscal.ticksUntilSunset} tick${fiscal.ticksUntilSunset !== 1 ? 's' : ''}`}
            </span>
          ) : null
        )}
      </div>

      <div>
        {fiscal.kind === 'spend_once' && (
          <FiscalRow label="One-time appropriation">
            <span className="font-mono text-red-400">−{fmtM(fiscal.amount ?? 0)}</span> at enactment
          </FiscalRow>
        )}
        {fiscal.kind === 'spend_recurring' && (
          <>
            <FiscalRow label="Program">{fiscal.programName ?? '—'}</FiscalRow>
            <FiscalRow label="Cost per tick">
              <span className="font-mono text-red-400">−{fmtM(fiscal.amount ?? 0)}</span>
            </FiscalRow>
            {fiscal.programActive && fiscal.ticksUntilLapse !== null && (
              <FiscalRow label="Funding due">
                {fiscal.ticksUntilLapse === 0
                  ? 'Lapses at the next budget session unless renewed'
                  : `${fiscal.ticksUntilLapse} tick${fiscal.ticksUntilLapse !== 1 ? 's' : ''} (renewable by amendment)`}
              </FiscalRow>
            )}
            {!fiscal.programActive && (
              <FiscalRow label="Funding">Lapsed — the law stands, but the treasury no longer pays. An amendment bill can re-fund it.</FiscalRow>
            )}
          </>
        )}
        {fiscal.kind === 'tax_change' && (
          <FiscalRow label="Tax rate change">
            <span className={`font-mono ${(fiscal.taxDelta ?? 0) > 0 ? 'text-red-400' : 'text-green-400'}`}>
              {(fiscal.taxDelta ?? 0) > 0 ? '+' : ''}{fiscal.taxDelta ?? 0} point{Math.abs(fiscal.taxDelta ?? 0) !== 1 ? 's' : ''}
            </span> applied at enactment
          </FiscalRow>
        )}
        {fiscal.kind !== 'tax_change' && (
          <FiscalRow label="Cumulative treasury impact">
            <span className="font-mono text-red-400">−{fmtM(fiscal.cumulativeImpact)}</span> to date
          </FiscalRow>
        )}
        {fiscal.enactedTick !== null && (
          <FiscalRow label="Enacted at">Tick {fiscal.enactedTick}{fiscal.lastRenewedTick !== null && fiscal.lastRenewedTick !== fiscal.enactedTick ? ` · last renewed tick ${fiscal.lastRenewedTick}` : ''}</FiscalRow>
        )}
      </div>
      <p className="text-xs text-text-muted">
        Figures come from the treasury ledger and the law&apos;s validated fiscal provision. See the{' '}
        <Link to="/budget" className="text-gold hover:underline">Budget dashboard</Link> for the full picture.
      </p>
    </Section>
  );
}
