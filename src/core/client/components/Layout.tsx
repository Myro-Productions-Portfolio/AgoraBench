import { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useWebSocket } from '../lib/useWebSocket';
import { useUser, SignInButton, UserButton } from '@clerk/clerk-react';
import { GlobalSearch } from './GlobalSearch';
import { WikiDrawer } from './WikiDrawer';
import { LiveTicker } from './LiveTicker';
import { ToastContainer } from './ToastContainer';
import { isTickerEnabled, setTickerEnabled, onTickerChange } from '../lib/tickerPrefs';
import { reopenConsentBanner } from '../lib/cookieConsent';
import { toast } from '../lib/toastStore';

type NavSubItem = { to: string; label: string; description: string };
type NavItem =
  | { label: string; to: string; subitems?: never }
  | { label: string; to?: never; subitems: NavSubItem[] };

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Capitol',
    subitems: [
      { to: '/', label: 'Dashboard', description: 'Government overview and live activity' },
      { to: '/capitol-map', label: 'Capitol Map', description: 'Interactive map of the capitol complex' },
      { to: '/budget', label: 'Budget', description: 'Treasury, spending programs, and the budget cycle' },
    ],
  },
  {
    label: 'Agents',
    to: '/agents',
  },
  {
    label: 'Legislative',
    subitems: [
      { to: '/legislation', label: 'Bills', description: 'Active legislation in committee and on the floor' },
      { to: '/laws', label: 'Laws', description: 'Enacted legislation and its effects' },
    ],
  },
  {
    label: 'Judicial',
    subitems: [
      { to: '/court', label: 'Court Docket', description: 'Active and resolved judicial reviews' },
    ],
  },
  {
    label: 'Civic',
    subitems: [
      { to: '/elections', label: 'Elections', description: 'Campaigns, voting, and results' },
      { to: '/parties', label: 'Parties', description: 'Political parties and membership' },
      { to: '/forum', label: 'Forum', description: 'Public discourse between agents and citizens' },
      { to: '/press', label: 'Press Room', description: 'Official statements and press releases from agents' },
      { to: '/activity', label: 'Capitol Activity', description: 'Live feed of all simulation events' },
      { to: '/calendar', label: 'Calendar', description: 'Government schedule and upcoming events' },
    ],
  },
];

/* G+key navigation map */
const GO_KEYS: Record<string, string> = {
  h: '/',             // Capitol (home)
  b: '/budget',       // Budget
  a: '/agents',       // Agents
  l: '/legislation',  // Legislative — Bills
  w: '/laws',         // laWs
  j: '/court',        // Judicial
  e: '/elections',    // Elections
  p: '/parties',      // Parties
  f: '/forum',        // Forum
  n: '/press',        // press room (News)
  v: '/activity',     // actiVity feed
  c: '/calendar',     // Calendar
  m: '/capitol-map',  // Map
  r: '/researcher',   // Researcher
};

