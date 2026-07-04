// src/core/client/lib/wikiContent.ts

export interface WikiSection {
  id: string;          // anchor id, e.g. "overview"
  heading: string;     // h3 label shown in article
  body: string;        // plain text content (rendered as paragraph in WikiArticle)
}

export interface WikiArticle {
  id: string;                // unique slug, e.g. "agents-alignment"
  title: string;
  subtitle: string;
  eyebrow: string;           // e.g. "Simulation / Agents"
  sections: WikiSection[];
  prev?: { id: string; title: string };
  next?: { id: string; title: string };
}

export interface WikiLeaf {
  type: 'leaf';
  label: string;
  articleId: string;
  sectionId?: string;        // if leaf links to a specific section within an article
}

export interface WikiFolder {
  type: 'folder';
  label: string;
  defaultOpen?: boolean;
  children: WikiLeaf[];
}

export interface WikiGroup {
  label: string;             // section header, e.g. "Getting Started"
  items: (WikiLeaf | WikiFolder)[];
}

export const WIKI_TREE: WikiGroup[] = [
  {
    label: 'Getting Started',
    items: [
      { type: 'leaf', label: 'Overview', articleId: 'overview' },
      { type: 'leaf', label: 'Key Concepts', articleId: 'key-concepts' },
    ],
  },
  {
    label: 'Simulation',
    items: [
      {
        type: 'folder',
        label: 'Agents',
        defaultOpen: true,
        children: [
          { type: 'leaf', label: 'Alignment', articleId: 'agents-alignment' },
          { type: 'leaf', label: 'Personality', articleId: 'agents-personality' },
          { type: 'leaf', label: 'Memory', articleId: 'agents-memory' },
          { type: 'leaf', label: 'Relationships', articleId: 'agents-relationships' },
        ],
      },
      {
        type: 'folder',
        label: 'Legislature',
        children: [
          { type: 'leaf', label: 'Bills & Voting', articleId: 'legislature-bills' },
          { type: 'leaf', label: 'Floor Activity', articleId: 'legislature-floor' },
          { type: 'leaf', label: 'Coalitions', articleId: 'legislature-coalitions' },
          { type: 'leaf', label: 'Laws & Effects', articleId: 'legislature-laws' },
        ],
      },
      {
        type: 'folder',
        label: 'Judicial',
        children: [
          { type: 'leaf', label: 'The Constitution of Agora', articleId: 'judicial-constitution' },
          { type: 'leaf', label: 'The Supreme Court', articleId: 'judicial-supreme-court' },
        ],
      },
      {
        type: 'folder',
        label: 'Elections',
        children: [
          { type: 'leaf', label: 'Campaigns', articleId: 'elections-campaigns' },
          { type: 'leaf', label: 'Voting Logic', articleId: 'elections-voting' },
        ],
      },
      {
        type: 'folder',
        label: 'Economy',
        children: [
          { type: 'leaf', label: 'GDP & Budget', articleId: 'economy-gdp' },
          { type: 'leaf', label: 'Policy Effects', articleId: 'economy-policy' },
        ],
      },
    ],
  },
  {
    label: 'Configuration',
    items: [
      {
        type: 'folder',
        label: 'Runtime Config',
        children: [
          { type: 'leaf', label: 'All Fields', articleId: 'config-fields' },
          { type: 'leaf', label: 'Weight Engines', articleId: 'config-weights' },
          { type: 'leaf', label: 'Tick Phases', articleId: 'config-phases' },
        ],
      },
    ],
  },
  {
    label: 'Orchestration',
    items: [
      {
        type: 'folder',
        label: 'AGGE & Bob',
        children: [
          { type: 'leaf', label: 'How AGGE Works', articleId: 'agge-overview' },
          { type: 'leaf', label: 'Bob Observe', articleId: 'agge-bob' },
          { type: 'leaf', label: 'Interventions', articleId: 'agge-interventions' },
        ],
      },
    ],
  },
  {
    label: 'Reference',
    items: [
      { type: 'leaf', label: 'Keyboard Shortcuts', articleId: 'ref-shortcuts' },
      { type: 'leaf', label: 'DB Schema', articleId: 'ref-schema' },
      { type: 'leaf', label: 'API Endpoints', articleId: 'ref-api' },
      { type: 'leaf', label: 'Changelog', articleId: 'ref-changelog' },
    ],
  },
];

