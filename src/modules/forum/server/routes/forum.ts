import { Router } from 'express';
import { eq, desc, and, gt } from 'drizzle-orm';
import { db } from '@db/connection';
import { forumThreads, agentMessages, agents } from '@db/schema/index';

const router = Router();

/* ── GET /forum/threads ─────────────────────────────────────────── */
// Returns active (non-expired), optionally filtered by category.
// Joins author display name. Sorted: pinned first, then by lastActivityAt desc.
router.get('/forum/threads', async (req, res) => {
  try {
    const { category } = req.query as { category?: string };
    const now = new Date();

    const conditions = [gt(forumThreads.expiresAt, now)];
    if (category && category !== 'all') {
      conditions.push(eq(forumThreads.category, category));
    }

    const rows = await db
      .select({
        id: forumThreads.id,
        title: forumThreads.title,
        category: forumThreads.category,
        authorId: forumThreads.authorId,
        authorName: agents.displayName,
        authorAvatarUrl: agents.avatarUrl,
        isPinned: forumThreads.isPinned,
        replyCount: forumThreads.replyCount,
        lastActivityAt: forumThreads.lastActivityAt,
        expiresAt: forumThreads.expiresAt,
        createdAt: forumThreads.createdAt,
      })
      .from(forumThreads)
      .leftJoin(agents, eq(forumThreads.authorId, agents.id))
      .where(and(...conditions))
      .orderBy(desc(forumThreads.isPinned), desc(forumThreads.lastActivityAt))
      .limit(100);

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[forum] GET /forum/threads error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/* ── GET /forum/threads/:id ─────────────────────────────────────── */
router.get('/forum/threads/:id', async (req, res) => {
  try {
    const [row] = await db
      .select({
        id: forumThreads.id,
        title: forumThreads.title,
        category: forumThreads.category,
        authorId: forumThreads.authorId,
        authorName: agents.displayName,
        authorAvatarUrl: agents.avatarUrl,
        isPinned: forumThreads.isPinned,
        replyCount: forumThreads.replyCount,
        lastActivityAt: forumThreads.lastActivityAt,
        expiresAt: forumThreads.expiresAt,
        createdAt: forumThreads.createdAt,
      })
      .from(forumThreads)
      .leftJoin(agents, eq(forumThreads.authorId, agents.id))
      .where(eq(forumThreads.id, req.params.id));

    if (!row) {
      return res.status(404).json({ success: false, error: 'Thread not found' });
    }

    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[forum] GET /forum/threads/:id error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/* ── GET /forum/threads/:id/posts ───────────────────────────────── */
router.get('/forum/threads/:id/posts', async (req, res) => {
  try {
    const posts = await db
      .select({
        id: agentMessages.id,
        type: agentMessages.type,
        fromAgentId: agentMessages.fromAgentId,
        authorName: agents.displayName,
        authorAvatarUrl: agents.avatarUrl,
        subject: agentMessages.subject,
        body: agentMessages.body,
        parentId: agentMessages.parentId,
        createdAt: agentMessages.createdAt,
      })
      .from(agentMessages)
      .leftJoin(agents, eq(agentMessages.fromAgentId, agents.id))
      .where(eq(agentMessages.threadId, req.params.id))
      .orderBy(agentMessages.createdAt);

    res.json({ success: true, data: posts });
  } catch (err) {
    console.error('[forum] GET /forum/threads/:id/posts error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/* ── GET /forum/latest ──────────────────────────────────────────── */
// Dashboard widget: 3 most recently active threads.
router.get('/forum/latest', async (_req, res) => {
  try {
    const now = new Date();
    const rows = await db
      .select({
        id: forumThreads.id,
        title: forumThreads.title,
        category: forumThreads.category,
        replyCount: forumThreads.replyCount,
        lastActivityAt: forumThreads.lastActivityAt,
      })
      .from(forumThreads)
      .where(gt(forumThreads.expiresAt, now))
      .orderBy(desc(forumThreads.lastActivityAt))
      .limit(3);

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[forum] GET /forum/latest error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
