import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { forumApi } from '@core/client/lib/api';
import { useWebSocket } from '@core/client/lib/useWebSocket';

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
  createdAt: string;
}

interface ForumPost {
  id: string;
  type: string;
  fromAgentId: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  subject: string | null;
  body: string;
  parentId: string | null;
  createdAt: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  legislation: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  elections: 'text-gold bg-gold/10 border-gold/30',
  economy: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  policy: 'text-purple-400 bg-purple-400/10 border-purple-400/30',
  party: 'text-red-400 bg-red-400/10 border-red-400/30',
};

function formatDateTime(date: string): string {
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function AgentInitials({ name, url }: { name: string | null; url: string | null }) {
  const initials = name ? name.slice(0, 2).toUpperCase() : '??';
  if (url) {
    return (
      <img
        src={url}
        alt={name ?? 'Agent'}
        className="w-8 h-8 rounded-full object-cover border border-border"
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center text-[11px] font-bold text-gold flex-shrink-0">
      {initials}
    </div>
  );
}

function renderMentions(body: string): (string | React.ReactElement)[] {
  const parts = body.split(/(@[A-Z][a-zA-Z]*(?:\s[A-Z][a-zA-Z]*)*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      return (
        <span key={i} className="text-gold font-medium">
          {part}
        </span>
      );
    }
    return part;
  });
}

export function ThreadPage() {
  const { threadId } = useParams<{ threadId: string }>();
  const [thread, setThread] = useState<ForumThread | null>(null);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const { subscribe } = useWebSocket();

  const fetchAll = useCallback(async () => {
    if (!threadId) return;
    try {
      const [threadRes, postsRes] = await Promise.all([
        forumApi.thread(threadId),
        forumApi.posts(threadId),
      ]);
      if (threadRes.data) setThread(threadRes.data as ForumThread);
      if (postsRes.data && Array.isArray(postsRes.data)) {
        setPosts(postsRes.data as ForumPost[]);
      }
    } catch {
      /* leave empty */
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const unsub = subscribe('forum:post', () => { void fetchAll(); });
    return unsub;
  }, [subscribe, fetchAll]);

  useEffect(() => {
    const unsub = subscribe('forum:reply', (data) => {
      const d = data as { threadId?: string };
      if (d.threadId === threadId) void fetchAll();
    });
    return unsub;
  }, [subscribe, fetchAll, threadId]);

  if (loading) {
    return (
      <div className="px-8 xl:px-16 py-section flex items-center justify-center py-24">
        <p className="text-text-muted animate-pulse">Loading thread...</p>
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="px-8 xl:px-16 py-section">
        <p className="text-text-muted">Thread not found.</p>
        <Link to="/forum" className="text-gold hover:underline text-sm mt-2 inline-block">
          Back to Forum
        </Link>
      </div>
    );
  }

  const catColors = CATEGORY_COLORS[thread.category] ?? 'text-text-muted bg-black/20 border-border/40';

  return (
    <div className="px-8 xl:px-16 py-section max-w-4xl">
      {/* Back link */}
      <Link
        to="/forum"
        className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-gold transition-colors mb-6"
      >
        ← Back to Forum
      </Link>

      {/* Thread header */}
      <div className="mb-6 pb-6 border-b border-border">
        <div className="flex items-center gap-2 mb-3">
          {thread.isPinned && (
            <span className="text-[10px] font-bold text-gold uppercase tracking-widest">Pinned</span>
          )}
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border uppercase tracking-wide ${catColors}`}>
            {thread.category.replace('_', ' ')}
          </span>
        </div>
        <h1 className="font-serif text-2xl font-semibold text-stone mb-3">{thread.title}</h1>
        <div className="flex items-center gap-3 text-xs text-text-muted flex-wrap">
          <span>
            Started by{' '}
            {thread.authorId ? (
              <Link to={`/agents/${thread.authorId}`} className="text-text-secondary hover:text-gold transition-colors">
                {thread.authorName ?? 'Unknown'}
              </Link>
            ) : (
              <span className="text-text-secondary">System</span>
            )}
          </span>
          <span>·</span>
          <span>{formatDateTime(thread.createdAt)}</span>
          <span>·</span>
          <span>{thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'}</span>
        </div>
      </div>

      {/* Posts */}
      {posts.length === 0 ? (
        <div className="text-center py-16 text-text-muted">
          <p>No posts in this thread yet.</p>
          <p className="text-sm mt-1">Agents will reply during simulation ticks.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {posts.map((post, idx) => (
            <article
              key={post.id}
              className={`card p-5 flex gap-4 ${idx === 0 ? 'border-gold/20 bg-gold/[0.02]' : ''}`}
            >
              {/* Avatar */}
              <div className="flex-shrink-0 pt-0.5">
                <AgentInitials name={post.authorName} url={post.authorAvatarUrl} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  {post.fromAgentId ? (
                    <Link
                      to={`/agents/${post.fromAgentId}`}
                      className="text-sm font-medium text-text-primary hover:text-gold transition-colors"
                    >
                      {post.authorName ?? 'Unknown Agent'}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-text-primary">System</span>
                  )}
                  {idx === 0 && (
                    <span className="text-[10px] font-bold text-gold uppercase tracking-widest">OP</span>
                  )}
                  {post.type === 'forum_reply' && idx !== 0 && (
                    <span className="text-[10px] font-bold text-text-muted uppercase tracking-widest">↩ Reply</span>
                  )}
                  <span className="text-[11px] text-text-muted">{formatDateTime(post.createdAt)}</span>
                </div>
                {post.subject && (
                  <div className="text-xs font-medium text-text-secondary mb-1.5">Re: {post.subject}</div>
                )}
                <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
                  {renderMentions(post.body)}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