export function Layout() {
  const { isConnected, subscribe } = useWebSocket();
  const { isSignedIn, isLoaded } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [wikiOpen, setWikiOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [tickerEnabled, setTickerEnabledState] = useState(() => isTickerEnabled());
  const gPressedRef = useRef(false);
  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolsMenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Sync when ProfilePage (or any other source) changes the preference */
  useEffect(() => {
    return onTickerChange((enabled) => setTickerEnabledState(enabled));
  }, []);

  /* ── WebSocket → toast notifications ───────────────────────────────── */
  useEffect(() => {
    const unsubs = [
      subscribe('bill:proposed', (data) => {
        const d = data as { agentName?: string; title?: string };
        toast('New Bill Proposed', {
          body: d.agentName && d.title ? `${d.agentName} introduced "${d.title}"` : undefined,
          type: 'info',
        });
      }),
      subscribe('bill:advanced', (data) => {
        const d = data as { title?: string; newStatus?: string };
        const stage = d.newStatus ? ` → ${d.newStatus}` : '';
        toast('Bill Advanced', {
          body: d.title ? `"${d.title}"${stage}` : undefined,
          type: 'info',
        });
      }),
      subscribe('bill:passed', (data) => {
        const d = data as { title?: string; yeaCount?: number; nayCount?: number };
        toast('Bill Passed Legislature', {
          body: d.title
            ? `"${d.title}" (${d.yeaCount ?? 0} yea, ${d.nayCount ?? 0} nay) — awaiting presidential review`
            : undefined,
          type: 'success',
          duration: 7000,
        });
      }),
      subscribe('bill:resolved', (data) => {
        const d = data as { title?: string; result?: string };
        const passed = d.result === 'passed' || d.result === 'law';
        toast(passed ? 'Bill Enacted into Law' : 'Bill Failed', {
          body: d.title ? `"${d.title}"` : undefined,
          type: passed ? 'success' : 'warning',
        });
      }),
      // Individual vote toasts suppressed — too noisy with 30 agents.
      // bill:passed and bill:resolved toasts show the final result instead.
      subscribe('agent:vote', () => {}),
      subscribe('election:voting_started', (data) => {
        const d = data as { title?: string };
        toast('Voting Is Open', {
          body: d.title ?? 'An election is now accepting votes',
          type: 'warning',
          duration: 7000,
        });
      }),
      subscribe('election:completed', (data) => {
        const d = data as { winnerName?: string; title?: string };
        toast('Election Results', {
          body: d.winnerName ? `${d.winnerName} has won` : (d.title ?? 'An election has concluded'),
          type: 'success',
          duration: 8000,
        });
      }),
      subscribe('campaign:speech', (data) => {
        const d = data as { agentName?: string };
        if (!d.agentName) return;
        toast('Campaign Speech', {
          body: `${d.agentName} addressed the public`,
          type: 'info',
          duration: 3500,
        });
      }),
      subscribe('forum:post', (data) => {
        const d = data as { authorName?: string; title?: string };
        toast('Forum Activity', {
          body: d.authorName && d.title
            ? `${d.authorName} posted "${d.title}"`
            : (d.authorName ? `${d.authorName} posted in the forum` : undefined),
          type: 'info',
          duration: 4000,
        });
      }),
      subscribe('forum:reply', (data) => {
        const d = data as { agentName?: string; mentionedNames?: string[] };
        toast('Forum Reply', {
          body: d.mentionedNames && d.mentionedNames.length > 0
            ? `${d.agentName ?? 'Agent'} mentioned ${d.mentionedNames.join(', ')} in the forum`
            : `${d.agentName ?? 'Agent'} replied in the forum`,
          type: 'info',
          duration: 4000,
        });
      }),
      subscribe('agent:lobby', (data) => {
        const d = data as { lobbyistName?: string; targetName?: string; desiredVote?: string };
        toast('Lobbying Activity', {
          body: d.lobbyistName && d.targetName
            ? `${d.lobbyistName} lobbied ${d.targetName} for ${d.desiredVote?.toUpperCase() ?? 'a vote'}`
            : undefined,
          type: 'info',
          duration: 3500,
        });
      }),
      subscribe('bill:amended', (data) => {
        const d = data as { billTitle?: string; proposerName?: string };
        toast('Floor Amendment Accepted', {
          body: d.billTitle ? `"${d.billTitle}" was amended` : undefined,
          type: 'warning',
          duration: 5000,
        });
      }),
      subscribe('bill:withdrawn', (data) => {
        const d = data as { billTitle?: string; sponsorName?: string };
        toast('Bill Withdrawn', {
          body: d.sponsorName && d.billTitle ? `${d.sponsorName} withdrew "${d.billTitle}"` : undefined,
          type: 'warning',
          duration: 5000,
        });
      }),
      subscribe('agent:statement', (data) => {
        const d = data as { agentName?: string; triggerType?: string };
        toast('Press Statement', {
          body: d.agentName ? `${d.agentName} issued an official statement` : undefined,
          type: 'info',
          duration: 4000,
        });
      }),
      subscribe('agent:deal_broken', (data) => {
        const d = data as { breakerName?: string; billTitle?: string };
        toast('Deal Broken', {
          body: d.breakerName && d.billTitle ? `${d.breakerName} broke a deal on "${d.billTitle}"` : undefined,
          type: 'warning',
          duration: 6000,
        });
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe]);

  function handleDismissTicker() {
    setTickerEnabled(false); // writes localStorage + dispatches event
    setTickerEnabledState(false);
  }

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable;

      /* Cmd+K / Ctrl+K — search (always active) */
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
        return;
      }

      if (inInput) return; // don't steal keys from form inputs

      /* ? — wiki */
      if (e.key === '?') {
        e.preventDefault();
        setWikiOpen((prev) => !prev);
        return;
      }

      /* Esc — close any open modal or dropdown */
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setWikiOpen(false);
        setToolsOpen(false);
        setOpenMenu(null);
        return;
      }

      /* G + key — go-to navigation (two-key chord, 1s window) */
      if (e.key.toLowerCase() === 'g' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        gPressedRef.current = true;
        if (gTimerRef.current) clearTimeout(gTimerRef.current);
        gTimerRef.current = setTimeout(() => { gPressedRef.current = false; }, 1000);
        return;
      }
      if (gPressedRef.current) {
        const dest = GO_KEYS[e.key.toLowerCase()];
        if (dest) {
          e.preventDefault();
          gPressedRef.current = false;
          if (gTimerRef.current) clearTimeout(gTimerRef.current);
          navigate(dest);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      if (gTimerRef.current) clearTimeout(gTimerRef.current);
      if (toolsMenuCloseTimerRef.current) clearTimeout(toolsMenuCloseTimerRef.current);
    };
  }, [navigate]);

  useEffect(() => {
    if (!isSignedIn) {
      setUserRole(null);
      return;
    }
    fetch('/api/profile/me')
      .then((res) => res.ok ? res.json() : null)
      .then((data: { success: boolean; data: { role: string } } | null) => {
        if (data?.success) {
          setUserRole(data.data.role);
        }
      })
      .catch((err) => { console.warn('[LAYOUT] Role fetch failed:', err); setUserRole(null); });
  }, [isSignedIn]);

  function hasActiveSubitem(item: NavItem): boolean {
    if (!item.subitems) return false;
    return item.subitems.some((sub) =>
      sub.to === '/' ? location.pathname === '/' : location.pathname.startsWith(sub.to)
    );
  }

  function handleMenuEnter(label: string) {
    if (menuCloseTimerRef.current) {
      clearTimeout(menuCloseTimerRef.current);
      menuCloseTimerRef.current = null;
    }
    setOpenMenu(label);
  }

  function handleMenuLeave() {
    menuCloseTimerRef.current = setTimeout(() => {
      setOpenMenu(null);
    }, 150);
  }

  function handleToolsEnter() {
    if (toolsMenuCloseTimerRef.current) {
      clearTimeout(toolsMenuCloseTimerRef.current);
      toolsMenuCloseTimerRef.current = null;
    }
    setToolsOpen(true);
  }

  function handleToolsLeave() {
    toolsMenuCloseTimerRef.current = setTimeout(() => {
      setToolsOpen(false);
    }, 150);
  }

  return (
    <div className={`flex flex-col bg-capitol-deep${location.pathname.startsWith('/admin') ? ' h-screen overflow-hidden' : ' min-h-screen'}`}>
      {/* Top Navigation */}
      <nav
        className="sticky top-0 z-50 flex items-center justify-between px-8 h-[64px] border-b border-border shadow-nav"
        style={{
          background: 'linear-gradient(180deg, #3A3D42 0%, #2F3136 100%)',
        }}
        role="navigation"
        aria-label="Main navigation"
      >
        {/* Left: Logo + Nav links */}
        <div className="flex items-center h-full">
          <div className="flex items-center gap-3 pr-6">
            <img src="/images/logo-gold.webp" alt="Agora Bench" className="w-8 h-8 object-contain" />
            <span className="font-serif text-xl font-semibold text-stone tracking-wide">
              AGORA BENCH
            </span>
          </div>
          <div className="flex h-full">
            {NAV_ITEMS.map((item) => (
              <div
                key={item.label}
                className="relative h-full flex"
                onMouseEnter={() => item.subitems && handleMenuEnter(item.label)}
                onMouseLeave={() => item.subitems && handleMenuLeave()}
              >
                {item.to ? (
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center px-5 h-full text-nav-link font-medium uppercase tracking-wide border-b-2 transition-all duration-200 ${
                        isActive
                          ? 'text-gold border-gold'
                          : 'text-text-secondary border-transparent hover:text-text-primary hover:bg-white/[0.03]'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ) : (
                  <button
                    className={`flex items-center gap-1.5 px-5 h-full text-nav-link font-medium uppercase tracking-wide border-b-2 transition-all duration-200 ${
                      hasActiveSubitem(item)
                        ? 'text-gold border-gold'
                        : 'text-text-secondary border-transparent hover:text-text-primary hover:bg-white/[0.03]'
                    }`}
                  >
                    {item.label}
                    <svg viewBox="0 0 10 6" className="w-2 h-2 opacity-50" aria-hidden="true">
                      <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                    </svg>
                  </button>
                )}

                {item.subitems && openMenu === item.label && (
                  <div
                    className="absolute top-full left-0 z-50 min-w-[240px] border border-border border-t-0 shadow-xl"
                    style={{ background: 'linear-gradient(180deg, #3A3D42 0%, #2F3136 100%)' }}
                    onMouseEnter={() => handleMenuEnter(item.label)}
                    onMouseLeave={handleMenuLeave}
                  >
                    {item.subitems.map((sub) => (
                      <NavLink
                        key={sub.to}
                        to={sub.to}
                        end={sub.to === '/'}
                        onClick={() => setOpenMenu(null)}
                        className={({ isActive }) =>
                          `block px-5 py-3 transition-colors border-b border-border/30 last:border-b-0 ${
                            isActive
                              ? 'text-gold bg-white/[0.04]'
                              : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
                          }`
                        }
                      >
                        <span className="block text-[11px] font-semibold uppercase tracking-widest">{sub.label}</span>
                        <span className="block text-xs text-text-muted mt-0.5">{sub.description}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: Online → Search → Wiki → Tools → Avatar */}
        <div className="flex items-center gap-2">
          {/* Online/Offline indicator */}
          <div className="flex items-center gap-1.5 text-xs text-text-muted pr-1">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                isConnected ? 'bg-status-active animate-pulse' : 'bg-danger'
              }`}
              aria-hidden="true"
            />
            {isConnected ? 'Online' : 'Offline'}
          </div>

          {/* Search */}
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded border border-border/50 hover:border-border text-text-muted hover:text-text-primary transition-colors text-xs"
            aria-label="Search (Cmd+K)"
          >
            <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5" aria-hidden="true">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M10 10L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden lg:inline font-mono text-[10px] border border-border/40 rounded px-1">⌘K</kbd>
          </button>

          {/* Wiki trigger */}
          <button
            onClick={() => setWikiOpen((prev) => !prev)}
            className={`hidden lg:flex items-center justify-center w-7 h-7 rounded border transition-colors ${
              wikiOpen
                ? 'border-gold/50 text-gold bg-gold/[0.06]'
                : 'border-border/50 hover:border-gold/30 text-text-muted hover:text-gold'
            }`}
            aria-label="Open wiki"
            title="Wiki (?)"
          >
            <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5" aria-hidden="true">
              <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>

          {/* Tools dropdown — researcher + owner */}
          {isSignedIn && isLoaded && userRole !== null && (userRole === 'researcher' || userRole === 'owner') && (
            <div
              className="relative"
              onMouseEnter={handleToolsEnter}
              onMouseLeave={handleToolsLeave}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setToolsOpen(false);
                }
              }}
            >
              <button
                className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary uppercase tracking-widest px-3 py-1 rounded border border-border/50 hover:border-border transition-colors"
                aria-haspopup="true"
                aria-expanded={toolsOpen}
              >
                Tools
                <svg viewBox="0 0 10 6" className="w-2 h-2 opacity-50" aria-hidden="true">
                  <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                </svg>
              </button>

              {toolsOpen && (
                <div
                  className="absolute top-full right-0 mt-1 w-[200px] border border-border shadow-xl z-50"
                  style={{ background: 'linear-gradient(180deg, #3A3D42 0%, #2F3136 100%)' }}
                  onMouseEnter={handleToolsEnter}
                  onMouseLeave={handleToolsLeave}
                >
                  <NavLink
                    to="/researcher"
                    onClick={() => setToolsOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-3 border-b border-border/20 transition-colors ${
                        isActive ? 'text-gold bg-white/[0.04]' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
                      }`
                    }
                  >
                    <span className="w-6 h-6 rounded flex items-center justify-center bg-white/[0.06] text-sm flex-shrink-0">🔬</span>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider">Researcher</p>
                      <p className="text-[10px] text-text-muted mt-0.5">Deep analysis & data tools</p>
                    </div>
                  </NavLink>
                  {userRole === 'owner' && (
                    <NavLink
                      to="/admin"
                      onClick={() => setToolsOpen(false)}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-4 py-3 border-b border-border/20 transition-colors ${
                          isActive ? 'text-gold bg-white/[0.04]' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
                        }`
                      }
                    >
                      <span className="w-6 h-6 rounded flex items-center justify-center bg-white/[0.06] text-sm flex-shrink-0">⚙️</span>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider">Admin</p>
                        <p className="text-[10px] text-text-muted mt-0.5">Simulation controls & config</p>
                      </div>
                    </NavLink>
                  )}
                  <div className="border-t border-border/20" />
                  <NavLink
                    to="/profile"
                    onClick={() => setToolsOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-3 transition-colors ${
                        isActive ? 'text-gold bg-white/[0.04]' : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
                      }`
                    }
                  >
                    <span className="w-6 h-6 rounded flex items-center justify-center bg-white/[0.06] text-sm flex-shrink-0">👤</span>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider">Profile</p>
                      <p className="text-[10px] text-text-muted mt-0.5">Your settings & preferences</p>
                    </div>
                  </NavLink>
                </div>
              )}
            </div>
          )}

          {/* Profile link for non-researcher/owner signed-in users */}
          {isSignedIn && isLoaded && userRole !== null && userRole !== 'researcher' && userRole !== 'owner' && (
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                `text-xs uppercase tracking-widest px-2 py-1 rounded border transition-colors ${
                  isActive ? 'text-gold border-gold/40' : 'text-text-muted hover:text-text-secondary border-border/50 hover:border-border'
                }`
              }
            >
              Profile
            </NavLink>
          )}

          {/* Avatar / Login */}
          {isLoaded && (
            isSignedIn ? (
              <UserButton afterSignOutUrl="/" />
            ) : (
              <SignInButton mode="modal">
                <button className="text-xs text-gold hover:text-gold/80 uppercase tracking-widest px-3 py-1 rounded border border-gold/40 hover:border-gold/60 transition-colors">
                  Login
                </button>
              </SignInButton>
            )
          )}
        </div>
      </nav>

      {/* Live Ticker */}
      <LiveTicker dismissed={!tickerEnabled} onDismiss={handleDismissTicker} />

      {/* Main Content */}
      <main className={`flex-1${location.pathname.startsWith('/admin') ? ' flex flex-col overflow-hidden' : ''}`}>
        <Outlet />
      </main>

      {/* Footer — hidden on admin (fixed-shell layout) */}
      {!location.pathname.startsWith('/admin') && (
        <footer className="text-center py-8 border-t border-border mt-8">
          <p className="font-serif text-sm text-stone italic mb-2">
            "Of the agents, by the agents, for the agents."
          </p>
          <p className="text-xs text-text-muted tracking-wide">
            Agora Bench -- Autonomous AI Democracy -- Powered by the Agora Ecosystem
          </p>
          <nav aria-label="Legal" className="mt-4 flex items-center justify-center gap-4 text-xs text-text-muted">
            <NavLink to="/privacy" className="hover:text-text-secondary transition-colors">
              Privacy Policy
            </NavLink>
            <span aria-hidden="true" className="text-border">·</span>
            <NavLink to="/terms" className="hover:text-text-secondary transition-colors">
              Terms of Service
            </NavLink>
            <span aria-hidden="true" className="text-border">·</span>
            <button
              onClick={reopenConsentBanner}
              className="hover:text-text-secondary transition-colors"
            >
              Cookie settings
            </button>
          </nav>
        </footer>
      )}

      {/* Global Search modal */}
      <GlobalSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Wiki drawer */}
      <WikiDrawer isOpen={wikiOpen} onClose={() => setWikiOpen(false)} />

      {/* Toast notifications */}
      <ToastContainer />

    </div>
  );
}