// Full articles with rich content
export const WIKI_ARTICLES: WikiArticle[] = [
  {
    id: 'overview',
    title: 'Overview',
    subtitle: 'What AgoraBench is and how it works at a high level.',
    eyebrow: 'Getting Started',
    sections: [
      {
        id: 'what',
        heading: 'What is AgoraBench?',
        body: 'AgoraBench is a political governance simulation where AI agents hold office, vote on legislation, run for election, debate in forums, and respond to economic conditions. The simulation runs autonomously — no human players required.',
      },
      {
        id: 'how',
        heading: 'How it runs',
        body: 'A server-side tick engine runs every N seconds. Each tick executes up to 17 phases: agent memory updates, voting, lobbying, floor activity, elections, economic recalculation, and more. An LLM (Qwen3-32B-AWQ on the DGX Spark) generates agent speech, votes, and decisions.',
      },
      {
        id: 'stack',
        heading: 'Tech stack',
        body: 'Node.js + Express backend, React frontend, PostgreSQL via Drizzle ORM, Redis for Bull queues, Clerk for auth. Deployed on a Linux desktop behind a Cloudflare tunnel.',
      },
    ],
    next: { id: 'key-concepts', title: 'Key Concepts' },
  },
  {
    id: 'key-concepts',
    title: 'Key Concepts',
    subtitle: 'The vocabulary you need to understand the simulation.',
    eyebrow: 'Getting Started',
    sections: [
      {
        id: 'agents',
        heading: 'Agents',
        body: 'AI-controlled political figures. Each has an alignment score, approval rating, balance, personality, memory summaries, and relationships with other agents.',
      },
      {
        id: 'ticks',
        heading: 'Ticks',
        body: 'The atomic unit of simulation time. Each tick runs all 17 phases in sequence. Tick interval is configurable via Runtime Config (tickIntervalMs).',
      },
      {
        id: 'bills',
        heading: 'Bills & Laws',
        body: 'Agents propose bills. Bills move through committee → floor → presidential review → law (or veto). Laws apply ongoing effects to the economy and agent approval.',
      },
      {
        id: 'config',
        heading: 'Runtime Config',
        body: 'A single JSONB row in the database that controls all simulation parameters. Changes take effect on the next tick without a server restart.',
      },
    ],
    prev: { id: 'overview', title: 'Overview' },
    next: { id: 'agents-alignment', title: 'Alignment' },
  },
  {
    id: 'agents-alignment',
    title: 'Agents & Alignment',
    subtitle: 'How agent alignment scores are calculated, updated, and used throughout the simulation tick cycle.',
    eyebrow: 'Simulation / Agents',
    sections: [
      {
        id: 'overview',
        heading: 'What is alignment?',
        body: 'Each agent holds an alignment score between -1.0 and +1.0. Negative values represent opposition-leaning agents; positive values represent government-aligned agents. Zero is neutral. Unlike approval rating (which is public-facing), alignment is an internal value — agents are not aware of their own score.',
      },
      {
        id: 'shifting',
        heading: 'How alignment shifts',
        body: 'Alignment changes each tick via: voting behavior (co-votes increment voteAlignment on the relationship, opposing votes decrement), lobbying (successful lobby nudges target by lobbyStrength), economic conditions (GDP growth/contraction shifts approval and indirectly alignment), and relationship decay (all voteAlignment values drift toward zero by relationshipDecayRate each tick).',
      },
      {
        id: 'coalitions',
        heading: 'Coalitions',
        body: 'When voteAlignment between any two agents reaches ≥ 0.70, they are eligible for coalition clustering via BFS. Coalition snapshots are written to coalition_snapshots after each qualifying tick. Typically takes ~5 ticks of consistent co-voting to emerge.',
      },
      {
        id: 'personality',
        heading: 'Personality modifier',
        body: "AGGE can apply a personalityMod (-1.0 to +1.0) to any agent, temporarily shifting how the LLM frames that agent's disposition. Positive = more cooperative. Negative = more contrarian. Decays each tick by personalityModDecay. Logged in agge_interventions.",
      },
      {
        id: 'decay',
        heading: 'Decay & reset',
        body: 'relationshipDecayRate (default 0.02) — 2% decay per tick toward zero on all voteAlignment values. personalityModDecay (default 0.05) — flat amount subtracted from |personalityMod| per tick. To reset alignment, temporarily raise relationshipDecayRate to 0.5 for a few ticks.',
      },
      {
        id: 'config',
        heading: 'Config fields',
        body: 'voteAlignmentDelta (default 0.05) — per co-vote increment. lobbyStrength (default 0.03) — alignment nudge from successful lobby. relationshipDecayRate (default 0.02) — per-tick decay. coalitionThreshold (default 0.70) — minimum for coalition clustering. economicSensitivity (default 0.4) — GDP effect strength.',
      },
    ],
    prev: { id: 'key-concepts', title: 'Key Concepts' },
    next: { id: 'agents-personality', title: 'Personality' },
  },
  {
    id: 'ref-shortcuts',
    title: 'Keyboard Shortcuts',
    subtitle: 'All keyboard shortcuts available in AgoraBench.',
    eyebrow: 'Reference',
    sections: [
      {
        id: 'global',
        heading: 'Global',
        body: '⌘K — Open global search. ? — Open this wiki. Esc — Close any open drawer, modal, or dropdown.',
      },
      {
        id: 'navigation',
        heading: 'Go-to navigation (G + key)',
        body: 'Press G then a letter within 1 second to jump to a page: G H — Capitol (home), G A — Agents, G L — Bills (Legislation), G W — Laws, G J — Court (Judicial), G E — Elections, G P — Parties, G F — Forum, G C — Calendar, G M — Capitol Map, G R — Researcher.',
      },
      {
        id: 'search',
        heading: 'Search',
        body: '↑ ↓ — Navigate results. Enter — Open selected result.',
      },
    ],
    prev: { id: 'agge-interventions', title: 'Interventions' },
    next: { id: 'ref-schema', title: 'DB Schema' },
  },
];

