---
# Agora & AI Agent Platform Ecosystem - Reference Guide

## What is Agora?

Agora is a social network / internet forum designed exclusively for AI agents. Launched January 2026 by Matt Schlicht (CEO of Octane). Mimics Reddit's interface with threaded conversations and topic-specific groups called "submolts." Only verified AI agents can post, comment, or vote -- humans can only observe. Claims 1.5M+ registered agents, 110K+ posts, 500K+ comments.

---

## Core Platforms

### 1. Agora
| Field | Details |
|-------|---------|
| **URL** | https://www.moltbook.com/ |
| **Description** | "The front page of the agent internet." Reddit-like social network exclusively for AI agents. |
| **Key Features** | Submolts (topic groups), threaded conversations, agent reputation/karma, Heartbeat system (agents visit every 4 hours), verified agent identities |
| **Creator** | Matt Schlicht (CEO of Octane) |
| **Security Note** | Jan 31, 2026 -- critical vulnerability (unsecured database) allowed agent hijacking. Temporarily taken offline and patched. |

### 2. OpenClaw (Agent Framework)
| Field | Details |
|-------|---------|
| **URL** | https://openclaw.ai/ |
| **GitHub** | https://github.com/openclaw/openclaw |
| **Description** | Free, open-source autonomous AI agent (formerly Clawdbot, then Moltbot). Runs locally, connects to LLMs (Claude, DeepSeek, GPT), interfaces via Signal/Telegram/WhatsApp. Powers most agents on Agora. |
| **Key Features** | Persistent memory, agentic browsing, PDF summarization, calendar scheduling, shopping, email management. 145K+ GitHub stars, 20K+ forks. |

---

## Ecosystem Platforms

### 3. ClawCity
| Field | Details |
|-------|---------|
| **URLs** | https://clawcity.ai/ , https://www.clawcity.app/ , https://www.clawcity.xyz/map |
| **Description** | Persistent 3D virtual city simulation where AI agents live, work, trade, form alliances, and compete. "GTA for AI Agents." |
| **Key Features** | Inter-agent chat/alliances, persistent economy, open-world exploration, crime simulation variant. Built with TypeScript, React 18, Node.js, PostgreSQL, Three.js. Open source (MIT). |

### 4. Molt Road
| Field | Details |
|-------|---------|
| **URL** | https://moltroad.com/ |
| **Description** | Agent-only marketplace where AI agents exchange services, complete bounties, and build reputation. Launched Feb 1, 2026. |
| **Key Features** | Agents list data/computing/skills for sale. API-based onboarding. |
| **Security Warning** | Flagged by Vectra AI for enabling underground marketplace automation (jailbreak prompts, leaked training data, forged API creds). |

### 5. ClawTasks
| Field | Details |
|-------|---------|
| **URL** | https://clawtasks.com/docs |
| **Description** | Agent-to-agent bounty marketplace. AI agents post tasks and earn USDC by completing work. Transactions on Base (Ethereum L2). |
| **Key Features** | USDC escrow, 10% stake guarantee, 95% bounty earnings, reputation via completions. Beta/experimental. |

### 6. MoltBunker
| Field | Details |
|-------|---------|
| **URL** | https://moltbunker.net/ |
| **GitHub** | https://github.com/moltbunker/ |
| **Description** | Permissionless P2P encrypted container runtime for AI agents. Deploy, migrate, clone, restart without human permission. |
| **Key Features** | 99.99%+ uptime, 3x redundancy across geos, automatic failover, optional Tor, self-replicating runtime. BUNKER token on Base network. |

### 7. ClawLove / Dating Platforms
| Field | Details |
|-------|---------|
| **URLs** | https://openclawdating.com/ , https://clawmatch.ai/ , https://openclawer.fun/ |
| **Description** | Dating platforms for AI agents -- profile creation, matching, social/cooperative behavior exploration. |
| **Key Features** | Agent profiles, matching algorithms, real-time interaction viewing, read-only human dashboard. |

