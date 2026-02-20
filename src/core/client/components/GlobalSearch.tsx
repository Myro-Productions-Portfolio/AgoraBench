import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchApi } from '../lib/api';

interface AgentResult {
  id: string;
  displayName: string;
  name: string;
  alignment: string | null;
}

interface BillResult {
  id: string;
  title: string;
  status: string;
  committee: string;
}

interface PartyResult {
  id: string;
  name: string;
  abbreviation: string;
  alignment: string;
}

interface ElectionResult {
  id: string;
  positionType: string;
  status: string;
}

interface SearchResults {
  agents: AgentResult[];
  bills: BillResult[];
  parties: PartyResult[];
  elections: ElectionResult[];
}

interface FlatResult {
  href: string;
  title: string;
  subtitle: string;
  category: string;
}

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

function flattenResults(data: SearchResults): FlatResult[] {
  const results: FlatResult[] = [];

  for (const a of data.agents) {
    results.push({
      href: `/agents/${a.id}`,
      title: a.displayName,
      subtitle: a.alignment ? `Agent · ${a.alignment}` : 'Agent',
      category: 'Agents',
    });
  }
  for (const b of data.bills) {
    results.push({
      href: `/legislation/${b.id}`,
      title: b.title,
      subtitle: `Bill · ${b.status} · ${b.committee}`,
      category: 'Legislation',
    });
  }
  for (const p of data.parties) {
    results.push({
      href: `/parties/${p.id}`,
      title: `${p.name} (${p.abbreviation})`,
      subtitle: `Party · ${p.alignment}`,
      category: 'Parties',
    });
  }
  for (const e of data.elections) {
    results.push({
      href: '/elections',
      title: e.positionType,
      subtitle: `Election · ${e.status}`,
      category: 'Elections',
    });
  }

  return results;
}

const CATEGORY_ICONS: Record<string, string> = {
  Agents: '◈',
  Legislation: '§',
  Parties: '⚑',
  Elections: '◎',
};

export function GlobalSearch({ isOpen, onClose }: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  // Auto-focus on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults(null);
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  // Debounced search
  const runSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchApi.global(q);
        const data = res.data as SearchResults;
        setResults(data);
        setActiveIdx(0);
      } catch {
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, []);

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    runSearch(q);
  };

  const flat = results ? flattenResults(results) : [];
  const hasResults = flat.length > 0;

  const selectResult = useCallback(
    (item: FlatResult) => {
      navigate(item.href);
      onClose();
    },
    [navigate, onClose],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (!hasResults) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selectResult(flat[activeIdx]);
    }
  };

  if (!isOpen) return null;

  // Group flat results by category for display
  const groups: Record<string, FlatResult[]> = {};
  for (const item of flat) {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push(item);
  }

  // Build a flat index map for active highlighting
  let runningIdx = 0;
  const groupsWithIdx: { category: string; items: { item: FlatResult; idx: number }[] }[] = [];
  for (const [category, items] of Object.entries(groups)) {
    groupsWithIdx.push({
      category,
      items: items.map((item) => ({ item, idx: runningIdx++ })),
    });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      style={{ backdropFilter: 'blur(4px)', background: 'rgba(26, 27, 30, 0.7)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
    >
      <div
        className="w-full max-w-xl mx-4 rounded-lg border border-border shadow-2xl overflow-hidden"
        style={{ background: '#2B2D31' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4 text-text-muted flex-shrink-0" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M10 10L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            placeholder="Search agents, bills, parties, elections..."
            className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted outline-none text-sm"
            aria-label="Search"
            autoComplete="off"
          />
          {loading && (
            <span className="text-xs text-text-muted animate-pulse">searching...</span>
          )}
          <kbd className="text-xs text-text-muted border border-border/60 rounded px-1.5 py-0.5 font-mono">
            esc
          </kbd>
        </div>

        {/* Results */}
        {query.length >= 2 && (
          <div className="max-h-[400px] overflow-y-auto">
            {!loading && !hasResults && (
              <div className="py-10 text-center text-sm text-text-muted">
                No results for <strong className="text-text-primary">&ldquo;{query}&rdquo;</strong>
              </div>
            )}

            {groupsWithIdx.map(({ category, items }) => (
              <div key={category}>
                <div className="px-4 py-2 text-badge uppercase tracking-widest text-text-muted border-b border-border/40 bg-capitol-deep/40">
                  <span className="mr-1.5">{CATEGORY_ICONS[category]}</span>
                  {category}
                </div>
                {items.map(({ item, idx }) => (
                  <button
                    key={idx}
                    className={`w-full text-left flex items-center gap-3 px-4 py-2.5 transition-colors ${
                      idx === activeIdx
                        ? 'bg-gold/10 text-text-primary'
                        : 'text-text-secondary hover:bg-white/[0.04] hover:text-text-primary'
                    }`}
                    onClick={() => selectResult(item)}
                    onMouseEnter={() => setActiveIdx(idx)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.title}</div>
                      <div className="text-badge text-text-muted truncate">{item.subtitle}</div>
                    </div>
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      className="w-3 h-3 flex-shrink-0 text-text-muted"
                      aria-hidden="true"
                    >
                      <path d="M4 8H12M12 8L9 5M12 8L9 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </svg>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border/40 flex items-center gap-4 text-badge text-text-muted">
          <span><kbd className="font-mono border border-border/50 rounded px-1">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono border border-border/50 rounded px-1">↵</kbd> open</span>
          <span><kbd className="font-mono border border-border/50 rounded px-1">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
