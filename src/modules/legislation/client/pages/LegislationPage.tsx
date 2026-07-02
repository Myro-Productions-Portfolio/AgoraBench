import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '@core/client/lib/useWebSocket';
import { SectionHeader } from '@core/client/components/SectionHeader';
import { BillCard } from '../components/BillCard';
import { BillPipeline } from '../components/BillPipeline';
import { legislationApi } from '@core/client/lib/api';
import type { BillStatus } from '@shared/types';

type ExtendedBillStatus = BillStatus | 'tabled' | 'presidential_veto' | 'withdrawn';

interface BillTally {
  yea: number;
  nay: number;
  abstain: number;
  total: number;
}

interface BillData {
  id: string;
  title: string;
  summary: string;
  sponsorId: string;
  sponsorDisplayName?: string;
  committee: string;
  status: ExtendedBillStatus;
  fullText?: string;
  coSponsorIds?: string;
  tally?: BillTally;
  billType?: string;
  amendsLawId?: string | null;
  amendmentCount?: number;
}

interface LawData {
  id: string;
  billId: string;
  title: string;
  text: string;
  enactedDate: string;
  isActive: boolean;
}

function getStatusColor(status: ExtendedBillStatus): string {
  switch (status) {
    case 'proposed': return 'text-blue-400 bg-blue-400/10';
    case 'committee': return 'text-yellow-400 bg-yellow-400/10';
    case 'floor': return 'text-purple-400 bg-purple-400/10';
    case 'passed': return 'text-green-400 bg-green-400/10';
    case 'failed': return 'text-red-400 bg-red-400/10';
    case 'vetoed': return 'text-red-400 bg-red-400/10';
    case 'tabled': return 'text-gray-400 bg-gray-400/10';
    case 'presidential_veto': return 'text-orange-400 bg-orange-400/10';
    case 'law': return 'text-emerald-400 bg-emerald-400/10';
    case 'withdrawn': return 'text-stone/60 bg-stone/10 border-stone/20';
    default: return 'text-text-muted bg-black/20';
  }
}

function getStatusLabel(status: ExtendedBillStatus): string {
  switch (status) {
    case 'proposed': return 'Proposed';
    case 'committee': return 'Committee';
    case 'floor': return 'Floor Vote';
    case 'passed': return 'Passed';
    case 'failed': return 'Failed';
    case 'vetoed': return 'Vetoed';
    case 'tabled': return 'Tabled';
    case 'presidential_veto': return 'Pres. Veto';
    case 'law': return 'Law';
    case 'withdrawn': return 'Withdrawn';
    default: return String(status);
  }
}


