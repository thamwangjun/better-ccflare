---
phase: 260712-mqk-fix-post-processor-worker-ts-missing-ori
plan: 01
subsystem: proxy
tags: [bun-worker, usage-tracking, model-rewrite, sqlite, postgres]

# Dependency graph
requires:
  - phase: model-rewrite-tracking (upstream merge)
    provides: isModelRewrite() predicate + StartMessage.originalModel/appliedModel fields in worker-messages.ts; already-correct persistence logic in usage-collector.ts
provides:
  - post-processor.worker.ts (the primary/healthy-path request processor) now forwards originalModel/appliedModel to dbOps.saveRequest(...) and to the RequestResponse summary, matching usage-collector.ts's fallback-path behavior
affects: [dashboard-model-rewrite-display, usage-analytics]

# Tech tracking
tech-stack:
  added: []
  patterns: [Bun Worker isolated-scope duplication of main-thread logic — usage-collector.ts and post-processor.worker.ts must be kept in sync manually since the worker cannot import the main-thread singleton]

key-files:
  created: []
  modified:
    - packages/proxy/src/post-processor.worker.ts

key-decisions:
  - "isModelRewrite import placed as a separate value import statement (not merged into the existing import type block) to avoid restructuring the existing type-only import list; Biome's import organizer then resorted it to appear after the import type block alphabetically — this is tool-enforced formatting, not a manual placement choice, and required no follow-up fix."

requirements-completed: []

# Metrics
duration: 8min
completed: 2026-07-12
---

# Phase 260712-mqk Plan 01: Mirror originalModel/appliedModel forwarding into post-processor.worker.ts Summary

**Fixed the primary-path Bun Worker (post-processor.worker.ts) to forward model-rewrite tracking fields to the database and live dashboard summary, closing the gap where the newly-merged agent-model-rewrite feature was silently non-functional for the overwhelming majority of production requests.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-12T16:20:00Z
- **Completed:** 2026-07-12T16:28:00Z
- **Tasks:** 1 completed
- **Files modified:** 1

## Accomplishments
- `post-processor.worker.ts` now imports `isModelRewrite` from `./worker-messages`
- `handleEndInternal` computes `modelRewritten` before enqueueing the DB write, mirroring `usage-collector.ts`'s `_handleEndInternal` exactly (same variable name, same placement, same comment)
- `dbOps.saveRequest(...)` now passes `modelRewritten ? startMessage.originalModel : null` and `modelRewritten ? startMessage.appliedModel : null` as two additional trailing positional args
- The `summary: RequestResponse` object posted back to the main thread now includes `originalModel`/`appliedModel` fields, positioned after `billingType` and before `comboName` — identical field ordering to `usage-collector.ts`

## Task Commits

1. **Task 1: Mirror originalModel/appliedModel forwarding from usage-collector.ts into post-processor.worker.ts** - `f2c3a1f8` (fix)

_No separate plan-metadata commit was created per this repo's quick-task convention — the single task commit and this SUMMARY constitute the full deliverable._

## Files Created/Modified
- `packages/proxy/src/post-processor.worker.ts` - Added `isModelRewrite` import, `modelRewritten` computation, two trailing `saveRequest` args, and two `RequestResponse` summary fields — bringing the primary Worker path to parity with the already-correct `usage-collector.ts` fallback path.

## Decisions Made
- Pre-edit verification: confirmed `worker-messages.ts` already exports `isModelRewrite` and `StartMessage` already has `originalModel`/`appliedModel` fields before touching any code, per the dispatch instructions, since a missing export would have indicated a stale commit. Confirmed present — proceeded.
- Placed the new `import { isModelRewrite } from "./worker-messages";` as a standalone value import rather than merging it into the existing `import type { ... }` block, to avoid restructuring the existing type-only import list (per the plan's explicit guidance). Biome's `bun run format` subsequently resorted the two import statements (moving the value import after the type import, alphabetically) — this is automatic tool-enforced import ordering, not a manual placement decision, and is reflected in the final committed diff.

## Deviations from Plan

None - plan executed exactly as written. All 4 mechanical changes were made precisely as specified, no other lines were touched, and no refactoring occurred.

## Issues Encountered

None. `worker-messages.ts` was confirmed to already have `isModelRewrite` exported and `StartMessage.originalModel`/`appliedModel` fields present before editing, confirming the working directory was on the expected commit (post-merge of the model-rewrite tracking feature).

## User Setup Required

None - no external service configuration required. This is a pure code-level fix; no schema changes, no new environment variables.

## Next Phase Readiness

- The primary Worker path and the fallback `UsageCollector` path are now behaviorally identical for model-rewrite tracking. Both `original_model`/`applied_model` DB columns will populate correctly regardless of which path handles a given request (healthy Worker vs. stopped-Worker fallback).
- The live dashboard summary SSE event will now surface `originalModel`/`appliedModel` for rewritten-model requests processed via the Worker path (previously only worked via the fallback path).
- No blockers. This fix is self-contained and does not require any follow-up work.

## Verification Results

1. `bun test packages/proxy/src/__tests__/worker-messages.test.ts` — **5 pass, 0 fail, 8 expect() calls**. Confirms the shared `isModelRewrite()` predicate (imported by the fixed file) still behaves correctly; no regression.
2. `bun run typecheck` (`bunx tsc --noEmit`) — **passes with zero errors**. Confirms the new import, `modelRewritten` computation, the 2 extra `saveRequest` args, and the 2 extra `RequestResponse` summary fields all type-check cleanly against `database-operations.ts`'s signature and the `RequestResponse` type in `@better-ccflare/types`.
3. Manual diff comparison: the modified region of `handleEndInternal` in `post-processor.worker.ts` was read back and compared line-by-line against `_handleEndInternal` in `usage-collector.ts` — the 4 changed spots (import, `modelRewritten` computation with identical comment, `saveRequest` args, summary fields) match variable names, expressions, and relative placement exactly, differing only in pre-existing worker-specific mechanics (function vs. class method, `self.postMessage` vs. `onSummary` callback).
4. `bun run lint` (`bunx biome check .`) — 248 pre-existing warnings across the repo (unrelated files: `ModelTokenSpeedChart.tsx`, `proxy-operations.ts`, `token-health-service.ts`, `usage-worker-controller.ts`, etc.), **zero new issues in `post-processor.worker.ts`** (confirmed via targeted `bunx biome check packages/proxy/src/post-processor.worker.ts` → "Checked 1 file... No fixes applied").
5. `bun run format` (`bunx biome format --write .`) — **no formatting changes applied to `post-processor.worker.ts`**; the file was already correctly formatted after the edits.

## Self-Check

- `packages/proxy/src/post-processor.worker.ts` — FOUND (modified, verified via `git diff`)
- Commit `f2c3a1f8` — FOUND (verified via `git log --oneline`)

---
*Phase: 260712-mqk-fix-post-processor-worker-ts-missing-ori*
*Completed: 2026-07-12*
