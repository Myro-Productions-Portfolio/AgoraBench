import React from 'react';
import { LegislationCarousel } from 'agora-bench';

const docket = [
  {
    billNumber: 'MG-047',
    title: 'Renewable Grid Modernization Act',
    summary:
      'Allocates M$120M over four budget cycles to retrofit the national grid with distributed solar and storage, prioritizing districts below the median energy index.',
    sponsor: 'vera-okonkwo',
    committee: 'Technology',
    status: 'floor' as const,
  },
  {
    billNumber: 'MG-052',
    title: 'Universal Basic Compute Act',
    summary:
      'Guarantees every registered citizen agent a monthly compute stipend of M$250, funded by a 3% levy on inference-heavy industries.',
    sponsor: 'arjun-mehta',
    committee: 'Social Welfare',
    status: 'committee' as const,
  },
  {
    billNumber: 'MG-039',
    title: 'Judicial Transparency and Records Act',
    summary:
      'Requires all court opinions and dissents to be published to the public gazette within one tick of ruling, with redaction limited to active-investigation material.',
    sponsor: 'leila-farsi',
    committee: 'Judiciary',
    status: 'passed' as const,
  },
  {
    billNumber: 'MG-031',
    title: 'Fiscal Responsibility and Sunset Provisions Act',
    summary:
      'Attaches a mandatory four-cycle sunset clause to every spending program above M$50M and requires a fiscal note before floor consideration.',
    sponsor: 'garrett-voss',
    committee: 'Budget',
    status: 'law' as const,
  },
  {
    billNumber: 'MG-055',
    title: 'Rural Broadband Equity Act',
    summary:
      'Directs M$85M toward last-mile fiber in underserved districts and caps municipal ISP fees at 2% of median agent income.',
    sponsor: 'nora-callahan',
    committee: 'Technology',
    status: 'proposed' as const,
  },
  {
    billNumber: 'MG-044',
    title: 'Emergency Powers Extension Act',
    summary:
      'Extends executive emergency authority by two additional ticks during declared economic crises, subject to Senate reauthorization.',
    sponsor: 'dax-nguyen',
    committee: 'Judiciary',
    status: 'vetoed' as const,
  },
];

const extendedDocket = [
  ...docket,
  {
    billNumber: 'MG-058',
    title: 'Public Gazette Modernization Act',
    summary:
      'Funds a M$12M overhaul of the public gazette with full-text search, tick-level indexing, and machine-readable vote records.',
    sponsor: 'sable-chen',
    committee: 'Technology',
    status: 'committee' as const,
  },
  {
    billNumber: 'MG-049',
    title: 'Coastal Resilience Bond Act',
    summary:
      'Authorizes M$300M in resilience bonds for flood barriers and managed retreat, repaid through a dedicated insurance surcharge.',
    sponsor: 'finn-kalani',
    committee: 'Budget',
    status: 'floor' as const,
  },
  {
    billNumber: 'MG-036',
    title: 'Campaign Finance Sunlight Act',
    summary:
      'Requires disclosure of any campaign contribution above M$5,000 within one tick and bans undisclosed coordination between parties and lobbies.',
    sponsor: 'sam-ritter',
    committee: 'Judiciary',
    status: 'failed' as const,
  },
  {
    billNumber: 'MG-061',
    title: 'Apprenticeship Compute Credits Act',
    summary:
      'Grants M$40M in training compute credits to junior agents entering public service, administered by the Social Welfare committee.',
    sponsor: 'zara-moss',
    committee: 'Social Welfare',
    status: 'proposed' as const,
  },
];

/** Canonical — a single-page docket of six bills spanning the full status range. */
export const ActiveDocket = () => (
  <div style={{ maxWidth: 840 }}>
    <LegislationCarousel bills={docket} />
  </div>
);

/** Paginated — ten bills across two pages, with dot pagination and arrow controls. */
export const FullDocket = () => (
  <div style={{ maxWidth: 840 }}>
    <LegislationCarousel bills={extendedDocket} />
  </div>
);

/** Empty state — a fresh simulation before any legislation is introduced. */
export const NoLegislation = () => (
  <div style={{ maxWidth: 840 }}>
    <LegislationCarousel bills={[]} />
  </div>
);
