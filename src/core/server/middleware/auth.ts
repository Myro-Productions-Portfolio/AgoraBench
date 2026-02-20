import { getAuth, clerkClient } from '@clerk/express';
import type { RequestHandler } from 'express';
import { db } from '@db/connection.js';
import { users } from '@db/schema/index.js';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';

/*
 * Role model (simple, no drift):
 *
 *   owner      — env var OWNER_CLERK_ID. Always has full access. Never stored in DB.
 *   researcher — stored in DB. Can inject AIs, access own data, export own results.
 *   user       — default for everyone else. Browse, view, no admin.
 *
 * The "admin" role no longer exists. Owner is determined by env var, not DB state.
 * Observer access (/observe) requires no auth at all.
 */

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        clerkUserId: string;
        username: string;
        role: 'owner' | 'researcher' | 'user';
      };
    }
  }
}

/* ── Clerk profile sync (cached, non-blocking) ─────────────────────── */

const syncedAt = new Map<string, number>();
const SYNC_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function syncClerkProfile(
  clerkUserId: string,
  dbUserId: string,
  currentUsername: string,
  currentEmail: string | null,
): Promise<void> {
  const lastSync = syncedAt.get(clerkUserId) ?? 0;
  if (Date.now() - lastSync < SYNC_TTL_MS) return;

  try {
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    const displayName =
      clerkUser.firstName && clerkUser.lastName
        ? `${clerkUser.firstName} ${clerkUser.lastName}`
        : clerkUser.username ?? clerkUser.firstName ?? clerkUserId;
    const email = clerkUser.emailAddresses?.[0]?.emailAddress ?? null;

    const patch: Record<string, unknown> = { lastLoginAt: new Date() };
    if (displayName !== currentUsername) patch.username = displayName;
    if (email !== currentEmail) patch.email = email;

    await db.update(users).set(patch).where(eq(users.id, dbUserId));
    syncedAt.set(clerkUserId, Date.now());
  } catch (err) {
    // Non-fatal — don't break auth if Clerk API is temporarily down
    console.warn('[AUTH] Clerk profile sync failed:', err instanceof Error ? err.message : err);
    syncedAt.set(clerkUserId, Date.now());
  }
}

/* ── Resolve effective role ─────────────────────────────────────────── */

function resolveRole(clerkUserId: string, dbRole: string): 'owner' | 'researcher' | 'user' {
  // Owner is ALWAYS determined by env var — immune to DB state
  if (config.ownerClerkId && clerkUserId === config.ownerClerkId) return 'owner';
  if (dbRole === 'researcher') return 'researcher';
  return 'user';
}

/* ── Middleware ──────────────────────────────────────────────────────── */

/** Any signed-in user */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  let [user] = await db.select().from(users).where(eq(users.clerkUserId, userId));
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ clerkUserId: userId, username: userId, role: 'user' })
      .returning();
  }

  // Sync display name + email from Clerk (non-blocking, cached)
  void syncClerkProfile(userId, user.id, user.username, user.email);

  req.user = {
    id: user.id,
    clerkUserId: userId,
    username: user.username,
    role: resolveRole(userId, user.role),
  };
  next();
};

/** Owner only — simulation control, config, API keys, user management */
export const requireOwner: RequestHandler = async (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  if (!config.ownerClerkId || userId !== config.ownerClerkId) {
    res.status(403).json({ success: false, error: 'Owner access required' });
    return;
  }

  let [user] = await db.select().from(users).where(eq(users.clerkUserId, userId));
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ clerkUserId: userId, username: userId, role: 'user' })
      .returning();
  }

  req.user = {
    id: user.id,
    clerkUserId: userId,
    username: user.username,
    role: 'owner',
  };
  next();
};

/** Researcher or owner */
export const requireResearcher: RequestHandler = async (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  const [user] = await db.select().from(users).where(eq(users.clerkUserId, userId));
  if (!user) {
    res.status(403).json({ success: false, error: 'Researcher access required' });
    return;
  }

  const role = resolveRole(userId, user.role);
  if (role !== 'owner' && role !== 'researcher') {
    res.status(403).json({ success: false, error: 'Researcher access required' });
    return;
  }

  req.user = {
    id: user.id,
    clerkUserId: userId,
    username: user.username,
    role,
  };
  next();
};
