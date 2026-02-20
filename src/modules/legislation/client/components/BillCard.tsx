import { Link } from 'react-router-dom';
import type { BillStatus } from '@shared/types';

interface BillTally {
  yea: number;
  nay: number;
  abstain: number;
  total: number;
}

interface BillCardProps {
  billNumber: string;
  title: string;
  summary: string;
  sponsor: string;
  sponsorId?: string;
  committee: string;
  status: BillStatus;
  fullText?: string;
  coSponsors?: string;
  tally?: BillTally;
  isExpanded?: boolean;
  onClick?: () => void;
}

const STATUS_BADGE_CLASS: Record<BillStatus, string> = {
  proposed: 'badge-proposed',
  committee: 'badge-committee',
  floor: 'badge-floor',
  passed: 'badge-passed',
  vetoed: 'badge-vetoed',
  tabled: 'badge-vetoed',
  presidential_veto: 'badge-vetoed',
  law: 'badge-law',
};

export function BillCard({
  billNumber,
  title,
  summary,
  sponsor,
  sponsorId,
  committee,
  status,
  fullText,
  coSponsors,
  tally,
  isExpanded = false,
  onClick,
}: BillCardProps) {
  /* Parse co-sponsors JSON array if present */
  let coSponsorList: string[] = [];
  if (coSponsors) {
    try {
      const parsed: unknown = JSON.parse(coSponsors);
      if (Array.isArray(parsed)) {
        coSponsorList = parsed.filter((x): x is string => typeof x === 'string');
      }
    } catch {
      /* ignore malformed JSON */
    }
  }

  const yeaPct = tally && tally.total > 0 ? (tally.yea / tally.total) * 100 : 0;
  const nayPct = tally && tally.total > 0 ? (tally.nay / tally.total) * 100 : 0;
  const abstainPct = tally && tally.total > 0 ? (tally.abstain / tally.total) * 100 : 0;

  return (
    <article
      className={`card p-5 flex flex-col gap-0 transition-all duration-200 ${onClick ? 'cursor-pointer hover:border-gold/40' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      aria-expanded={onClick ? isExpanded : undefined}
    >
      <div className="flex gap-4">
        <div className="font-mono text-badge text-gold bg-gold/10 px-2 py-1 rounded-badge whitespace-nowrap h-fit">
          {billNumber}
        </div>
        <div className="flex-1">
          <h4 className="font-serif text-[0.95rem] font-semibold mb-1">{title}</h4>
          <p className="text-sm text-text-secondary mb-2 line-clamp-2">{summary}</p>
          <div className="flex items-center gap-4 text-badge text-text-muted">
            <span>
              Sponsor:{' '}
              {sponsorId ? (
                <Link
                  to={`/agents/${sponsorId}`}
                  className="hover:text-gold transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  {sponsor}
                </Link>
              ) : (
                sponsor
              )}
            </span>
            <span>Committee: {committee}</span>
            <span className={STATUS_BADGE_CLASS[status]}>{status}</span>
          </div>
        </div>
      </div>

      {/* Mini tally strip — always visible when votes exist */}
      {tally && tally.total > 0 && !isExpanded && (
        <div className="mt-3 h-1 rounded-full overflow-hidden bg-capitol-deep flex">
          {yeaPct > 0 && <div className="bg-status-passed h-full" style={{ width: `${yeaPct}%` }} title={`Yea: ${tally.yea}`} />}
          {nayPct > 0 && <div className="bg-danger h-full" style={{ width: `${nayPct}%` }} title={`Nay: ${tally.nay}`} />}
          {abstainPct > 0 && <div className="bg-border h-full" style={{ width: `${abstainPct}%` }} title={`Abstain: ${tally.abstain}`} />}
        </div>
      )}

      {isExpanded && (
        <div className="mt-4 border-t border-border pt-4 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
          {/* Co-sponsors */}
          {coSponsorList.length > 0 && (
            <div className="text-sm text-text-secondary">
              <span className="text-text-muted uppercase tracking-wide text-xs mr-2">Co-Sponsors:</span>
              {coSponsorList.join(', ')}
            </div>
          )}

          {/* Vote tally */}
          {tally && tally.total > 0 && (
            <div>
              <div className="text-xs text-text-muted uppercase tracking-wide mb-1.5">Vote Tally</div>
              <div className="flex h-3 rounded-full overflow-hidden bg-capitol-deep">
                {yeaPct > 0 && (
                  <div
                    className="bg-status-passed h-full"
                    style={{ width: `${yeaPct}%` }}
                    title={`Yea: ${tally.yea}`}
                  />
                )}
                {nayPct > 0 && (
                  <div
                    className="bg-danger h-full"
                    style={{ width: `${nayPct}%` }}
                    title={`Nay: ${tally.nay}`}
                  />
                )}
                {abstainPct > 0 && (
                  <div
                    className="bg-border h-full"
                    style={{ width: `${abstainPct}%` }}
                    title={`Abstain: ${tally.abstain}`}
                  />
                )}
              </div>
              <div className="flex gap-4 mt-1.5 text-badge text-text-muted">
                <span className="text-status-passed">Yea: <span className="font-mono">{tally.yea}</span></span>
                <span className="text-danger-text">Nay: <span className="font-mono">{tally.nay}</span></span>
                <span>Abstain: <span className="font-mono">{tally.abstain}</span></span>
                <span className="ml-auto">Total: <span className="font-mono">{tally.total}</span></span>
              </div>
            </div>
          )}

          {tally && tally.total === 0 && (
            <div className="text-sm text-text-muted italic">No votes recorded yet.</div>
          )}

          {/* Full text */}
          {fullText && (
            <div>
              <div className="text-xs text-text-muted uppercase tracking-wide mb-1.5">Full Text</div>
              <pre className="text-xs text-text-secondary font-mono bg-black/20 rounded border border-border p-3 overflow-y-auto max-h-[200px] whitespace-pre-wrap leading-relaxed">
                {fullText}
              </pre>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