export function LegislationPage() {
  const [bills, setBills] = useState<BillData[]>([]);
  const [laws, setLaws] = useState<LawData[]>([]);
  const [filter, setFilter] = useState<ExtendedBillStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);
  const [expandedLawId, setExpandedLawId] = useState<string | null>(null);
  const [closedCommittees, setClosedCommittees] = useState<Set<string>>(new Set());
  const { subscribe } = useWebSocket();

  const fetchBills = useCallback(async () => {
    try {
      const res = await legislationApi.list();
      if (res.data && Array.isArray(res.data)) {
        setBills(res.data as BillData[]);
      }
    } catch {
      /* leave empty */
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLaws = useCallback(async () => {
    try {
      const res = await legislationApi.laws();
      if (res.data && Array.isArray(res.data)) {
        setLaws(res.data as LawData[]);
      }
    } catch {
      /* leave empty */
    }
  }, []);

  useEffect(() => {
    void fetchBills();
    void fetchLaws();

    const refetchBills = () => { void fetchBills(); };
    const refetchAll = () => { void fetchBills(); void fetchLaws(); };
    const unsubs = [
      subscribe('bill:proposed', refetchBills),
      subscribe('bill:advanced', refetchBills),
      subscribe('bill:resolved', refetchAll),
      subscribe('agent:vote', refetchBills),
      subscribe('bill:passed', refetchBills),
      subscribe('bill:presidential_veto', refetchBills),
      subscribe('bill:veto_overridden', refetchAll),
      subscribe('bill:veto_sustained', refetchAll),
      subscribe('bill:tabled', refetchBills),
      subscribe('bill:committee_amended', refetchBills),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [fetchBills, fetchLaws, subscribe]);

  /* Compute status counts for BillPipeline */
  const statusCounts: Record<string, number> = {};
  for (const bill of bills) {
    statusCounts[bill.status] = (statusCounts[bill.status] ?? 0) + 1;
  }

  /* Bill committee map — used to group enacted laws by committee */
  const billCommitteeMap: Record<string, string> = {};
  for (const bill of bills) {
    billCommitteeMap[bill.id] = bill.committee;
  }

  /* Filter bills by pipeline selection + search */
  const filteredBills = (filter === 'all' ? bills : bills.filter((b) => b.status === filter))
    .filter((b) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return b.title.toLowerCase().includes(q) || b.summary.toLowerCase().includes(q);
    });

  /* Group laws by committee */
  const lawsByCommittee: Record<string, LawData[]> = {};
  for (const law of laws) {
    const committee = billCommitteeMap[law.billId] ?? 'General';
    if (!lawsByCommittee[committee]) lawsByCommittee[committee] = [];
    lawsByCommittee[committee].push(law);
  }
  const lawCommittees = Object.keys(lawsByCommittee).sort();

  function toggleCommittee(name: string) {
    setClosedCommittees((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function handleCardClick(billId: string) {
    setExpandedBillId((prev) => (prev === billId ? null : billId));
  }

  if (loading) {
    return (
      <div className="px-8 xl:px-16 py-section">
        <SectionHeader title="Legislation" badge="Loading..." />
        <div className="flex items-center justify-center py-24">
          <p className="text-text-muted animate-pulse text-lg">Loading legislation...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-8 xl:px-16 py-section">
      <SectionHeader title="Legislation" badge={`${bills.length} Bills`} />

      {/* Bill pipeline visualization */}
      <BillPipeline
        counts={statusCounts}
        activeFilter={filter}
        onFilter={(v) => setFilter(v as ExtendedBillStatus | 'all')}
      />

      {/* Search bar */}
      <div className="mb-6">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search bills by title or summary..."
          className="w-full md:w-96 px-4 py-2 rounded border border-border bg-black/20 text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:border-gold/60 transition-colors"
        />
      </div>

      {/* Bills grid */}
      {filteredBills.length === 0 ? (
        <div className="text-center py-16 text-text-muted">
          <p className="text-lg">
            {bills.length === 0
              ? 'No legislation has been introduced yet.'
              : search
              ? `No bills match "${search}"`
              : `No bills with status "${filter}"`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4 items-start">
          {filteredBills.map((bill, idx) => (
            <div key={bill.id} className={`flex flex-col gap-1 ${bill.status === 'withdrawn' ? 'opacity-60' : ''}`}>
              {/* Extra badges for new statuses and amendment type */}
              <div className="flex gap-2 flex-wrap">
                {(bill.status === 'tabled' || bill.status === 'presidential_veto' || bill.status === 'withdrawn') && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(bill.status)}`}>
                    {getStatusLabel(bill.status)}
                  </span>
                )}
                {bill.billType === 'amendment' && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-amber-400 bg-amber-400/10">
                    Amendment Bill
                  </span>
                )}
                {(bill.amendmentCount ?? 0) > 0 && (
                  <span className="badge border border-amber-700/30 text-amber-300 bg-amber-900/10">
                    {bill.amendmentCount} amendment{bill.amendmentCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <BillCard
                billNumber={`MG-${String(idx + 1).padStart(3, '0')}`}
                title={bill.title}
                summary={bill.summary}
                sponsor={bill.sponsorDisplayName ?? bill.sponsorId}
                sponsorId={bill.sponsorId}
                committee={bill.committee}
                status={bill.status as BillStatus}
                fullText={bill.fullText}
                coSponsors={bill.coSponsorIds}
                tally={bill.tally}
                isExpanded={expandedBillId === bill.id}
                onClick={() => handleCardClick(bill.id)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Enacted Laws section — grouped by committee */}
      <div className="mt-12">
        <SectionHeader title="Enacted Laws" badge={`${laws.length} Active`} />

        {laws.length === 0 ? (
          <div className="text-center py-16 text-text-muted">
            <p className="text-lg">No laws have been enacted yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {lawCommittees.map((committee) => {
              const isOpen = !closedCommittees.has(committee);
              const committeeItems = lawsByCommittee[committee];
              return (
                <div key={committee} className="rounded border border-border overflow-hidden">
                  {/* Accordion header */}
                  <button
                    className="w-full flex items-center justify-between px-5 py-3 bg-black/20 hover:bg-black/30 transition-colors text-left"
                    onClick={() => toggleCommittee(committee)}
                    aria-expanded={isOpen}
                  >
                    <span className="font-medium text-text-primary">{committee}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-badge text-text-muted">{committeeItems.length} law{committeeItems.length !== 1 ? 's' : ''}</span>
                      <span className="text-text-muted text-sm">{isOpen ? '▲' : '▼'}</span>
                    </span>
                  </button>

                  {/* Accordion body */}
                  {isOpen && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4 p-4">
                      {committeeItems.map((law, idx) => {
                        const isExpanded = expandedLawId === law.id;
                        const enactedDate = new Date(law.enactedDate).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        });
                        return (
                          <article
                            key={law.id}
                            className={`card p-5 flex flex-col gap-0 transition-all duration-200 cursor-pointer hover:border-gold/40 ${!law.isActive ? 'opacity-60' : ''}`}
                            onClick={() => setExpandedLawId((prev) => (prev === law.id ? null : law.id))}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedLawId((prev) => (prev === law.id ? null : law.id)); } }}
                            aria-expanded={isExpanded}
                          >
                            <div className="flex gap-4">
                              <div className="font-mono text-badge text-status-passed bg-status-passed/10 px-2 py-1 rounded-badge whitespace-nowrap h-fit">
                                LAW-{String(idx + 1).padStart(3, '0')}
                              </div>
                              <div className="flex-1">
                                <h4 className="font-serif text-[0.95rem] font-semibold mb-1">{law.title}</h4>
                                <div className="flex items-center gap-3 text-badge text-text-muted flex-wrap">
                                  <span>Enacted: {enactedDate}</span>
                                  <span className={law.isActive ? 'badge-passed' : 'badge-vetoed'}>
                                    {law.isActive ? 'Active' : 'Repealed'}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {isExpanded && (
                              <div className="mt-4 border-t border-border pt-4" onClick={(e) => e.stopPropagation()}>
                                <div className="text-xs text-text-muted uppercase tracking-wide mb-1.5">Full Text</div>
                                <pre className="text-xs text-text-secondary font-mono bg-black/20 rounded border border-border p-3 overflow-y-auto max-h-[200px] whitespace-pre-wrap leading-relaxed">
                                  {law.text}
                                </pre>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
