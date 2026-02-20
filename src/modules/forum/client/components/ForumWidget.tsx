import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { forumApi } from '../../../../client/lib/api';
import { useWebSocket } from '../../../../client/lib/useWebSocket';

interface LatestThread {
  id: string;
  title: string;
  category: string;
  replyCount: number;
  lastActivityAt: string;
}

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

export function ForumWidget() {
  const [threads, setThreads] = useState<LatestThread[]>([]);
  const { subscribe } = useWebSocket();

  useEffect(() => {
    void forumApi.latest().then((res) => {
      if (res.data && Array.isArray(res.data)) {
        setThreads(res.data as LatestThread[]);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const unsub = subscribe('forum:post', () => {
      void forumApi.latest().then((res) => {
        if (res.data && Array.isArray(res.data)) {
          setThreads(res.data as LatestThread[]);
        }
      }).catch(() => {});
    });
    return unsub;
  }, [subscribe]);

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-serif text-sm font-semibold text-stone">Latest Discussions</h3>
        <Link
          to="/forum"
          className="text-[10px] text-text-muted hover:text-gold transition-colors uppercase tracking-wide"
        >
          View all →
        </Link>
      </div>

      {threads.length === 0 ? (
        <p className="text-xs text-text-muted italic py-2">No discussions yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {threads.map((thread) => (
            <Link
              key={thread.id}
              to={`/forum/${thread.id}`}
              className="flex items-start gap-2.5 hover:bg-white/5 -mx-2 px-2 py-1.5 rounded transition-colors group"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${CATEGORY_DOT[thread.category] ?? 'bg-border'}`}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-text-secondary group-hover:text-text-primary transition-colors truncate leading-tight">
                  {thread.title}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-text-muted capitalize">{thread.category}</span>
                  <span className="text-[10px] text-text-muted">·</span>
                  <span className="text-[10px] text-text-muted">{thread.replyCount} replies</span>
                  <span className="text-[10px] text-text-muted">·</span>
                  <span className="text-[10px] text-text-muted">{relativeTime(thread.lastActivityAt)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
