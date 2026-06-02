# Quick Task 260602-eax: Fix saveRequest cost_usd COALESCE — Summary

**Date:** 2026-06-02
**Commit:** d3a7ac77
**Status:** complete

## What was done

### Task 1: Fix COALESCE in save() ON CONFLICT clause
- **File:** `packages/database/src/repositories/request.repository.ts` (line 87)
- **Change:** `cost_usd = EXCLUDED.cost_usd` → `cost_usd = COALESCE(EXCLUDED.cost_usd, requests.cost_usd)`
- **Rationale:** The `save()` method's `INSERT ... ON CONFLICT DO UPDATE` unconditionally overwrote `cost_usd` with the incoming value. When the post-processor worker's SSE usage.cost parse failed (providerCostUsd stays undefined), `usage?.costUsd ?? null` resolved to `null`, and `EXCLUDED.cost_usd` wrote null over the real cost the live streaming path had already persisted via `updateUsage()`.
- **PG migrations:** Confirmed `migrations-pg.ts` has no ON CONFLICT DO UPDATE clause for the requests table — only DDL. The fix in `request.repository.ts` covers both SQLite and PostgreSQL backends.

### Task 2: Regression test
- **File:** `packages/database/src/repositories/__tests__/request-cost-zero.test.ts`
- **Added:** `save() ON CONFLICT uses COALESCE(EXCLUDED.cost_usd, requests.cost_usd)` — asserts the SQL emitted by save() contains the COALESCE clause, ensuring future edits don't accidentally revert to unconditional overwrite.

## Verification

- `bun test packages/database/src/repositories/__tests__/request-cost-zero.test.ts` — 5/5 pass (0 fail)
- `bun run typecheck` — clean
- `bun run format` — formatted, no fixes needed
- `bun run lint` — 222 pre-existing warnings, no new ones
