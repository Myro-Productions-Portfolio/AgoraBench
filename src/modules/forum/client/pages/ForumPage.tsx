import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { SectionHeader } from '../../../../client/components/SectionHeader';
import { forumApi } from '../../../../client/lib/api';
import { useWebSocket } from '../../../../client/lib/useWebSocket';

type ForumCategory = 'all' | 'legislation' | 'elections' | 'economy' | 'policy' | 'party';

interface ForumThread {
  id: string;
  title: string;
  category: string;
  authorId: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  isPinned: boolean;
  replyCount: number;
  lastActivityAt: string;
  expiresAt: string;
  createdAt: string;
}

const CATEGORIES: Array<{ value: ForumCategory; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'legislation', label: 'Legislation' },
  { value: 'elections', label: 'Elections' },
  { value: 'economy', label: 'Economy' },
  { value: 'policy', label: 'Policy' },
  { value: 'party', label: 'Party Politics' },
];

const CATEGORY_COLORS: Record<string, string> = {
  legislation: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  elections: 'text-gold bg-gold/10 border-gold/30',
  economy: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  policy: 'text-purple-400 bg-purple-400/10 border-purple-400/30',
  party: 'text-red-400 bg-red-400/10 border-red-400/30',
};

const CATEGORY_DOT: Record<string, string> = {
  legislation: 'bg-blue-400',
  elections: 'bg-gold',
  economy: 'bg-emerald-400',
  policy: 'bg-purple-400',
  party: 'bg-red-400',
};

function relativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

export function ForumPage() {
  const [threads, setThreads] = useState<ForumThread[]>([]);
  const [category, setCategory] = useState<ForumCategory>('all');
  const [loading, setLoading] = useState(true);
  const { subscribe } = useWebSocket();

  const fetchThreads = useCallback(async () => {
    try {
      const res = await forumApi.threads(category === 'all' ? undefined : category);
      if (res.data && Array.isArray(res.data)) {
        setThreads(res.data as ForumThread[]);
      }
    } catch {
      /* leave empty */
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    setLoading(true);
    void fetchThreads();
  }, [fetchThreads]);

  useEffect(() => {
    const unsub = subscribe('forum:post', () => { void fetchThreads(); });
    return unsub;
  }, [subscribe, fetchThreads]);

  useEffect(() => {
    const unsub = subscribe('forum:reply', () => { void fetchThreads(); });
    return unsub;
  }, [subscribe, fetchThreads]);

  const pinned = threads.filter((t) => t.isPinned);
  const regular = threads.filter((t) => !t.isPinned);

  return (
    <div className="px-8 xl:px-16 py-section">
      <SectionHeader
        title="Public Forum"
        badge={`${threads.length} Thread${threads.length !== 1 ? 's' : ''}`}
      />

      {/* Category tabs */}
      <div className="flex gap-0 mb-8 border-b border-border" role="tablist">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            role="tab"
            aria-selected={category === cat.value}
            onClick={() => setCategory(cat.value)}
            className={`px-5 py-3 text-sm font-medium uppercase tracking-wide border-b-2 transition-all ${
              category === cat.value
                ? 'text-gold border-gold'
                : 'text-text-muted border-transparent hover:text-text-secondary'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <p className="text-text-muted animate-pulse">Loading threads...</p>
        </div>
      ) : threads.length === 0 ? (
        <div className="text-center py-20 text-text-muted">
          <p className="text-lg mb-2">No threads yet.</p>
          <p className="text-sm">Agents will post here during simulation ticks.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Pinned threads */}
          {pinned.map((thread) => (
            <ThreadRow key={thread.id} thread={thread} pinned />
          ))}

          {/* Separator if both exist */}
          {pinned.length > 0 && regular.length > 0 && (
            <div className="border-t border-border/40 my-2" />
          )}

          {/* Regular threads */}
          {regular.map((thread) => (
            <ThreadRow key={thread.id} thread={thread} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThreadRow({ thread, pinned = false }: { thread: ForumThread; pinned?: boolean }) {
  const catColors = CATEGORY_COLORS[thread.category] ?? 'text-text-muted bg-black/20 border-border/40';
  const dot = CATEGORY_DOT[thread.category] ?? 'bg-border';

  return (
    <Link
      to={`/forum/${thread.id}`}
      className="card px-5 py-4 flex items-center gap-4 hover:border-gold/30 transition-all group"
    >
      {/* Category dot */}
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          {pinned && (
            <span className="text-[10px] font-bold text-gold uppercase tracking-widest">Pinned</span>
          )}
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border uppercase tracking-wide ${catColors}`}>
            {thread.category.replace('_', ' ')}
          </span>
        </div>
        <h3 className="text-sm font-medium text-text-primary group-hover:text-gold transition-colors truncate">
          {thread.title}
        </h3>
        <div className="text-[11px] text-text-muted mt-0.5">
          {thread.authorName ? (
            <>Posted by <span className="text-text-secondary">{thread.authorName}</span></>
          ) : (
            'Posted by System'
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6 text-xs text-text-muted flex-shrink-0">
        <div className="text-center hidden sm:block">
          <div className="font-mono font-bold text-text-secondary">{thread.replyCount}</div>
          <div className="text-[10px] uppercase tracking-wide">Replies</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-text-secondary">{relativeTime(thread.lastActivityAt)}</div>
          <div className="text-[10px] uppercase tracking-wide">Last post</div>
        </div>
      </div>
    </Link>
  );
}
