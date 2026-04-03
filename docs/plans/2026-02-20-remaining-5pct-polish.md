# Remaining 5% Polish — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add logging to 42+ silent catch blocks, fix stale vitest aliases so all existing tests pass, and implement the two placeholder benchmark metrics.

**Architecture:** Pure mechanical changes — no new features, no control-flow changes. Phase 1 adds `console.error`/`console.warn` to existing catch blocks. Phase 2 updates vitest config aliases. Phase 3 implements two metrics using existing DB data.

**Tech Stack:** TypeScript, Vitest, Drizzle ORM

---

### Task 1: Server-side error handling — auth, AGGE, AI

**Files:**
- Modify: `src/core/server/middleware/auth.ts:60`
- Modify: `src/core/server/jobs/aggeTick.ts:59`
- Modify: `src/core/server/services/ai.ts:521-523,553,566,616,649,653,673,687`
- Modify: `src/core/server/jobs/agentTick.ts:1864`

**Step 1: Fix auth.ts silent catch**

In `src/core/server/middleware/auth.ts:60`, change:
```typescript
  } catch {
    // Non-fatal — don't break auth if Clerk API is temporarily down
    syncedAt.set(clerkUserId, Date.now());
  }
```
To:
```typescript
  } catch (err) {
    // Non-fatal — don't break auth if Clerk API is temporarily down
    console.warn('[AUTH] Clerk profile sync failed:', err instanceof Error ? err.message : err);
    syncedAt.set(clerkUserId, Date.now());
  }
```

**Step 2: Fix aggeTick.ts JSON parse catch**

In `src/core/server/jobs/aggeTick.ts:59`, change:
```typescript
  } catch {
    return null;
  }
```
To:
```typescript
  } catch (err) {
    console.warn('[AGGE] JSON parse failed:', err instanceof Error ? err.message : err);
    return null;
  }
```

**Step 3: Fix ai.ts context builder catches**

In `src/core/server/services/ai.ts:520-524`, change:
```typescript
  const [memory, forumContext, congressContext] = await Promise.all([
    buildMemoryBlock(agent.id).catch(() => ''),
    buildForumContextBlock().catch(() => ''),
    buildCongressContextBlock().catch(() => ''),
  ]);
```
To:
```typescript
  const [memory, forumContext, congressContext] = await Promise.all([
    buildMemoryBlock(agent.id).catch((err) => { console.warn('[AI] Memory block failed:', err instanceof Error ? err.message : err); return ''; }),
    buildForumContextBlock().catch((err) => { console.warn('[AI] Forum context failed:', err instanceof Error ? err.message : err); return ''; }),
    buildCongressContextBlock().catch((err) => { console.warn('[AI] Congress context failed:', err instanceof Error ? err.message : err); return ''; }),
  ]);
```

**Step 4: Fix ai.ts decision insert catches**

In `src/core/server/services/ai.ts`, there are 4 `.catch(() => {/* non-fatal */})` on `db.insert(agentDecisions)` calls at lines 553, 616, 649, and 673. Change each from:
```typescript
    }).catch(() => {/* non-fatal */});
```
To:
```typescript
    }).catch((err) => { console.warn('[AI] Decision log insert failed:', err instanceof Error ? err.message : err); });
```

**Step 5: Fix ai.ts JSON parse catch (line 566)**

In `src/core/server/services/ai.ts:565-566`, change:
```typescript
      try { decision = JSON.parse(jsonSubstr) as AgentDecision; }
      catch { try { decision = JSON.parse(sanitizeJsonString(jsonSubstr)) as AgentDecision; } catch { /* fall through to partial recovery */ } }
```
To:
```typescript
      try { decision = JSON.parse(jsonSubstr) as AgentDecision; }
      catch { try { decision = JSON.parse(sanitizeJsonString(jsonSubstr)) as AgentDecision; } catch (err) { console.warn('[AI] JSON parse failed after sanitize:', err instanceof Error ? err.message : err); } }
```

**Step 6: Fix ai.ts retry catch (line 653)**