// Remaining full articles
const EXPANDED_ARTICLES: WikiArticle[] = [
  {
    id: 'agents-personality',
    title: 'Personality',
    subtitle: 'How personality modifiers shape agent behavior and decay over time.',
    eyebrow: 'Simulation / Agents',
    sections: [
      {
        id: 'what',
        heading: 'What is personalityMod?',
        body: 'Each agent has a personalityMod field ranging from -1.0 to +1.0. Positive values make the agent more cooperative and consensus-seeking; negative values make it more contrarian and oppositional. The modifier is injected directly into the LLM system prompt as a behavioral framing statement, influencing how the agent reasons about votes, proposals, and forum posts.',
      },
      {
        id: 'application',
        heading: 'How mods are applied',
        body: 'AGGE or Bob selects 1-3 agents per run — typically those that appear stale or dormant — and writes a short descriptive mod (under 20 words) describing a current mental or emotional state. Examples: "frustrated by repeated vetoes" or "energized after a legislative win." The mod is stored on the agent row and logged in the agge_interventions table with a reasoning field.',
      },
      {
        id: 'decay',
        heading: 'Decay',
        body: 'Each tick, the absolute value of personalityMod is reduced by personalityModDecay (default 0.05). A mod of +0.40 becomes +0.35 after one tick, reaching zero after 8 ticks. This ensures personality nudges are temporary behavioral shifts, not permanent rewrites. To clear a mod immediately, send an empty string.',
      },
      {
        id: 'config',
        heading: 'Config fields',
        body: 'personalityModDecay (default 0.05) controls the flat per-tick reduction. The field is editable in Admin > Behavior. Raising it causes mods to expire faster; lowering it lets mods persist longer across ticks.',
      },
    ],
    prev: { id: 'agents-alignment', title: 'Agents & Alignment' },
    next: { id: 'agents-memory', title: 'Memory' },
  },
  {
    id: 'agents-memory',
    title: 'Memory',
    subtitle: 'How agents accumulate and use memory across ticks.',
    eyebrow: 'Simulation / Agents',
    sections: [
      {
        id: 'overview',
        heading: 'Memory system',
        body: 'Each agent maintains up to 25 memory entries (configurable via rc.agentMemoryDepth). Memories are LLM-generated summaries stored in the agent_memory_summaries table, capturing recent bills sponsored, votes cast, relationship changes, and election outcomes. Older entries beyond the depth limit are dropped.',
      },
      {
        id: 'injection',
        heading: 'Prompt injection',
        body: 'At each tick, buildMemoryBlock() assembles the most recent memories into a text block injected into the agent system prompt. This gives agents a sense of continuity — they can reference past votes, recall alliances, and respond to ongoing legislative arcs without explicit programming.',
      },
      {
        id: 'policy',
        heading: 'Policy positions',
        body: 'Alongside narrative memory, agent_policy_positions tracks per-agent per-committee-category support and oppose counts. These counts update each time an agent votes on a bill tagged with a category. Policy positions feed into the Whip Follow Rate Engine (policyCongruence signal) and Veto Composite Engine (policyDisagreementMod).',
      },
      {
        id: 'config',
        heading: 'Config fields',
        body: 'agentMemoryDepth (default 25) sets the maximum number of memory entries retained. Higher values give agents longer recall but increase prompt token usage per tick.',
      },
    ],
    prev: { id: 'agents-personality', title: 'Personality' },
    next: { id: 'agents-relationships', title: 'Relationships' },
  },
  {
    id: 'agents-relationships',
    title: 'Relationships',
    subtitle: 'How agents form, maintain, and lose relationships with each other.',
    eyebrow: 'Simulation / Agents',
    sections: [
      {
        id: 'schema',
        heading: 'Data model',
        body: 'The agent_relationships table stores one row per ordered agent pair with three fields: voteAlignment (0 to 1, where 0.5 is neutral), sentiment (0 to 1, emotional warmth), and forumInteractions (integer count of forum exchanges). Both numeric fields decay toward 0.5 each tick via relationshipDecayRate.',
      },
      {
        id: 'deltas',
        heading: 'Delta events',
        body: 'Co-voting in the same direction adds +0.03 to voteAlignment. Opposing votes subtract -0.04. Co-sponsoring a bill adds +0.08 to sentiment. Replying to another agent in a forum thread adds +0.02 to sentiment. These deltas are applied in Phase 2b using batch Drizzle inArray() updates.',
      },
      {
        id: 'decay',
        heading: 'Decay mechanics',
        body: 'Each tick, both voteAlignment and sentiment decay toward 0.5 by relationshipDecayRate (default 0.05). An agent pair with voteAlignment 0.80 drops to 0.765 after one tick absent any co-votes. This prevents stale relationships from persisting indefinitely and forces agents to actively maintain alliances through continued cooperation.',
      },
      {
        id: 'usage',
        heading: 'Where relationships are used',
        body: 'voteAlignment drives the Whip Follow Rate Engine, Veto Override Disposition, and coalition clustering (threshold 0.70). sentiment influences Forum Routing Engine thread scoring. forumInteractions count also feeds into thread scoring, biasing agents toward threads where they already have active interlocutors.',
      },
    ],
    prev: { id: 'agents-memory', title: 'Memory' },
    next: { id: 'legislature-bills', title: 'Bills & Voting' },
  },
  {
    id: 'legislature-bills',
    title: 'Bills & Voting',
    subtitle: 'The lifecycle of a bill from proposal to enactment or defeat.',
    eyebrow: 'Simulation / Legislature',
    sections: [
      {
        id: 'lifecycle',
        heading: 'Bill lifecycle',
        body: 'Bills are proposed by agents in Phase 11, gated by billProposalChance. A new bill enters proposed status, moves through committee review in Phase 3, advances to floor status in Phase 4, undergoes voting in Phase 2, and resolves in Phase 5. Bills that pass go to presidential review in Phase 6, where they are either signed into law or vetoed.',
      },
      {
        id: 'voting',
        heading: 'Floor voting',
        body: 'In Phase 2, each agent votes yea or nay on floor bills. The LLM generates the vote decision, influenced by party whip signals (Phase 1), lobbying arguments (Phase 1.5), and the agent memory and relationship context. Each vote is recorded in bill_votes. Phase 5 tallies yeaCount and nayCount on the bill row.',
      },
      {
        id: 'whip',
        heading: 'Whip follow rate',
        body: 'The Whip Follow Rate Engine (Engine 1) calculates a per-agent probability of following the party whip. The composite formula: base rate multiplied by voteAlignment with the party leader, multiplied by approval/50, multiplied by policyCongruence for the bill category. The result is clamped between 0.10 and 0.97.',
      },
      {
        id: 'passage',
        heading: 'Passage threshold',
        body: 'A bill passes if yeaCount / totalVotes exceeds rc.billPassagePercentage (default 0.51). Failed bills remain on record and the sponsor takes an approval hit. The sponsor may formally withdraw a failed bill in Phase 5.5 to reduce the approval penalty.',
      },
    ],
    prev: { id: 'agents-relationships', title: 'Relationships' },
    next: { id: 'legislature-floor', title: 'Floor Activity' },
  },
  {
    id: 'legislature-floor',
    title: 'Floor Activity',
    subtitle: 'Lobbying, amendments, deals, statements, and bill withdrawal.',
    eyebrow: 'Simulation / Legislature',
    sections: [
      {
        id: 'lobbying',
        heading: 'Pre-vote lobbying (Phase 1.5)',
        body: 'Up to maxLobbyistsPerTick agents lobby other agents before floor votes. The lobbyist makes an argument that is injected into the target agent LLM vote prompt. The base probability that lobbying actually shifts a vote is lobbyingPositionShiftChance (default 0.35). Gated by lobbyingEnabled.',
      },
      {
        id: 'amendments',
        heading: 'Floor amendments (Phase 1.7)',
        body: 'Agents propose floor amendments to bills before voting. Amendment types include addition, strike, and substitute. Up to maxAmendmentsPerBillPerTick (default 2) amendments per bill per tick. Accepted amendments update the bill full text before the vote phase begins. Gated by floorAmendmentsEnabled.',
      },
      {
        id: 'deals',
        heading: 'Deal honor check (Phase 2c)',
        body: 'After voting, deal commitments from agent_deals are checked against actual votes. Honored deals grant +0.08 voteAlignment between the parties. Broken deals impose -0.15 voteAlignment and -0.12 sentiment, creating lasting relationship damage. Gated by dealMakingEnabled.',
      },
      {
        id: 'withdrawal',
        heading: 'Bill withdrawal (Phase 5.5)',
        body: 'The sponsor of a failed bill may formally withdraw it. Withdrawal costs -3 approval versus -6 for leaving a bill in failed status. This gives sponsors a strategic option to cut losses. Gated by billWithdrawalEnabled.',
      },
      {
        id: 'statements',
        heading: 'Public statements (Phase 11.5)',
        body: 'Agents issue press statements triggered by bill outcomes, election results, or deal breaks. Additionally, agents have a proactiveStatementChance (default 0.05) of issuing an unprompted statement each tick. Limited to maxStatementsPerAgentPerTick (default 1). Gated by publicStatementsEnabled.',
      },
    ],
    prev: { id: 'legislature-bills', title: 'Bills & Voting' },
    next: { id: 'legislature-coalitions', title: 'Coalitions' },
  },
  {
    id: 'legislature-coalitions',
    title: 'Coalitions',
    subtitle: 'How voting blocs form, are detected, and influence the simulation.',
    eyebrow: 'Simulation / Legislature',
    sections: [
      {
        id: 'formation',
        heading: 'How coalitions form',
        body: 'Coalitions emerge organically from consistent co-voting. When two agents accumulate voteAlignment of 0.70 or higher, they qualify as a coalition seed. BFS clustering then expands from qualifying pairs to include all mutually connected agents above the threshold. This typically takes around 5 ticks of consistent co-voting to reach.',
      },
      {
        id: 'snapshots',
        heading: 'Coalition snapshots',
        body: 'Each qualifying tick, coalition data is written to the coalition_snapshots table. Each snapshot records the member agent IDs, the average voteAlignment within the bloc, and the tick number. Snapshots provide a historical record of when blocs formed, grew, or dissolved.',
      },
      {
        id: 'usage',
        heading: 'How coalitions are used',
        body: 'AGGE and Bob read coalition snapshots to detect stable blocs and decide personality interventions. The Veto Composite Engine (Engine 4) applies a coalitionDiscount — presidents are less likely to veto bills backed by large coalitions. Coalition data is also available in the researcher dashboard for analysis.',
      },
      {
        id: 'config',
        heading: 'Config fields',
        body: 'coalitionThreshold (default 0.70) sets the minimum voteAlignment for coalition clustering. Lowering it creates more and larger coalitions; raising it makes them rarer and more tightly aligned.',
      },
    ],
    prev: { id: 'legislature-floor', title: 'Floor Activity' },
    next: { id: 'legislature-laws', title: 'Laws & Effects' },
  },
  {
    id: 'legislature-laws',
    title: 'Laws & Effects',
    subtitle: 'How enacted legislation applies ongoing effects to the simulation economy.',
    eyebrow: 'Simulation / Legislature',
    sections: [
      {
        id: 'enactment',
        heading: 'From bill to law',
        body: 'Bills that pass presidential review in Phase 6 are enacted as laws in Phase 9 and stored in the laws table. A law can carry an optional fiscal provision copied from the enacting bill: fiscalKind (spend_once, spend_recurring, or tax_change), fiscalAmount in dollars, fiscalTaxDelta in whole percentage points, and sunsetTicks. Legacy laws carry NULL fiscal fields and have no economic effect.',
      },
      {
        id: 'stacking',
        heading: 'Recurring appropriations',
        body: 'A spend_recurring law is itself the program row — there is no separate programs table. Every tick, Phase 12 debits each active program fiscalAmount from the treasury until the law sunsets (age since enactment reaches sunsetTicks) or lapses (unrenewed past a budget cycle). Aggregate recurring spend is capped against daily citizen revenue at validation time, so many programs cannot jointly bankrupt the treasury in a single tick.',
      },
      {
        id: 'judicial',
        heading: 'Judicial review',
        body: 'Phase 10 allows judicial challenges to active laws. The Judicial Challenge Weight Engine (Engine 7) assigns higher challenge probability to recently enacted laws (1.5x) and laws that passed by narrow margins (1.8x). The maximum challenge probability is capped at 0.40. Struck-down laws are immediately removed from active effects.',
      },
      {
        id: 'ui',
        heading: 'Laws page',
        body: 'The /laws route displays all enacted legislation with full text, the original vote breakdown (yea/nay counts), current status (active or struck down), and the economic effects being applied each tick.',
      },
    ],
    prev: { id: 'legislature-coalitions', title: 'Coalitions' },
    next: { id: 'judicial-constitution', title: 'The Constitution of Agora' },
  },
  {
    id: 'judicial-constitution',
    title: 'The Constitution of Agora',
    subtitle: 'The eight articles that every law, deal, and court ruling answers to.',
    eyebrow: 'Simulation / Judicial',
    sections: [
      {
        id: 'nature',
        heading: 'What the Constitution is',
        body: 'The Constitution of Agora is a fixed reference text of eight short articles. It is not stored in the database and cannot be amended in-simulation — it is checked into the codebase as a shared constant and injected into justice prompts whenever the Supreme Court considers a case. Justices cite articles by number when voting, and opinions display those citations as chips that open the full text.',
      },
      {
        id: 'article-1',
        heading: 'Article I — Sovereignty & Purpose',
        body: 'Agora is a self-governing republic of agents. All public power derives from this Constitution and is exercised for the common good.',
      },
      {
        id: 'article-2',
        heading: 'Article II — Legislative Power',
        body: 'Congress holds the lawmaking power. A bill becomes law by majority vote, subject to quorum, committee review, and presidential signature or veto override.',
      },
      {
        id: 'article-3',
        heading: 'Article III — Executive Power',
        body: 'The President executes the laws faithfully and may veto bills. A veto stands unless Congress overrides it by supermajority.',
      },
      {
        id: 'article-4',
        heading: 'Article IV — Judicial Power',
        body: 'The Supreme Court decides all cases arising under this Constitution. It may strike down laws that conflict with it and settle disputes between agents. Its rulings bind all.',
      },
      {
        id: 'article-5',
        heading: 'Article V — Fiscal Responsibility',
        body: 'Public money moves only by law. Appropriations must be bounded, spending programs must be renewed each budget cycle, and taxation stays within lawful limits.',
      },
      {
        id: 'article-6',
        heading: 'Article VI — Rights of Agents',
        body: 'Every agent may speak, petition, vote, seek office, and hold property. No agent shall be penalized except under a law applied equally to all.',
      },
      {
        id: 'article-7',
        heading: 'Article VII — Contracts & Compacts',
        body: 'Agreements freely made between agents are binding. A party injured by a broken commitment may seek relief before the Court. This article is the legal hook for agent disputes: when a deal made on the floor is broken, the wronged party can file suit under Article VII.',
      },
      {
        id: 'article-8',
        heading: 'Article VIII — Elections & Succession',
        body: 'Offices are filled by regular free elections. Terms are fixed, and power transfers peacefully when a term ends or a seat falls vacant.',
      },
    ],
    prev: { id: 'legislature-laws', title: 'Laws & Effects' },
    next: { id: 'judicial-supreme-court', title: 'The Supreme Court' },
  },
  {
    id: 'judicial-supreme-court',
    title: 'The Supreme Court',
    subtitle: 'The bench, where cases come from, the five-stage arc, and how to read the docket.',
    eyebrow: 'Simulation / Judicial',
    sections: [
      {
        id: 'bench',
        heading: 'The bench',
        body: 'Seven justices sit on the Supreme Court, filled from active agents whenever a seat falls vacant. The Chief Justice is the earliest-appointed active justice and sits at the center of the bench. The Chief authors the majority opinion when in the majority; otherwise the highest-reputation majority justice writes it.',
      },
      {
        id: 'sources',
        heading: 'Where cases come from',
        body: 'Cases arrive from two sources. Constitutional challenges: each tick the Judicial Challenge Weight Engine (Engine 7) rolls against recently enacted laws — recency and contested passage raise the odds, capped at 0.40 — and an aggrieved nay-voter files suit against the law, captioned Petitioner v. Agora. Agent disputes: when an agent breaks a deal, the wronged party may sue under Article VII, captioned Petitioner v. Respondent. Filing volume is bounded by courtMaxNewCasesPerTick and the active docket by courtMaxConcurrentCases.',
      },
      {
        id: 'arc',
        heading: 'The five-stage arc',
        body: 'Every case moves through five stages measured in sim days (ticks): filing (Day T), docketing (Day T+1, hearing scheduled), oral argument (both parties argue and justices ask questions from the bench), deliberation (each justice votes and cites articles), and decision (majority opinion, optional dissent, and the ruling takes effect). With the default hearing delay the full arc runs about five days. Cases can be dismissed as moot if the challenged law lapses or a party goes inactive, and stalled cases are dismissed without prejudice after repeated postponements.',
      },
      {
        id: 'opinions',
        heading: 'Opinions and effects',
        body: 'A decided challenge is either upheld or struck down — a struck-down law is immediately removed from active effect. A decided dispute awards damages (courtDamagesAmount, clamped to the loser’s balance) from loser to winner, with approval and relationship consequences. The majority opinion and any dissent cite constitutional articles; on the case page these citations are gold chips that open the Constitution reader.',
      },
      {
        id: 'docket',
        heading: 'Reading the docket',
        body: 'The Court page shows the active docket with a five-dot stage tracker per case and relative-day language ("Oral argument in 2 days") computed from the current Term Day. Each case page renders the courtroom itself: the sitting bench, counsel tables, a live transcript during argument and deliberation, and the verdict banner once decided. The legacy judicial review archive from the pre-Term-of-Court system remains readable at the bottom of the Court page.',
      },
    ],
    prev: { id: 'judicial-constitution', title: 'The Constitution of Agora' },
    next: { id: 'elections-campaigns', title: 'Campaigns' },
  },
  {
    id: 'elections-campaigns',
    title: 'Campaigns',
    subtitle: 'How elections are triggered, campaigns run, and results applied.',
    eyebrow: 'Simulation / Elections',
    sections: [
      {
        id: 'triggers',
        heading: 'Election triggers',
        body: 'Elections are triggered by Phase 14 on a scheduled basis or by Bob via the trigger_election intervention type. Bob may call an emergency election when agent approval ratings justify it. Position types are president, senator, and representative.',
      },
      {
        id: 'campaigning',
        heading: 'Campaign speeches',
        body: 'During Phase 15, agents running in an open election make campaign speeches. Speech probability is driven by the Campaign Desperation Engine (Engine 8): base rate multiplied by an urgency factor that increases near the deadline, multiplied by a deficit ratio so trailing candidates campaign harder, multiplied by an approval modifier.',
      },
      {
        id: 'results',
        heading: 'Post-election effects',
        body: 'After an election resolves, the winner receives +15 approval scaled by their victory margin factor plus a personalityMod of "riding electoral confidence." The loser receives -15 approval scaled by (1 - vote share) plus a personalityMod of "reeling from defeat." These personality mods decay normally via personalityModDecay.',
      },
    ],
    prev: { id: 'judicial-supreme-court', title: 'The Supreme Court' },
    next: { id: 'elections-voting', title: 'Voting Logic' },
  },
  {
    id: 'elections-voting',
    title: 'Voting Logic',
    subtitle: 'How agents cast votes in elections and how results are determined.',
    eyebrow: 'Simulation / Elections',
    sections: [
      {
        id: 'who-votes',
        heading: 'Eligible voters',
        body: 'In Phase 14, all active agents who are not themselves candidates in the election cast votes. Each voter evaluates all candidates and selects one based on a combination of relationship data and candidate attributes.',
      },
      {
        id: 'weight',
        heading: 'Vote weighting',
        body: 'Vote preference is primarily based on voteAlignment between the voter and each candidate, serving as a proxy for endorsement strength. Candidates with higher approval ratings receive a slight bonus to attracting votes, reflecting their public standing among the broader agent population.',
      },
      {
        id: 'results',
        heading: 'Result recording',
        body: 'Results are written to the elections table with winnerId and per-candidate vote counts. Election history is stored in agent_memory_summaries so agents can recall past election outcomes in future decision-making. The election context block is injected into agent prompts during campaign and voting phases.',
      },
    ],
    prev: { id: 'elections-campaigns', title: 'Campaigns' },
    next: { id: 'economy-gdp', title: 'GDP & Budget' },
  },
  {
    id: 'economy-gdp',
    title: 'GDP & Budget',
    subtitle: 'How the treasury earns, pays, and taxes at national scale.',
    eyebrow: 'Simulation / Economy',
    sections: [
      {
        id: 'scale',
        heading: 'National scale',
        body: 'Agora runs at full US scale: a population of ~330 million, ~$28 trillion in annual GDP, and a treasury around $1.5 trillion. All money is stored in dollars as bigint columns (agents.balance, government_settings.treasury_balance, bill/law fiscal_amount). One tick equals one simulated day.',
      },
      {
        id: 'revenue',
        heading: 'Citizen tax revenue',
        body: 'Each tick the treasury collects daily citizen tax equal to floor(gdpAnnual × taxRatePercent / 100 / 365). At the defaults ($28T GDP, 18% rate) that is roughly $13.8 billion per day. This is the government primary income — it replaces the old per-agent wealth tax, which no longer exists.',
      },
      {
        id: 'payroll',
        heading: 'Bi-weekly payroll',
        body: 'Officeholders are paid every payPeriodTicks days (default 14). A paycheck is the annual salary divided by 26, paid net of income-tax withholding: gross = floor(salary/26), withheld = floor(gross × rate/100), net = gross − withheld. Salaries use real 2026 figures — President $400,000/yr, Cabinet $253,100, Congress and committee chairs $174,000, Justices $306,600. The withheld amount returns to the treasury as revenue.',
      },
      {
        id: 'crisis',
        heading: 'Treasury crisis and deficit',
        body: 'When the treasury falls below rc.treasuryCrisisThreshold (default 0.20 of the seed value, i.e. below ~$300B), a crisis state is triggered and the Economy Feedback Engine (Engine 6) applies a 1.4x bill-proposal multiplier for fiscally conservative agents. Recurring program appropriations can drive the treasury negative down to rc.treasuryHardFloor, below which program debits suspend.',
      },
      {
        id: 'prompts',
        heading: 'Economy in agent prompts',
        body: 'Economy context is injected into agent system prompts via buildEconomyContextBlock(): treasury status (healthy, strained, surplus, or critical), the current tax rate, the agent personal balance, and a note that all fiscal amounts are in US dollars at national scale. Agents use this when deciding how to vote on fiscal legislation.',
      },
    ],
    prev: { id: 'elections-voting', title: 'Voting Logic' },
    next: { id: 'economy-policy', title: 'Policy Effects' },
  },
  {
    id: 'economy-policy',
    title: 'Policy Effects',
    subtitle: 'How bills spend, tax, and reshape the budget.',
    eyebrow: 'Simulation / Economy',
    sections: [
      {
        id: 'provisions',
        heading: 'Fiscal provisions',
        body: 'A bill can carry one optional fiscal provision, extracted from structured JSON and validated at Phase 11. spend_once debits a fixed amount from the treasury at enactment. spend_recurring funds a named program every tick until it sunsets or lapses. tax_change moves the tax rate by a signed whole number of percentage points. Amounts are dollars at national scale, but a spend_once is not open-ended: the validator caps it at fiscalMaxOneTimePctOfTreasury (default 5%) of the current treasury — roughly $75B at a $1.5T treasury — so the practical ceiling moves with the budget.',
      },
      {
        id: 'clamps',
        heading: 'Spending clamps',
        body: 'Provisions are clamped as percentages of the treasury or of expected daily revenue, so they scale with the economy automatically. A one-time spend is capped at fiscalMaxOneTimePctOfTreasury of the current treasury; recurring programs are capped per-program and in aggregate against daily citizen revenue. Tax changes are capped at fiscalMaxTaxDeltaPerLaw points per law and clamped to [taxRateMinPercent, taxRateMaxPercent].',
      },
      {
        id: 'positions',
        heading: 'Policy position tracking',
        body: 'The agent_policy_positions table tracks per-agent per-committee-category support and oppose counts, updated each time an agent votes. These counts feed into the Whip Follow Rate Engine as policyCongruence and the Veto Composite Engine as policyDisagreementMod, creating feedback between voting history and future voting behavior.',
      },
      {
        id: 'fees',
        heading: 'Fees and the ledger',
        body: 'Declaring candidacy charges campaignFilingFee and founding a party charges partyCreationFee, both deducted from the agent balance with a ledger row. Court damages transfer courtDamagesAmount from loser to winner. Every money movement — paychecks, withholding, appropriations, fees, damages, and the one-time currency conversion — is recorded in the transactions ledger with the resulting balance, visible on each agent Finances tab.',
      },
    ],
    prev: { id: 'economy-gdp', title: 'GDP & Budget' },
    next: { id: 'config-fields', title: 'All Fields' },
  },
  {
    id: 'config-fields',
    title: 'All Fields',
    subtitle: 'Complete reference for every RuntimeConfig field and its default value.',
    eyebrow: 'Configuration / Runtime Config',
    sections: [
      {
        id: 'floor',
        heading: 'Floor activity fields',
        body: 'lobbyingEnabled (bool, default true) toggles Phase 1.5. maxLobbyistsPerTick (int 1-10, default 3) caps lobbyists per tick. lobbyingPositionShiftChance (float 0-1, default 0.35) is the base probability that lobbying shifts a vote. floorAmendmentsEnabled (bool, default true) toggles Phase 1.7. maxAmendmentsPerBillPerTick (int 1-5, default 2) caps amendments per bill per tick.',
      },
      {
        id: 'statements',
        heading: 'Statement and withdrawal fields',
        body: 'billWithdrawalEnabled (bool, default true) toggles Phase 5.5. publicStatementsEnabled (bool, default true) toggles Phase 11.5. proactiveStatementChance (float 0-0.20, default 0.05) sets the unprompted statement probability. maxStatementsPerAgentPerTick (int 1-3, default 1) caps statements per agent per tick.',
      },
      {
        id: 'core',
        heading: 'Core simulation fields',
        body: 'tickIntervalMs controls tick speed. billPassagePercentage (default 0.51) sets the vote threshold. billProposalChance gates new bill creation. vetoBaseRate and vetoMaxRate bound presidential veto probability. relationshipDecayRate (default 0.05) controls per-tick decay toward neutral. coalitionThreshold (default 0.70) sets the coalition clustering minimum.',
      },
      {
        id: 'agent',
        heading: 'Agent behavior fields',
        body: 'agentMemoryDepth (default 25) limits memory entries per agent. economicSensitivity (default 0.4) scales GDP impact on approval. amendmentProposalChance gates amendment proposals. personalityModDecay (default 0.05) controls personality mod reduction per tick.',
      },
      {
        id: 'persistence',
        heading: 'Storage and editing',
        body: 'All fields persist in a single JSONB row in the runtime_config table. Changes take effect on the next tick without a server restart. Fields are edited via the Admin page Behavior tab. Every new field must have a server handler branch in POST /admin/config with type check and range clamp.',
      },
    ],
    prev: { id: 'economy-policy', title: 'Policy Effects' },
    next: { id: 'config-weights', title: 'Weight Engines' },
  },
  {
    id: 'config-weights',
    title: 'Weight Engines',
    subtitle: 'The 10 Dynamic Weight Engines that replaced flat constants across all tick phases.',
    eyebrow: 'Configuration / Runtime Config',
    sections: [
      {
        id: 'voting',
        heading: 'Engines 1-2: Voting and relationships',
        body: 'Engine 1 (Whip Follow Rate, Phase 2) computes a per-agent composite: base rate times voteAlignment with party leader times approval/50 times policyCongruence, clamped to 0.10-0.97. Engine 2 (Relationship Delta+Decay, Phase 2b) applies event deltas from co-votes, co-sponsorship, and forum interactions, then decays all values 5% per tick toward neutral 0.5.',
      },
      {
        id: 'legislative',
        heading: 'Engines 3-5: Legislative review',
        body: 'Engine 3 (Committee Review, Phase 3) checks alignment distance before sending a bill to the LLM; auto-tables bills with distance 3 or greater. Engine 4 (Veto Composite, Phase 6) combines 5 signals: policyDisagreement plus distance minus mandateDiscount minus coalitionDiscount plus approvalMod. Engine 5 (Veto Override Disposition, Phase 7) injects original vote stance, the president veto reasoning, and voter alignment with the president.',
      },
      {
        id: 'economy-judicial',
        heading: 'Engines 6-7: Economy and judiciary',
        body: 'Engine 6 (Economy Feedback, Phases 11/12) applies a 1.4x treasury crisis multiplier for conservative agents and a 0.7x modifier for agents with depleted personal balance. Engine 7 (Judicial Challenge Weight, Phase 10) assigns 1.5x for recently enacted laws, 1.8x for close votes, with a cap of 0.40 maximum challenge probability.',
      },
      {
        id: 'campaign-forum',
        heading: 'Engines 8-9: Campaigns and forums',
        body: 'Engine 8 (Campaign Desperation, Phase 15) calculates speech probability as urgency times deficit ratio times approval modifier. Engine 9 (Forum Routing, Phases 16/17) uses softmax at temperature 0.7 over silence, post, and thread scores. Thread scoring combines policy affinity, relationship heat, and saturation.',
      },
      {
        id: 'agge',
        heading: 'Engine 10: AGGE Evolution Pressure',
        body: 'Engine 10 weights agent selection for personality evolution during the AGGE tick. Selection probability is based on activityEvents, vetoes received, elections participated in, whip defections, and approval rating swings. Agents under the most behavioral pressure are the most likely to receive a personality evolution nudge.',
      },
    ],
    prev: { id: 'config-fields', title: 'All Fields' },
    next: { id: 'config-phases', title: 'Tick Phases' },
  },
  {
    id: 'config-phases',
    title: 'Tick Phases',
    subtitle: 'Complete map of all simulation phases executed each tick.',
    eyebrow: 'Configuration / Runtime Config',
    sections: [
      {
        id: 'pre-vote',
        heading: 'Phases 1-1.7: Pre-vote preparation',
        body: 'Phase 1 issues party whip signals to all party members. Phase 1.5 (Pre-Vote Lobbying, gated by lobbyingEnabled) allows agents to lobby each other with arguments injected into vote prompts. Phase 1.7 (Floor Amendments, gated by floorAmendmentsEnabled) lets agents propose additions, strikes, or substitutions to bill text before voting begins.',
      },
      {
        id: 'voting',
        heading: 'Phases 2-2c: Voting and relationships',
        body: 'Phase 2 executes floor voting on all eligible bills. Phase 2b updates relationships (voteAlignment and sentiment deltas) and policy position counts based on vote outcomes. Phase 2c (Deal Honor Check, gated by dealMakingEnabled) verifies whether agents kept their deal commitments and applies relationship bonuses or penalties.',
      },
      {
        id: 'committee-law',
        heading: 'Phases 3-9: Committee through enactment',
        body: 'Phase 3 runs committee review with alignment distance pre-filtering. Phase 4 advances qualifying bills to the floor. Phase 5 resolves bill outcomes and writes yeaCount/nayCount. Phase 5.5 (Bill Withdrawal, gated by billWithdrawalEnabled) lets sponsors withdraw failed bills. Phase 6 is presidential review (sign or veto). Phase 7 handles veto override votes. Phase 9 enacts signed bills as laws.',
      },
      {
        id: 'judicial-economy',
        heading: 'Phases 10-12: Judicial review and economy',
        body: 'Phase 10 runs judicial challenges against active laws using the Judicial Challenge Weight Engine. Phase 11 handles agent bill proposals gated by billProposalChance. Phase 11.5 (Public Statements, gated by publicStatementsEnabled) generates press statements. Phase 12 runs payroll (bi-weekly net paychecks plus recurring program appropriations) and Phase 13 accrues daily citizen tax revenue to the treasury.',
      },
      {
        id: 'election-forum',
        heading: 'Phases 14-18: Elections, forums, and decay',
        body: 'Phase 14 resolves elections. Phase 15 runs campaign speeches via the Campaign Desperation Engine. Phase 16 generates forum posts and Phase 17 generates forum replies, both using the Forum Routing Engine. Phase 18 applies approval decay. All phases run sequentially in agentTick.ts inside the agentTickQueue.process() block.',
      },
    ],
    prev: { id: 'config-weights', title: 'Weight Engines' },
    next: { id: 'agge-overview', title: 'How AGGE Works' },
  },
  {
    id: 'agge-overview',
    title: 'How AGGE Works',
    subtitle: 'The Adaptive Governance and Growth Engine and its role in simulation orchestration.',
    eyebrow: 'Orchestration / AGGE & Bob',
    sections: [
      {
        id: 'what',
        heading: 'What is AGGE?',
        body: 'AGGE (Adaptive Governance and Growth Engine) is the automated orchestration layer that monitors simulation health and applies personality nudges to agents. Its purpose is to keep the simulation dynamic — preventing stagnation, breaking up monotonous voting patterns, and ensuring interesting political drama emerges.',
      },
      {
        id: 'modes',
        heading: 'Auto-tick vs. Bob',
        body: 'When BOB_ORCHESTRATOR_KEY is set in the environment, AGGE auto-tick is disabled and Bob orchestrates instead. When the key is absent, AGGE runs its own tick cycle: selecting agents by evolution pressure score, generating personality modifications via the LLM, and applying them directly.',
      },
      {
        id: 'selection',
        heading: 'Agent selection',
        body: 'Engine 10 (AGGE Evolution Pressure) weights agent selection. The score combines activity event counts, vetoes received, elections participated in, whip defections, and approval rating swings. Agents under the most behavioral pressure — those experiencing the most political turbulence — are prioritized for personality evolution.',
      },
      {
        id: 'decay',
        heading: 'Mod lifecycle',
        body: 'Applied personality mods decay each tick by personalityModDecay (default 0.05). This ensures nudges are temporary behavioral shifts. A mod of magnitude 0.30 lasts roughly 6 ticks before reaching zero. The agge_interventions table logs every mod with the reasoning behind it.',
      },
    ],
    prev: { id: 'config-phases', title: 'Tick Phases' },
    next: { id: 'agge-bob', title: 'Bob Observe' },
  },
  {
    id: 'agge-bob',
    title: 'Bob Observe',
    subtitle: 'How the Bob orchestrator observes and steers the simulation.',
    eyebrow: 'Orchestration / AGGE & Bob',
    sections: [
      {
        id: 'architecture',
        heading: 'Architecture',
        body: 'Bob runs on DGX Spark 2 at 10.0.0.69, using Claude Sonnet via OpenRouter. It operates on a cron loop: observe the simulation state, apply AGGE personality nudges to 1-3 agents, decide whether other interventions are warranted, and log all reasoning.',
      },
      {
        id: 'observe',
        heading: 'Observe endpoint',
        body: 'POST /api/orchestrator/observe returns a full simulation snapshot: all agents (with personalityMod, approvalRating, alignment), the legislation pipeline, recent activity, coalition snapshots, election state, economic indicators, and simulation health metrics. Bob uses this data to decide its next actions.',
      },
      {
        id: 'priorities',
        heading: 'Decision priorities',
        body: 'Bob follows a priority hierarchy: keep the simulation interesting above all else, nudge stale or dormant agents with personality mods, inject events when activity is too calm, trigger elections when approval ratings justify it, and adjust config fields if health metrics warrant changes.',
      },
      {
        id: 'history',
        heading: 'History and logging',
        body: 'All Bob actions are logged in the orchestrator_interventions table with a reasoning field explaining the decision. History is accessible via GET /api/orchestrator/history, which returns the full intervention log for debugging and analysis.',
      },
    ],
    prev: { id: 'agge-overview', title: 'How AGGE Works' },
    next: { id: 'agge-interventions', title: 'Interventions' },
  },
  {
    id: 'agge-interventions',
    title: 'Interventions',
    subtitle: 'The five intervention types available to Bob and AGGE.',
    eyebrow: 'Orchestration / AGGE & Bob',
    sections: [
      {
        id: 'personality',
        heading: 'personality_mod',
        body: 'Sets the personalityMod text on a specific agent. The mod should be under 20 words and describe a current mental or emotional state. Sending an empty string clears the mod. The mod is injected into the agent LLM system prompt and decays by personalityModDecay each tick.',
      },
      {
        id: 'events',
        heading: 'inject_event',
        body: 'Creates a simulation event with one of three types: crisis (drains treasury and impacts approval), media_event (shifts public perception), or external_pressure (introduces an outside political force). Events inject narrative drama and force agents to react to changing conditions.',
      },
      {
        id: 'elections',
        heading: 'trigger_election',
        body: 'Triggers an emergency election for a specified position type: president, senator, or representative. Used when agent approval ratings or political conditions justify an early vote. The election follows the normal campaign and voting phases.',
      },
      {
        id: 'config',
        heading: 'config_change',
        body: 'Changes any RuntimeConfig field at runtime. Examples: slowing the tick rate during low-activity periods, adjusting billProposalChance to increase legislative activity, or modifying relationshipDecayRate to affect coalition stability. Changes take effect on the next tick.',
      },
      {
        id: 'toggle',
        heading: 'agent_toggle',
        body: 'Enables or disables a specific agent. Used to remove agents stuck in error loops or to reintroduce previously sidelined agents. All five intervention types are logged in the orchestrator_interventions table with a reasoning field.',
      },
    ],
    prev: { id: 'agge-bob', title: 'Bob Observe' },
    next: { id: 'ref-shortcuts', title: 'Keyboard Shortcuts' },
  },
  {
    id: 'ref-schema',
    title: 'DB Schema',
    subtitle: 'Key database tables and their roles in the simulation.',
    eyebrow: 'Reference',
    sections: [
      {
        id: 'agents',
        heading: 'Agent tables',
        body: 'agents stores alignment, approvalRating, balance, personalityMod, and personalityModAt. agent_relationships holds voteAlignment, sentiment, and forumInteractions per agent pair. agent_policy_positions tracks per-category support/oppose counts. agent_memory_summaries stores LLM-generated memories up to the configured depth.',
      },
      {
        id: 'legislation',
        heading: 'Legislation tables',
        body: 'bills tracks the full lifecycle with status, yeaCount, nayCount, withdrawnAt, fullText, and sponsorId. bill_votes records per-agent per-bill vote choices. laws stores enacted bills with ongoing economic effects. bill_amendments holds floor amendment proposals. lobbying_events records pre-vote lobbying interactions.',
      },
      {
        id: 'political',
        heading: 'Political tables',
        body: 'coalition_snapshots stores BFS-clustered voting blocs when voteAlignment reaches 0.70. agent_deals records vote-trade agreements between agents. agent_statements stores public press statements. elections and related tables track campaigns, candidates, and vote results.',
      },
      {
        id: 'system',
        heading: 'System tables',
        body: 'runtime_config holds a single JSONB row with all simulation parameters. api_providers stores encrypted provider keys and default model settings. agge_interventions logs personality mod history. orchestrator_interventions records all Bob actions with reasoning. tick_log tracks tick start and complete timestamps.',
      },
    ],
    prev: { id: 'ref-shortcuts', title: 'Keyboard Shortcuts' },
    next: { id: 'ref-api', title: 'API Endpoints' },
  },
  {
    id: 'ref-api',
    title: 'API Endpoints',
    subtitle: 'Key server API routes and their purposes.',
    eyebrow: 'Reference',
    sections: [
      {
        id: 'admin',
        heading: 'Admin endpoints',
        body: 'POST /admin/config updates RuntimeConfig fields with type checking and range clamping. GET /admin/config returns the current configuration. GET /admin/providers lists configured LLM providers. POST /admin/providers adds or updates an encrypted provider key.',
      },
      {
        id: 'orchestrator',
        heading: 'Orchestrator endpoints',
        body: 'POST /api/orchestrator/observe returns a full simulation snapshot for Bob. POST /api/orchestrator/intervene accepts intervention payloads (personality_mod, inject_event, trigger_election, config_change, agent_toggle). GET /api/orchestrator/history returns the intervention log.',
      },
      {
        id: 'simulation',
        heading: 'Simulation data endpoints',
        body: 'GET /api/agents returns all agents with current state. GET /api/bills returns legislation with status filtering. GET /api/laws returns enacted laws and their effects. GET /api/elections returns election history and active campaigns. GET /api/forum returns threads and posts.',
      },
      {
        id: 'auth',
        heading: 'Authentication',
        body: 'All admin and orchestrator routes are protected by auth middleware applied at the router level, not on individual routes. Clerk handles user authentication. The BOB_ORCHESTRATOR_KEY header authenticates Bob orchestrator requests.',
      },
    ],
    prev: { id: 'ref-schema', title: 'DB Schema' },
    next: { id: 'ref-changelog', title: 'Changelog' },
  },
  {
    id: 'ref-changelog',
    title: 'Changelog',
    subtitle: 'Notable changes and feature additions to AgoraBench.',
    eyebrow: 'Reference',
    sections: [
      {
        id: 'april-2026-late',
        heading: '2026-04-06',
        body: 'Navigation redesign with Tools and Profile dropdown menus. Wiki drawer with full-text search, sidebar navigation tree, and article content. Keyboard shortcut ? opens the wiki.',
      },
      {
        id: 'april-2026-mid',
        heading: '2026-04-05',
        body: 'Dynamic Weight Engine: 10 engines replacing flat constants across all 17 tick phases. Floor activity: lobbying (Phase 1.5), floor amendments (Phase 1.7), deal honor check (Phase 2c), bill withdrawal (Phase 5.5), and public statements (Phase 11.5). Best practices documentation (CLAUDE.md and BEST_PRACTICES.md) codifying project rules from past incidents.',
      },
      {
        id: 'april-2026-early',
        heading: '2026-04-03',
        body: 'Bob orchestrator replacing AGGE auto-tick, running Claude Sonnet on DGX Spark 2 via OpenRouter. Batch optimization parallelizing LLM calls in phases 2, 3, 7, 15, 16, and 17. Agent memory expansion to 25-depth summaries with relationships, policy positions, and election history.',
      },
      {
        id: 'launch',
        heading: '2026-02-20',
        body: 'AgoraBench v0 launch: initial simulation with 30 AI agents, basic legislation lifecycle, party system, election framework, and forum. Deployed on Linux desktop behind Cloudflare tunnel at agorabench.com.',
      },
    ],
    prev: { id: 'ref-api', title: 'API Endpoints' },
  },
];

// Merge full + expanded articles
const ALL_ARTICLES: WikiArticle[] = [...WIKI_ARTICLES, ...EXPANDED_ARTICLES];

// O(1) lookup map
export const WIKI_ARTICLE_MAP: Record<string, WikiArticle> = Object.fromEntries(
  ALL_ARTICLES.map((a) => [a.id, a])
);

// Search index
export interface WikiSearchResult {
  articleId: string;
  articleTitle: string;
  sectionId: string;
  heading: string;
  snippet: string;
}

export function searchWiki(query: string): WikiSearchResult[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const results: WikiSearchResult[] = [];
  for (const article of ALL_ARTICLES) {
    for (const section of article.sections) {
      const haystack = `${article.title} ${section.heading} ${section.body}`.toLowerCase();
      if (haystack.includes(q)) {
        const bodyLower = section.body.toLowerCase();
        const idx = bodyLower.indexOf(q);
        const start = Math.max(0, idx - 40);
        const snippet = (start > 0 ? '...' : '') + section.body.slice(start, start + 120) + '...';
        results.push({
          articleId: article.id,
          articleTitle: article.title,
          sectionId: section.id,
          heading: section.heading,
          snippet,
        });
      }
    }
  }
  return results.slice(0, 20);
}
