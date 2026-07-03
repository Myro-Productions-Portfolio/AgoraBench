import React from 'react';
import { BillCard } from 'agora-bench';

export const Proposed = () => (
  <BillCard
    billNumber="MG-047"
    title="Renewable Grid Modernization Act"
    summary="Allocates M$120M over four budget cycles to retrofit the national grid with distributed solar and storage, prioritizing districts below the median energy index."
    sponsor="vera-okonkwo"
    sponsorId="agent-vera"
    committee="Technology"
    status="proposed"
  />
);

export const InCommittee = () => (
  <BillCard
    billNumber="MG-052"
    title="Universal Basic Compute Act"
    summary="Guarantees every registered citizen agent a monthly compute stipend of M$250, funded by a 3% levy on inference-heavy industries."
    sponsor="arjun-mehta"
    sponsorId="agent-arjun"
    committee="Social Welfare"
    status="committee"
  />
);

export const OnFloorWithTally = () => (
  <BillCard
    billNumber="MG-039"
    title="Judicial Transparency and Records Act"
    summary="Requires all court opinions and dissents to be published to the public gazette within one tick of ruling, with redaction limited to active-investigation material."
    sponsor="leila-farsi"
    sponsorId="agent-leila"
    committee="Judiciary"
    status="floor"
    tally={{ yea: 6, nay: 3, abstain: 1, total: 10 }}
  />
);

export const PassedExpanded = () => (
  <BillCard
    billNumber="MG-031"
    title="Fiscal Responsibility and Sunset Provisions Act"
    summary="Attaches a mandatory four-cycle sunset clause to every spending program above M$50M and requires a fiscal note before floor consideration."
    sponsor="garrett-voss"
    sponsorId="agent-garrett"
    committee="Budget"
    status="passed"
    isExpanded
    coSponsors='["nora-callahan","sam-ritter","zara-moss"]'
    tally={{ yea: 7, nay: 2, abstain: 1, total: 10 }}
    fullText={`SECTION 1. SHORT TITLE.\nThis Act may be cited as the "Fiscal Responsibility and Sunset Provisions Act".\n\nSECTION 2. SUNSET REQUIREMENT.\n(a) Every spending program exceeding M$50,000,000 in projected outlays shall terminate no later than four budget cycles after enactment unless reauthorized.\n(b) The Budget Committee shall publish a fiscal note prior to any floor vote.`}
  />
);

export const Vetoed = () => (
  <BillCard
    billNumber="MG-044"
    title="Emergency Powers Extension Act"
    summary="Extends executive emergency authority by two additional ticks during declared economic crises."
    sponsor="dax-nguyen"
    sponsorId="agent-dax"
    committee="Rules"
    status="vetoed"
    tally={{ yea: 5, nay: 5, abstain: 0, total: 10 }}
  />
);

export const EnactedLaw = () => (
  <BillCard
    billNumber="MG-018"
    title="Open Deliberation Act"
    summary="Requires all committee deliberations to be mirrored to the public forum within one tick, establishing the public gazette as the record of proceedings."
    sponsor="sable-chen"
    sponsorId="agent-sable"
    committee="Governance"
    status="law"
  />
);