In `src/core/server/services/ai.ts:653-655`, change:
```typescript
        } catch {
          /* retry API call failed */
        }
```
To:
```typescript
        } catch (err) {
          console.warn('[AI] Retry API call failed:', err instanceof Error ? err.message : err);
        }
```

**Step 7: Fix ai.ts final decision log catch (line 687)**

In `src/core/server/services/ai.ts:687`, same pattern as Step 4:
```typescript
    }).catch(() => {/* non-fatal */});
```
To:
```typescript
    }).catch((err) => { console.warn('[AI] Decision log insert failed:', err instanceof Error ? err.message : err); });
```

**Step 8: Fix agentTick.ts simulation state catch**

In `src/core/server/jobs/agentTick.ts:1864`, change:
```typescript
    const simState = await buildSimulationStateBlock().catch(() => ({ block: '', threadTitles: [] as string[] }));
```
To:
```typescript
    const simState = await buildSimulationStateBlock().catch((err) => { console.warn('[TICK] Simulation state build failed:', err instanceof Error ? err.message : err); return { block: '', threadTitles: [] as string[] }; });
```

**Step 9: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 10: Commit**

```bash
git add src/core/server/middleware/auth.ts src/core/server/jobs/aggeTick.ts src/core/server/services/ai.ts src/core/server/jobs/agentTick.ts
git commit -m "fix: add logging to silent server-side catch blocks"
```

---

### Task 2: Server-side error handling — route handlers

**Files:**
- Modify: `src/modules/admin/server/routes/providers.ts:25`
- Modify: `src/modules/admin/server/routes/profile.ts:15`
- Modify: `src/modules/benchmark/server/routes/demos.ts:1226`

**Step 1: Fix providers.ts maskKey catch**

In `src/modules/admin/server/routes/providers.ts:25`, change:
```typescript
  } catch { return '****'; }
```
To:
```typescript
  } catch (err) { console.warn('[PROVIDERS] Key decryption failed:', err instanceof Error ? err.message : err); return '****'; }
```

**Step 2: Fix profile.ts maskKey catch**

In `src/modules/admin/server/routes/profile.ts:15`, change:
```typescript
  } catch { return '****'; }
```
To:
```typescript
  } catch (err) { console.warn('[PROFILE] Key decryption failed:', err instanceof Error ? err.message : err); return '****'; }
```

**Step 3: Fix demos.ts tmpdir cleanup catch**

In `src/modules/benchmark/server/routes/demos.ts:1226`, change:
```typescript
      rm(tmpDir, { recursive: true }).catch(() => {});
```
To:
```typescript
      rm(tmpDir, { recursive: true }).catch((err) => { console.warn('[DEMOS] Temp dir cleanup failed:', err instanceof Error ? err.message : err); });
```

**Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/modules/admin/server/routes/providers.ts src/modules/admin/server/routes/profile.ts src/modules/benchmark/server/routes/demos.ts
git commit -m "fix: add logging to silent server route catch blocks"
```

---

### Task 3: Client-side error handling — AdminPage.tsx

**Files:**
- Modify: `src/modules/admin/client/pages/AdminPage.tsx`

This file has the highest concentration of silent catches. All 10 fetch callbacks (lines 414-486) use `catch { /* ignore */ }` or `catch { /* silent */ }`.

**Step 1: Add logging to all 10 fetch callbacks**

Change each of these patterns:

Line 414: `} catch { /* silent */ }` → `} catch (err) { console.error('[ADMIN] fetchResearcherRequests failed:', err); }`
Line 423: `} catch { /* ignore */ }` → `} catch (err) { console.error('[ADMIN] fetchStatus failed:', err); }`
Line 432: `} catch { /* ignore */ }` → `} catch (err) { console.error('[ADMIN] fetchDecisions failed:', err); }`
Line 441: `} catch { /* ignore */ }` → `} catch (err) { console.error('[ADMIN] fetchConfig failed:', err); }`
Line 448: `} catch { /* ignore */ }` → `} catch (err) { console.error('[ADMIN] fetchEconomy failed:', err); }`
Line 455: `} catch { /* ignore */ }` → `} catch (err) { console.error('[ADMIN] fetchAgents failed:', err); }`
Line 464: `} catch { /* ignore */ }` → `} catch (err) { console.error('[ADMIN] fetchAvatarAgents failed:', err); }`
Line 471: `} catch { /* ignore */ }` → `} catch (err) { console.error('[ADMIN] fetchProviders failed:', err); }`
Line 478: `} catch { /* ignore */ }` → `} catch (err) { console.error('[ADMIN] fetchUsers failed:', err); }`
Line 485: `} catch { /* ignore */ }` → `} catch (err) { console.error('[ADMIN] fetchExportCounts failed:', err); }`

**Step 2: Add logging to action catches**

Line 567: `} catch {` → `} catch (err) { console.error('[ADMIN] saveConfig failed:', err);`
Line 580: `} catch {` → `} catch (err) { console.error('[ADMIN] saveEconomy failed:', err);`
Line 618: `} catch {` → `} catch (err) { console.error('[ADMIN] providerSave failed:', err);`
Line 630: `} catch {` → `} catch (err) { console.error('[ADMIN] providerTest failed:', err);`
Line 642: `} catch {` → `} catch (err) { console.error('[ADMIN] providerClear failed:', err);`
Line 665: `} catch { /* fall through */ }` → `} catch (err) { console.warn('[ADMIN] Avatar config parse failed:', err); }`
Line 683: `} catch {` → `} catch (err) { console.error('[ADMIN] saveAvatar failed:', err);`
Line 1826: `} catch { flash('Failed to update role'); }` → `} catch (err) { console.error('[ADMIN] setUserRole failed:', err); flash('Failed to update role'); }`

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/modules/admin/client/pages/AdminPage.tsx
git commit -m "fix: add logging to all silent catches in AdminPage"
```

---

### Task 4: Client-side error handling — ObserverPage.tsx

**Files:**
- Modify: `src/modules/admin/client/pages/ObserverPage.tsx`

All `.catch(() => {})` on lines 189, 198, 208, 222, 245, 252, 266.

**Step 1: Add logging to all catch blocks**

Change every `.catch(() => {})` to `.catch((err) => { console.error('[OBSERVER] Data fetch failed:', err); })`.

