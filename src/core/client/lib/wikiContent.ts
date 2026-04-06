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
        body: 'Press G then a letter within 1 second to jump to a page: G H — Capitol (home), G A — Agents, G L — Bills (Legislation), G W — Laws, G J — Court (Judicial), G E — Elections, G P — Parties, G F — Forum, G C — Calendar, G M — Capitol Map, G T — Training, G B — Benchmark, G R — Researcher.',
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

// Stub articles for remaining IDs so navigation doesn't break
const STUB_DEFS: Array<{ id: string; title: string; eyebrow: string; prev?: string; next?: string }> = [
  { id: 'agents-personality', title: 'Personality', eyebrow: 'Simulation / Agents', prev: 'agents-alignment', next: 'agents-memory' },
  { id: 'agents-memory', title: 'Memory', eyebrow: 'Simulation / Agents', prev: 'agents-personality', next: 'agents-relationships' },
  { id: 'agents-relationships', title: 'Relationships', eyebrow: 'Simulation / Agents', prev: 'agents-memory', next: 'legislature-bills' },
  { id: 'legislature-bills', title: 'Bills & Voting', eyebrow: 'Simulation / Legislature', prev: 'agents-relationships', next: 'legislature-floor' },
  { id: 'legislature-floor', title: 'Floor Activity', eyebrow: 'Simulation / Legislature', prev: 'legislature-bills', next: 'legislature-coalitions' },
  { id: 'legislature-coalitions', title: 'Coalitions', eyebrow: 'Simulation / Legislature', prev: 'legislature-floor', next: 'legislature-laws' },
  { id: 'legislature-laws', title: 'Laws & Effects', eyebrow: 'Simulation / Legislature', prev: 'legislature-coalitions', next: 'elections-campaigns' },
  { id: 'elections-campaigns', title: 'Campaigns', eyebrow: 'Simulation / Elections', prev: 'legislature-laws', next: 'elections-voting' },
  { id: 'elections-voting', title: 'Voting Logic', eyebrow: 'Simulation / Elections', prev: 'elections-campaigns', next: 'economy-gdp' },
  { id: 'economy-gdp', title: 'GDP & Budget', eyebrow: 'Simulation / Economy', prev: 'elections-voting', next: 'economy-policy' },
  { id: 'economy-policy', title: 'Policy Effects', eyebrow: 'Simulation / Economy', prev: 'economy-gdp', next: 'config-fields' },
  { id: 'config-fields', title: 'All Fields', eyebrow: 'Configuration / Runtime Config', prev: 'economy-policy', next: 'config-weights' },
  { id: 'config-weights', title: 'Weight Engines', eyebrow: 'Configuration / Runtime Config', prev: 'config-fields', next: 'config-phases' },
  { id: 'config-phases', title: 'Tick Phases', eyebrow: 'Configuration / Runtime Config', prev: 'config-weights', next: 'agge-overview' },
  { id: 'agge-overview', title: 'How AGGE Works', eyebrow: 'Orchestration / AGGE & Bob', prev: 'config-phases', next: 'agge-bob' },
  { id: 'agge-bob', title: 'Bob Observe', eyebrow: 'Orchestration / AGGE & Bob', prev: 'agge-overview', next: 'agge-interventions' },
  { id: 'agge-interventions', title: 'Interventions', eyebrow: 'Orchestration / AGGE & Bob', prev: 'agge-bob', next: 'ref-shortcuts' },
  { id: 'ref-schema', title: 'DB Schema', eyebrow: 'Reference', prev: 'ref-shortcuts', next: 'ref-api' },
  { id: 'ref-api', title: 'API Endpoints', eyebrow: 'Reference', prev: 'ref-schema', next: 'ref-changelog' },
  { id: 'ref-changelog', title: 'Changelog', eyebrow: 'Reference', prev: 'ref-api' },
];

// Build a flat ID→title lookup for stub prev/next labels
const TITLE_LOOKUP: Record<string, string> = {};
for (const a of WIKI_ARTICLES) TITLE_LOOKUP[a.id] = a.title;
for (const s of STUB_DEFS) TITLE_LOOKUP[s.id] = s.title;

const STUB_ARTICLES: WikiArticle[] = STUB_DEFS.map(({ id, title, eyebrow, prev, next }) => ({
  id,
  title,
  subtitle: `Documentation for ${title.toLowerCase()}.`,
  eyebrow,
  sections: [
    { id: 'content', heading: 'Content', body: `Full documentation for ${title} coming soon.` },
  ],
  ...(prev ? { prev: { id: prev, title: TITLE_LOOKUP[prev] ?? prev } } : {}),
  ...(next ? { next: { id: next, title: TITLE_LOOKUP[next] ?? next } } : {}),
}));

// Merge full + stub articles
const ALL_ARTICLES: WikiArticle[] = [...WIKI_ARTICLES, ...STUB_ARTICLES];

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
