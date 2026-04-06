# Development Best Practices
## Molt Government / AgoraBench

**Status:** Canonical reference — updated 2026-04-05
**Purpose:** Prevent the class of bugs that ship silently: unauthenticated routes, config saves that do nothing, plaintext secrets, silent type drift between server and client.

These are not suggestions. Every PR and every AI-assisted session must follow them.

---

## Table of Contents

1. [Authentication — Every Route](#1-authentication--every-route)
2. [Input Validation — Never Trust req.body](#2-input-validation--never-trust-reqbody)
3. [Config Round-Trip — Load, Validate, Persist](#3-config-round-trip--load-validate-persist)
4. [Shared Types — Server and Client in Sync](#4-shared-types--server-and-client-in-sync)
5. [Database Safety](#5-database-safety)
6. [Secrets Management](#6-secrets-management)
7. [Error Handling — Never Swallow](#7-error-handling--never-swallow)
8. [React Admin UI Patterns](#8-react-admin-ui-patterns)
9. [Security Headers, CORS, Rate Limiting](#9-security-headers-cors-rate-limiting)
10. [Logging — What To and What Never To](#10-logging--what-to-and-what-never-to)
11. [Pre-Deploy Checklist](#11-pre-deploy-checklist)
12. [Feature Completeness Test](#12-feature-completeness-test)

---

## 1. Authentication — Every Route

### The Rule
Apply auth middleware at the **router level**, not the route level. A new route added to a protected router is automatically protected. Never opt-in — always opt-out for public routes, and mark the opt-out explicitly.

```typescript
// WRONG — easy to forget on new routes
router.get('/config', requireOwner, getConfig);
router.post('/config', requireOwner, updateConfig);
router.get('/status', getStatus); // forgot auth — now public

// CORRECT — auth applied once, covers all routes below
const router = express.Router();
router.use(requireOwner); // everything on this router is protected
router.get('/config', getConfig);
router.post('/config', updateConfig);
router.get('/status', getStatus); // automatically protected
```

For genuinely public routes, use a separate router and document why:

```typescript
// routes/public.ts
// WARNING: No authentication on this router. All routes are publicly accessible.
const publicRouter = express.Router();
publicRouter.get('/health', healthCheck);
```

### Route Registration Order
Express matches in registration order. Auth middleware must be registered **before** the routes it protects. When two routers register the same path, the first one wins — the second is silently shadowed.

```typescript
// app.ts — document every mount point
// /api/public        → publicRouter       (no auth — intentional)
// /api/admin         → adminRouter        (requireOwner)
// /api/orchestrator  → orchestratorRouter (requireOrchestrator)
app.use('/api/public', publicRouter);
app.use('/api/admin', requireOwner, adminRouter);
app.use('/api/orchestrator', orchestratorRouter);
```

**Before adding a router:** grep for the path prefix to confirm nothing else is mounted there.

---

## 2. Input Validation — Never Trust req.body

### The Rule
`req.body` is untrusted user input. TypeScript types are erased at runtime — a typed handler parameter is NOT validated input. Every field that enters from a request must be:

1. Explicitly whitelisted (unknown fields rejected or stripped)
2. Type-validated (is it actually a number, not a string "123"?)
3. Range-clamped (numeric inputs must have min/max)

```typescript
// WRONG — trusts body entirely, silent field injection
router.post('/config', async (req, res) => {
  await updateRuntimeConfig(req.body); // attacker can set any field
});

// CORRECT — explicit whitelist with type validation and clamping
router.post('/config', requireOwner, async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const update: Partial<RuntimeConfig> = {};

    if (body.tickIntervalMs !== undefined) {
      const v = Number(body.tickIntervalMs);
      if (!isFinite(v) || v < 5000 || v > 3_600_000) {
        res.status(400).json({ error: 'tickIntervalMs must be 5000–3600000' });
        return;
      }
      update.tickIntervalMs = v;
    }
    // ... one branch per field, explicit type + range check

    const updated = await updateRuntimeConfig(update);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});
```

### The Config Whitelist Sync Rule
Every field in `RuntimeConfig` (runtimeConfig.ts) must have a corresponding:
- Branch in `POST /admin/config` handler (admin.ts)
- Control in the admin UI (AdminPage.tsx)
- Entry in the UI's RuntimeConfig interface

When you add a new field to `RuntimeConfig`, add all three before committing. This was the root cause of the 2026-04-05 incident where 17 fields were configurable in the DB but silently discarded by the server handler.

---

## 3. Config Round-Trip — Load, Validate, Persist

### The Rule
Config lives in the DB (`runtime_config` table, JSONB). The in-memory object is a cache. The round-trip is:

```
Startup: DB → parse with defaults → memory
Read:    memory (fast)
Write:   validate patch → merge onto memory → persist full object to DB → return updated
UI:      fetch on mount → local state → save → update local state from server response
```

Never:
- Write a partial JSONB object (blows away fields not in the patch)
- Read from memory without loading from DB first on startup
- Assume a save worked without reading the response body
- Silently discard fields that aren't in your handler's whitelist

```typescript
// WRONG — partial JSONB write destroys other fields
await db.update(runtimeConfig).set({ config: patch });

// CORRECT — read-merge-write
const [row] = await db.select().from(runtimeConfig).where(eq(runtimeConfig.id, 1));
const merged = { ...DEFAULT_CONFIG, ...(row?.config ?? {}), ...validatedPatch };
await db.update(runtimeConfig).set({ config: merged, updatedAt: new Date() })
  .where(eq(runtimeConfig.id, 1));
```

---

## 4. Shared Types — Server and Client in Sync

### The Rule
Types that describe API contracts live in `src/shared/types/`. Both server route handlers and client fetch wrappers import from there. Never define the same shape twice.

The symptom of drift: a field exists in the DB and server response but the UI never shows it because the client-side interface doesn't include it.

When you add a field:
1. Add it to the server `RuntimeConfig` type (runtimeConfig.ts)
2. Add it to the client `RuntimeConfig` interface (AdminPage.tsx or shared types)
3. Add it to the server handler whitelist
4. Add a UI control

All four in the same commit. Never partially.

### Detecting Drift
If the server returns a field and the client type doesn't have it, TypeScript won't error — it just ignores the field. The only way to catch this is:
- Keep a single shared type file
- Or run a response shape test that validates the API response against the client's expected schema

---

## 5. Database Safety

### Never Edit Existing Migrations
Migration files are immutable once committed. Schema drift is silent and permanent. Always create a new migration file.

```bash
# After changing schema.ts
pnpm drizzle-kit generate  # creates a new numbered migration
pnpm drizzle-kit migrate   # applies it
```

### Array Parameters in Raw SQL
Passing a JS array directly into a `sql` template for Postgres `ANY()` fails at runtime with `op ANY/ALL (array) requires array on right side`. This bug compiles cleanly and only surfaces with real data.

```typescript
// WRONG — fails at runtime
await db.execute(sql`
  UPDATE t SET x = 1 WHERE id = ANY(${jsArray})
`);

// CORRECT option 1 — use Drizzle's inArray()
await db.update(t).set({ x: 1 }).where(inArray(t.id, jsArray));

// CORRECT option 2 — explicit cast in raw SQL
await db.execute(sql`
  UPDATE t SET x = 1
  WHERE id = ANY(ARRAY[${sql.join(jsArray.map(id => sql`${id}`), sql`, `)}]::uuid[])
`);
```

**Rule: Any `ANY()` in raw SQL is a code review flag. Prefer `inArray()`.**

### JSONB Config — Read, Merge, Write
Never overwrite a JSONB column with a partial object. Always:
1. Read current value
2. Deep merge patch onto it
3. Write the full merged object

### Transactions for Multi-Table Writes
Any operation touching more than one table must be wrapped in a transaction.

### Drizzle Destructuring Safety
`db.select()` returns an array. Destructuring without a length check gives silent `undefined`.

```typescript
// WRONG — user is undefined if not found, TypeScript won't catch it
const [user] = await db.select().from(users).where(eq(users.id, id));
user.email; // runtime error

// CORRECT
const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
if (!rows.length) throw new Error(`User ${id} not found`);
const user = rows[0];
```

---

## 6. Secrets Management

### The Rule
- Never hardcode secrets. Never commit `.env` files.
- Validate all required secrets at startup — fail fast before accepting traffic.
- Encrypt sensitive values before writing to DB (AES-256-GCM, store `iv:tag:ciphertext`).
- Never log secrets, tokens, API keys, or authorization headers.
- Every encrypted column must store a key version so rotation is possible without full-table rewrites.

```typescript
// config/secrets.ts — validate at startup, fail if missing
const required = ['DATABASE_URL', 'REDIS_URL', 'ENCRYPTION_KEY', 'CLERK_SECRET_KEY'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}
```

The project uses `src/core/server/lib/crypto.ts` for AES-256-GCM encryption. All provider API keys must go through `encryptText()` before DB writes and `decryptText()` after reads. The `ENCRYPTION_KEY` env var must be a 64-char hex string (256-bit). Without it, the server uses an ephemeral random key — encrypted DB values become unreadable after restart.

---

## 7. Error Handling — Never Swallow

### The Rule
Every async route handler must either:
- Catch errors and return a structured error response with an appropriate HTTP status
- Pass the error to `next(err)` for the centralized error handler

Never:
- `catch (e) { console.error(e) }` — logs but caller sees 200, state is unknown
- `catch (e) { res.json({ ok: false }) }` — still 200, no error detail
- Let async routes throw without a catch (unhandled rejection crashes the process)

```typescript
// CORRECT pattern — wrap or use try/catch with next()
router.post('/config', requireOwner, async (req, res, next) => {
  try {
    const updated = await updateRuntimeConfig(validatedPatch);
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err); // goes to centralized error handler
  }
});
```

The centralized error handler (`src/core/server/middleware/` or inline in `index.ts`) must be the **last** `app.use()` call. In production it must not return stack traces.

---

## 8. React Admin UI Patterns

### Always Fetch on Mount
Never initialize form state from hardcoded defaults. Always fetch from the API on mount. Show a loading state until resolved.

```tsx
useEffect(() => {
  adminApi.getConfig()
    .then(res => setSimConfig(res.data as RuntimeConfig))
    .catch(err => setError(err.message))
    .finally(() => setLoading(false));
}, []);
```

### Reconcile State From Server Response
After a save, update displayed state from the server response — not from what was submitted. The server may have clamped, coerced, or rejected a value.

```tsx
// WRONG — assumes save worked and uses submitted values
setConfig(submittedValues);

// CORRECT — use what the server actually stored
const saved = await adminApi.setConfig(patch);
setSimConfig(saved.data as RuntimeConfig); // server is source of truth
```

### Surface Errors in UI, Not Just Console
Every async operation that can fail must have a rendered error state. `console.error` only is a silent failure from the user's perspective.

### Disabled State During Saves
Track `saving` boolean. Disable the save button while a request is in flight. Prevents double-submit race conditions.

### The Half-Implementation Test
Before merging any config control:
1. Fresh browser tab — do values load from DB?
2. Change a value, save — does the API get called?
3. Does the API write to DB?
4. Hard refresh — is the new value still there?
5. Simulate API error — does the UI show an error?

If any step fails, the feature is not complete.

---

## 9. Security Headers, CORS, Rate Limiting

### CORS
Never use wildcard `*` on authenticated APIs. Maintain an explicit origin allowlist.

```typescript
// WRONG
app.use(cors()); // allows all origins

// CORRECT
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://agorabench.com', 'https://www.agorabench.com']
    : ['http://localhost:5173', 'http://10.0.0.10:5173'],
  credentials: true,
}));
```

The current `CORS_ORIGINS` env var on the Linux box is set correctly. Do not remove it.

### Rate Limiting
Admin and config-change endpoints should have rate limiting. In a Redis-backed deployment, use a Redis store — in-memory stores are per-process and trivially bypassed with multiple requests.

### Helmet
`helmet()` should be applied for secure HTTP headers (X-Content-Type-Options, X-Frame-Options, etc.).

---

## 10. Logging — What To and What Never To

### Never Log
- JWT tokens or session IDs (full value)
- API keys, OAuth tokens, encryption keys
- `req.body` on auth endpoints
- `Authorization` header values
- `ENCRYPTION_KEY`, `CLERK_SECRET_KEY`, `BOB_ORCHESTRATOR_KEY`, or any `*_KEY` env var

### Do Log
- Request method, path, status, duration
- Auth failures with IP
- Admin actions: who did what, when
- Errors: full stack trace server-side, correlation ID to client
- Tick start/complete, phase completion, LLM response times

---

## 11. Pre-Deploy Checklist

Run before every production deployment.

### Auth
- [ ] No route under `/api` or `/admin` is missing auth middleware
- [ ] `requireOwner` applied to all admin mutation endpoints
- [ ] `requireOrchestrator` applied to all `/orchestrator` endpoints

### Input Validation
- [ ] Every `POST`/`PUT`/`PATCH` handler whitelists and validates body fields
- [ ] No `req.body` spread directly into DB calls or `updateRuntimeConfig`

### Config Completeness
- [ ] Every field in `RuntimeConfig` has a handler branch in `POST /admin/config`
- [ ] Every field in `RuntimeConfig` has a UI control in AdminPage.tsx
- [ ] Client-side `RuntimeConfig` interface matches server-side type

### Secrets
- [ ] `ENCRYPTION_KEY` is set (64 hex chars) — not empty, not a dev placeholder
- [ ] `CLERK_SECRET_KEY` is the live key, not the test key
- [ ] `BOB_ORCHESTRATOR_KEY` is set
- [ ] No secrets committed to git (`git log --all -p | grep -i "sk-\|_KEY=\|_SECRET="`)

### Database
- [ ] All pending migrations applied on deploy target
- [ ] No migration files edited — only new files added
- [ ] Any `ANY()` in raw SQL uses `inArray()` or `sql.array()` with type cast

### Error Handling
- [ ] Centralized error handler is last `app.use()` in server setup
- [ ] No catch blocks that swallow errors without response

### Deployment
- [ ] Server restarts cleanly on deploy target (`tail /tmp/molt-gov.log`)
- [ ] `[CONFIG] Loaded runtime config from database` appears in startup logs (not "Failed to load config")
- [ ] No `[CRYPTO]` ephemeral key warnings in startup logs

---

## 12. Feature Completeness Test

For every new RuntimeConfig field, verify all four columns are checked before merging:

| Field | Server handler branch | UI control | Client interface | DB persisted |
|-------|----------------------|------------|-----------------|--------------|
| (new field) | [ ] admin.ts POST /config | [ ] AdminPage.tsx | [ ] RuntimeConfig interface | [ ] updateRuntimeConfig writes it |

For every new API endpoint, verify:

| Endpoint | Auth middleware | Input validated | Response typed | Error handled |
|----------|---------------|----------------|---------------|---------------|
| (new endpoint) | [ ] requireOwner/requireOrchestrator | [ ] fields whitelisted + typed | [ ] shared type | [ ] try/catch + next(err) |