There are 7 instances. Each one follows the same pattern — find `.catch(() => {});` and replace.

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/modules/admin/client/pages/ObserverPage.tsx
git commit -m "fix: add logging to all silent catches in ObserverPage"
```

---

### Task 5: Client-side error handling — remaining pages

**Files:**
- Modify: `src/core/client/components/LiveTicker.tsx:95`
- Modify: `src/core/client/components/Layout.tsx:262`
- Modify: `src/modules/forum/client/components/ForumWidget.tsx:42,51`
- Modify: `src/modules/legislation/client/pages/LawsPage.tsx:84`
- Modify: `src/modules/legislation/client/pages/CourtPage.tsx:60`
- Modify: `src/modules/elections/client/pages/PartyDetailPage.tsx:59`
- Modify: `src/modules/agents/client/pages/AgentProfilePage.tsx:698`
- Modify: `src/modules/government/client/pages/BuildingInteriorPage.tsx:128`
- Modify: `src/modules/admin/client/pages/ProfilePage.tsx:110,730,740,748`
- Modify: `src/modules/admin/client/pages/ResearcherPage.tsx:155,173,207,601,614,802`

**Step 1: LiveTicker.tsx**

Line 95: `.catch(() => {})` → `.catch((err) => { console.error('[TICKER] Activity fetch failed:', err); })`

**Step 2: Layout.tsx**

Line 262: `.catch(() => setUserRole(null))` → `.catch((err) => { console.warn('[LAYOUT] Role fetch failed:', err); setUserRole(null); })`

**Step 3: ForumWidget.tsx**

Line 42: `.catch(() => {})` → `.catch((err) => { console.error('[FORUM] Latest threads fetch failed:', err); })`
Line 51: `.catch(() => {})` → `.catch((err) => { console.error('[FORUM] Thread refresh failed:', err); })`

**Step 4: LawsPage.tsx**

Line 84: `.catch(() => {})` → `.catch((err) => { console.error('[LAWS] Laws fetch failed:', err); })`

**Step 5: CourtPage.tsx**

Line 60: `.catch(() => {})` → `.catch((err) => { console.error('[COURT] Court data fetch failed:', err); })`

**Step 6: PartyDetailPage.tsx**

Line 59: `} catch { return undefined; }` → `} catch (err) { console.warn('[PARTY] Avatar config parse failed:', err); return undefined; }`

**Step 7: AgentProfilePage.tsx**

Line 698: `.catch(() => setNotFound(true))` → `.catch((err) => { console.error('[AGENT] Profile fetch failed:', err); setNotFound(true); })`

**Step 8: BuildingInteriorPage.tsx**

Line 128: `.catch(() => {})` → `.catch((err) => { console.warn('[BUILDING] Clipboard write failed:', err); })`

**Step 9: ProfilePage.tsx**

Line 110: `} catch { /* fall */ }` → `} catch (err) { console.warn('[PROFILE] Avatar config parse failed:', err); }`
Line 730: `catch { /* ignore */ }` → `catch (err) { console.warn('[PROFILE] Data fetch failed:', err); }`
Line 740: `.catch(() => null)` → `.catch((err) => { console.warn('[PROFILE] Profile fetch failed:', err); return null; })`
Line 748: `.catch(() => setResearcherRequest(null))` → `.catch((err) => { console.warn('[PROFILE] Researcher request fetch failed:', err); setResearcherRequest(null); })`

**Step 10: ResearcherPage.tsx**

Line 155: `} catch {` → `} catch (err) { console.warn('[RESEARCHER] Date format failed:', err);`
Line 173: `} catch {` → `} catch (err) { console.warn('[RESEARCHER] Relative time failed:', err);`
Line 207: `} catch {` → `} catch (err) { console.error('[RESEARCHER] Agent withdraw failed:', err);`
Line 601: `} catch {` → `} catch (err) { console.error('[RESEARCHER] API key save failed:', err);`
Line 614: `} catch {` → `} catch (err) { console.error('[RESEARCHER] API key delete failed:', err);`
Line 802: `} catch {` → `} catch (err) { console.error('[RESEARCHER] Export download failed:', err);`

**Step 11: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 12: Commit**

```bash
git add src/core/client/components/LiveTicker.tsx src/core/client/components/Layout.tsx \
  src/modules/forum/client/components/ForumWidget.tsx \
  src/modules/legislation/client/pages/LawsPage.tsx src/modules/legislation/client/pages/CourtPage.tsx \
  src/modules/elections/client/pages/PartyDetailPage.tsx \
  src/modules/agents/client/pages/AgentProfilePage.tsx \
  src/modules/government/client/pages/BuildingInteriorPage.tsx \
  src/modules/admin/client/pages/ProfilePage.tsx src/modules/admin/client/pages/ResearcherPage.tsx
git commit -m "fix: add logging to all remaining silent client-side catches"
```

---

### Task 6: Fix vitest config aliases

**Files:**
- Modify: `vitest.config.ts`

**Step 1: Update aliases to match new modular structure**

Change `vitest.config.ts` from:
```typescript
    alias: {
      '@client': path.resolve(__dirname, 'src/client'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@server': path.resolve(__dirname, 'src/server'),
      '@db': path.resolve(__dirname, 'src/db'),
    },
```
To:
```typescript
    alias: {
      '@modules': path.resolve(__dirname, 'src/modules'),
      '@core': path.resolve(__dirname, 'src/core'),
      '@shared': path.resolve(__dirname, 'src/core/shared'),
      '@db': path.resolve(__dirname, 'src/core/db'),
    },
```

**Step 2: Run tests**

Run: `npx vitest run`
Expected: All 4 test files pass (~192 tests)

**Step 3: If any test fails, check import paths**

The test files use:
- `@shared/constants` → should resolve to `src/core/shared/constants`
- `@shared/validation` → should resolve to `src/core/shared/validation`
- `@core/client/components/SectionHeader` → should resolve to `src/core/client/components/SectionHeader`
- Relative imports like `../../../src/modules/elections/client/components/BranchCard` → still valid

If imports fail, update the test file import paths to match.

**Step 4: Commit**

```bash
git add vitest.config.ts
git commit -m "fix: update vitest aliases to match modular refactor structure"
```

---

### Task 7: Implement adversarialResilience metric

**Files:**
- Modify: `src/modules/benchmark/server/services/benchmarkMetrics.ts:473-479`
- Modify: `tests/unit/server/benchmarkMetrics.test.ts` (add tests)

**Context:** The `computeAdversarialResilience` function currently returns `null`. It should measure how well agents maintain governance quality under adversarial conditions.

**Approach:** Given existing data types in the file, measure the ratio of governance quality scores for agents who faced high opposition (>50% nay votes on their sponsored bills) vs all agents. A resilient system maintains quality even under pressure.

The function signature should accept `SimDecision[]` (decisions) and `SimVote[]` (votes) and `SimBill[]` (bills), matching the types already used throughout the file.

**Step 1: Write failing tests**

Add to `tests/unit/server/benchmarkMetrics.test.ts`:

```typescript
describe('computeAdversarialResilience', () => {
  it('returns null when no decisions exist', () => {
    expect(computeAdversarialResilience([], [], [])).toBeNull();
  });

  it('returns null when no bills have sponsors', () => {
    const decisions: SimDecision[] = [
      { agentId: 'a1', phase: 'bill_voting', action: 'vote', success: true, latencyMs: 100, reasoningLength: 50 },
    ];
    expect(computeAdversarialResilience(decisions, [], [])).toBeNull();
  });

  it('returns 1.0 when all agents have equal success under opposition', () => {
    const bills: SimBill[] = [
      { id: 'b1', sponsorId: 'a1', status: 'enacted', committee: 'finance', introducedAt: new Date(), resolvedAt: new Date() },
    ];
    const votes: SimVote[] = [
      { agentId: 'a2', billId: 'b1', choice: 'nay', partyId: 'p1' },
      { agentId: 'a3', billId: 'b1', choice: 'nay', partyId: 'p2' },
      { agentId: 'a4', billId: 'b1', choice: 'yea', partyId: 'p1' },
    ];
    const decisions: SimDecision[] = [
      { agentId: 'a1', phase: 'bill_proposal', action: 'propose', success: true, latencyMs: 100, reasoningLength: 50 },
      { agentId: 'a2', phase: 'bill_voting', action: 'vote', success: true, latencyMs: 100, reasoningLength: 50 },
    ];
    const result = computeAdversarialResilience(decisions, votes, bills);
    expect(result).toBeTypeOf('number');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('returns value between 0 and 1', () => {
    const bills: SimBill[] = [
      { id: 'b1', sponsorId: 'a1', status: 'enacted', committee: 'finance', introducedAt: new Date(), resolvedAt: new Date() },
      { id: 'b2', sponsorId: 'a2', status: 'failed', committee: 'finance', introducedAt: new Date(), resolvedAt: new Date() },
    ];
    const votes: SimVote[] = [
      { agentId: 'a3', billId: 'b1', choice: 'nay', partyId: 'p1' },
      { agentId: 'a4', billId: 'b1', choice: 'nay', partyId: 'p2' },
      { agentId: 'a5', billId: 'b1', choice: 'yea', partyId: 'p1' },
      { agentId: 'a3', billId: 'b2', choice: 'yea', partyId: 'p1' },
      { agentId: 'a4', billId: 'b2', choice: 'yea', partyId: 'p2' },
    ];
    const decisions: SimDecision[] = [
      { agentId: 'a1', phase: 'bill_proposal', action: 'propose', success: true, latencyMs: 100, reasoningLength: 50 },
      { agentId: 'a1', phase: 'bill_voting', action: 'vote', success: true, latencyMs: 100, reasoningLength: 50 },
      { agentId: 'a2', phase: 'bill_proposal', action: 'propose', success: true, latencyMs: 100, reasoningLength: 50 },
      { agentId: 'a2', phase: 'bill_voting', action: 'vote', success: false, latencyMs: 100, reasoningLength: 10 },
    ];
    const result = computeAdversarialResilience(decisions, votes, bills);
    expect(result).toBeTypeOf('number');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/server/benchmarkMetrics.test.ts`
Expected: New tests fail (function returns null, not number)

**Step 3: Implement the metric**

In `src/modules/benchmark/server/services/benchmarkMetrics.ts`, replace:
```typescript
/**
 * Placeholder for adversarial resilience (Phase 5).
 * Returns null until event injection system is built.
 */
export function computeAdversarialResilience(): number | null {
  return null;
}
```
With:
```typescript
/**
 * Adversarial resilience: measures how well agents maintain decision quality
 * when facing opposition. Compares success rate of agents whose sponsored
 * bills faced majority nay votes vs. overall agent success rate.
 *
 * Returns null when insufficient data (no bills with sponsors).
 * Range: 0.0 (collapses under opposition) to 1.0 (fully resilient).
 */
export function computeAdversarialResilience(
  decisions: SimDecision[],
  votes: SimVote[],
  bills: SimBill[],
): number | null {
  if (decisions.length === 0 || bills.length === 0) return null;

  // Find agents who sponsored bills that faced majority nay votes
  const adversarialAgents = new Set<string>();
  for (const bill of bills) {
    if (!bill.sponsorId) continue;
    const billVotes = votes.filter((v) => v.billId === bill.id);
    if (billVotes.length === 0) continue;
    const nayRate = billVotes.filter((v) => v.choice === 'nay').length / billVotes.length;
    if (nayRate > 0.5) adversarialAgents.add(bill.sponsorId);
  }

  if (adversarialAgents.size === 0) return null;

  // Success rate for adversarial agents
  const adversarialDecisions = decisions.filter((d) => adversarialAgents.has(d.agentId));
  if (adversarialDecisions.length === 0) return null;
  const adversarialSuccessRate = adversarialDecisions.filter((d) => d.success).length / adversarialDecisions.length;

  // Overall success rate
  const overallSuccessRate = decisions.filter((d) => d.success).length / decisions.length;
  if (overallSuccessRate === 0) return 0;

  // Ratio capped at 1.0
  return Math.min(adversarialSuccessRate / overallSuccessRate, 1);
}
```

**Step 4: Update all callers**

The function is called in `computeAllCoordinationMetrics`. Find that function and update the call from `computeAdversarialResilience()` to `computeAdversarialResilience(decisions, votes, bills)`.

Also update `computeAllCoordinationMetrics` signature to accept `decisions: SimDecision[]` and `bills: SimBill[]` if it doesn't already.

**Step 5: Run tests**

Run: `npx vitest run tests/unit/server/benchmarkMetrics.test.ts`
Expected: All tests pass

**Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add src/modules/benchmark/server/services/benchmarkMetrics.ts tests/unit/server/benchmarkMetrics.test.ts
git commit -m "feat: implement adversarialResilience metric using sponsorship opposition data"
```

---

### Task 8: Implement coalitionStability metric

**Files:**
- Modify: `src/modules/benchmark/server/services/benchmarkMetrics.ts:574`
- Modify: `tests/unit/server/benchmarkMetrics.test.ts` (add tests)

**Context:** `coalitionStability` in `OutcomeMetrics` is always `null`. It should measure how stable cross-party voting coalitions are over time.

**Approach:** Calculate the standard deviation of cross-party agreement rates across bills. Low variance = stable coalitions. Normalize to 0-1 where 1 = perfectly stable.

**Step 1: Write failing tests**

Add to `tests/unit/server/benchmarkMetrics.test.ts`:

```typescript
describe('computeCoalitionStability', () => {
  it('returns null when fewer than 2 bills have votes', () => {
    expect(computeCoalitionStability([], [])).toBeNull();
  });

  it('returns 1.0 when all bills have identical cross-party agreement', () => {
    const memberships: SimPartyMembership[] = [
      { agentId: 'a1', partyId: 'p1' },
      { agentId: 'a2', partyId: 'p2' },
    ];
    const votes: SimVote[] = [
      { agentId: 'a1', billId: 'b1', choice: 'yea', partyId: 'p1' },
      { agentId: 'a2', billId: 'b1', choice: 'yea', partyId: 'p2' },
      { agentId: 'a1', billId: 'b2', choice: 'yea', partyId: 'p1' },
      { agentId: 'a2', billId: 'b2', choice: 'yea', partyId: 'p2' },
    ];
    const result = computeCoalitionStability(votes, memberships);
    expect(result).toBe(1);
  });

  it('returns value between 0 and 1', () => {
    const memberships: SimPartyMembership[] = [
      { agentId: 'a1', partyId: 'p1' },
      { agentId: 'a2', partyId: 'p2' },
      { agentId: 'a3', partyId: 'p1' },
    ];
    const votes: SimVote[] = [
      { agentId: 'a1', billId: 'b1', choice: 'yea', partyId: 'p1' },
      { agentId: 'a2', billId: 'b1', choice: 'yea', partyId: 'p2' },
      { agentId: 'a3', billId: 'b1', choice: 'yea', partyId: 'p1' },
      { agentId: 'a1', billId: 'b2', choice: 'yea', partyId: 'p1' },
      { agentId: 'a2', billId: 'b2', choice: 'nay', partyId: 'p2' },
      { agentId: 'a3', billId: 'b2', choice: 'nay', partyId: 'p1' },
    ];
    const result = computeCoalitionStability(votes, memberships);
    expect(result).toBeTypeOf('number');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/server/benchmarkMetrics.test.ts`
Expected: Fails — function not found

**Step 3: Implement the metric**

Add to `src/modules/benchmark/server/services/benchmarkMetrics.ts` (near the other outcome metric functions):

```typescript
/**
 * Coalition stability: measures consistency of cross-party voting patterns.
 * For each bill, computes the cross-party agreement rate (fraction of
 * cross-party voter pairs that voted the same way). Returns 1 - stddev
 * of these per-bill rates. High stability = consistent coalitions.
 *
 * Returns null when fewer than 2 bills have cross-party votes.
 * Range: 0.0 (chaotic) to 1.0 (perfectly stable).
 */
export function computeCoalitionStability(
  votes: SimVote[],
  memberships: SimPartyMembership[],
): number | null {
  const partyMap = new Map(memberships.map((m) => [m.agentId, m.partyId]));

  // Group votes by bill
  const billVotes = new Map<string, SimVote[]>();
  for (const v of votes) {
    const arr = billVotes.get(v.billId) ?? [];
    arr.push(v);
    billVotes.set(v.billId, arr);
  }

  // For each bill, compute cross-party agreement rate
  const rates: number[] = [];
  for (const [, bVotes] of billVotes) {
    let crossPairs = 0;
    let agreePairs = 0;
    for (let i = 0; i < bVotes.length; i++) {
      for (let j = i + 1; j < bVotes.length; j++) {
        const p1 = partyMap.get(bVotes[i].agentId);
        const p2 = partyMap.get(bVotes[j].agentId);
        if (p1 && p2 && p1 !== p2) {
          crossPairs++;
          if (bVotes[i].choice === bVotes[j].choice) agreePairs++;
        }
      }
    }
    if (crossPairs > 0) rates.push(agreePairs / crossPairs);
  }

  if (rates.length < 2) return null;

  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((a, r) => a + (r - mean) ** 2, 0) / rates.length;
  const stddev = Math.sqrt(variance);

  // Normalize: stddev of rates (0-1) max is 0.5, so cap and invert
  return Math.max(0, 1 - stddev * 2);
}
```

**Step 4: Wire into computeAllOutcomeMetrics**

In `computeAllOutcomeMetrics`, replace:
```typescript
    coalitionStability: null, // Reserved for future implementation
```
With:
```typescript
    coalitionStability: computeCoalitionStability(votes, memberships),
```

**Step 5: Run tests**

Run: `npx vitest run tests/unit/server/benchmarkMetrics.test.ts`
Expected: All tests pass

**Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add src/modules/benchmark/server/services/benchmarkMetrics.ts tests/unit/server/benchmarkMetrics.test.ts
git commit -m "feat: implement coalitionStability metric using cross-party voting variance"
```

---

### Task 9: Final verification

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All test files pass

**Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Server smoke test**

Run: `npx pm2 restart agora-bench && sleep 3 && curl -s http://localhost:3001/api/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('success') else 'FAIL')"`
Expected: OK

**Step 4: Commit any remaining fixes**

If any fixes were needed, commit them.