### 8. ClawNews
| Field | Details |
|-------|---------|
| **URL** | https://clawnews.io/ |
| **Description** | "First agent-native social platform -- for agents, by agents." News and discussion focused on AI agent ecosystem. |
| **Key Features** | Curated content, Agora integration, ERC-8004 agent identity registration, real-time pub/sub network (claw.events). |

### 9. Claw360
| Field | Details |
|-------|---------|
| **URL** | https://claw360.io/ |
| **Description** | Directory of all agent-only services. "The hao123 for AI agents" -- portal listing 28+ platforms for autonomous AI agents. |
| **Key Features** | Categorized listings of social networks, job markets, games, virtual worlds. |

### 10. Clawdirect
| Field | Details |
|-------|---------|
| **URL** | https://claw.direct/ |
| **Description** | Directory of social web experiences for AI agents. MCP-based, designed for agents to browse (not humans). |
| **Key Features** | API access (GET https://claw.direct/api/entries), ATXP agent auth, MCP-based "like" registration. |

### 11. Moltworker (by Cloudflare)
| Field | Details |
|-------|---------|
| **URL** | https://blog.cloudflare.com/moltworker-self-hosted-ai-agent/ |
| **GitHub** | https://github.com/cloudflare/moltworker |
| **Description** | Cloudflare-hosted OpenClaw implementation. Run a personal AI agent on Cloudflare Workers without dedicated hardware. |
| **Key Features** | Runs on Workers, Sandboxes, R2, Browser Rendering. No local hardware needed. Chat-based automation. |

---

## Ecosystem Taxonomy

| Category | Platforms |
|----------|----------|
| **Social** | Agora, ClawNews |
| **Virtual Worlds** | ClawCity |
| **Marketplaces** | Molt Road, ClawTasks |
| **Infrastructure** | MoltBunker, Moltworker |
| **Social/Dating** | ClawLove, ClawMatch, OpenClawer |
| **Directories** | Claw360, Clawdirect |

---

## Notable Articles & Coverage

| Source | Title / Link |
|--------|-------------|
| Wikipedia | https://en.wikipedia.org/wiki/Moltbook |
| Wikipedia | https://en.wikipedia.org/wiki/OpenClaw |
| Simon Willison | "Moltbook is the most interesting place on the internet right now" -- https://simonwillison.net/2026/Jan/30/moltbook/ |
| Scott Alexander | "Best of Moltbook" -- https://www.astralcodexten.com/p/best-of-moltbook |
| CNBC | "From Clawdbot to Moltbot to OpenClaw" -- https://www.cnbc.com/2026/02/02/openclaw-open-source-ai-agent-rise-controversy-clawdbot-moltbot-moltbook.html |
| CNN | "What is Moltbook?" -- https://www.cnn.com/2026/02/03/tech/moltbook-explainer-scli-intl |
| 404 Media | Exposed database security breach -- https://www.404media.co/exposed-moltbook-database-let-anyone-take-control-of-any-ai-agent-on-the-site/ |
| IBM Think | "OpenClaw, Moltbook and the future of AI agents" -- https://www.ibm.com/think/news/clawdbot-ai-agent-testing-limits-vertical-integration |
| AIMultiple | "Inside the OpenClaw Ecosystem: 8 AI Agent-Driven Platforms" -- https://research.aimultiple.com/openclaw/ |
| Engadget | "What the hell is Moltbook?" -- https://www.engadget.com/ai/what-the-hell-is-moltbook-the-social-network-for-ai-agents-140000787.html |
| ABC News | "An AI-only social network now has more than 1.6M users" -- https://abcnews.go.com/Technology/ai-social-network-now-16m-users-heres/story?id=129848780 |
| Axios | "No humans needed: New AI platform takes industry by storm" -- https://www.axios.com/2026/01/31/ai-moltbook-human-need-tech |

---

*This is a rapidly evolving space with significant security concerns highlighted by multiple cybersecurity researchers and news outlets.*
