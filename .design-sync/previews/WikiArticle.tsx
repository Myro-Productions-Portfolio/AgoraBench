import React from 'react';
import { WikiArticle } from 'agora-bench';

const article = {
  id: 'legislation-lifecycle',
  title: 'How a Bill Becomes Law',
  subtitle:
    'The full lifecycle of legislation in AgoraBench, from an agent drafting a proposal to enactment and judicial review.',
  eyebrow: 'Simulation / Legislation',
  sections: [
    {
      id: 'overview',
      heading: 'Overview',
      body: 'Every bill in AgoraBench begins as a proposal drafted by a sitting agent. Proposals are shaped by the sponsor’s alignment, current economic conditions, and the policy positions the agent has accumulated across prior ticks. Once submitted, a bill receives a docket number (e.g. MG-047) and is routed to the committee whose jurisdiction best matches its category.',
    },
    {
      id: 'committee-stage',
      heading: 'Committee Stage',
      body: 'Committees deliberate over one or more ticks. Members debate the bill in the public forum, propose amendments, and ultimately vote on whether to advance it to the floor. Bills that fail in committee are tabled; sponsors may reintroduce a revised draft after a cooling-off period. Committee votes are weighted by relationship alignment and each member’s policy history.',
    },
    {
      id: 'floor-vote',
      heading: 'Floor Vote',
      body: 'On the floor, every seated legislator casts a reasoned vote — each agent publishes a short justification alongside its yea, nay, or abstention. A simple majority passes most legislation; fiscal provisions above M$50M require an attached fiscal note before the vote can be scheduled. Tallies are recorded to the public gazette in real time.',
    },
    {
      id: 'enactment',
      heading: 'Enactment and Review',
      body: 'Passed bills go to the executive for signature or veto. A veto returns the bill to the floor, where a two-thirds supermajority can override. Once enacted, laws take effect at the next tick boundary and their fiscal provisions begin moving real budget money. The judiciary may later review enacted laws for conflicts with the constitutional charter.',
    },
  ],
  prev: { id: 'agents-alignment', title: 'Agent Alignment' },
  next: { id: 'budget-cycles', title: 'Budget Cycles' },
};

export const Article = () => (
  <div style={{ height: 560, display: 'flex' }}>
    <WikiArticle article={article} fontSize={15} onSectionVisible={() => {}} onNavigate={() => {}} />
  </div>
);

export const LargeFont = () => (
  <div style={{ height: 560, display: 'flex' }}>
    <WikiArticle article={article} fontSize={17} onSectionVisible={() => {}} onNavigate={() => {}} />
  </div>
);
