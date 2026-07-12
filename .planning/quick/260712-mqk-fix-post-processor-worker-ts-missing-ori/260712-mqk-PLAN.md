---
phase: 260712-mqk-fix-post-processor-worker-ts-missing-ori
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/proxy/src/post-processor.worker.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "A request whose model was rewritten by the agent-preference interceptor and processed via the healthy post-processor Worker (the primary path) persists original_model/applied_model to the database, matching what the in-process UsageCollector fallback already does"
    - "The live dashboard summary SSE event for a rewritten-model request includes originalModel/appliedModel fields when processed via the Worker path"
    - "A request with no model rewrite (or agent-detected-but-unchanged model) persists null for both columns, never duplicating the model column's value"
  artifacts:
    - path: "packages/proxy/src/post-processor.worker.ts"
      provides: "isModelRewrite import, modelRewritten computation, saveRequest trailing args, summary object fields — all mirroring usage-collector.ts exactly"
      contains: "isModelRewrite"
  key_links:
    - from: "packages/proxy/src/post-processor.worker.ts"
      to: "packages/proxy/src/worker-messages.ts"
      via: "import { isModelRewrite } from \"./worker-messages\""
      pattern: "isModelRewrite"
    - from: "packages/proxy/src/post-processor.worker.ts"
      to: "packages/database/src/database-operations.ts"
      via: "dbOps.saveRequest(...) trailing originalModel/appliedModel args"
      pattern: "modelRewritten \\? startMessage\\.originalModel : null"
---

<objective>
Fix `packages/proxy/src/post-processor.worker.ts` (a Bun Worker with isolated module scope, so it duplicates rather than imports `usage-collector.ts`'s persistence logic) so that it forwards `originalModel`/`appliedModel` to `dbOps.saveRequest(...)` and to the `RequestResponse` summary it posts back to the main thread — mirroring the equivalent, already-correct logic in `usage-collector.ts`'s `_handleEndInternal` method exactly.

Purpose: Since the Worker is the primary/healthy-path request processor (the in-process `UsageCollector` is only a fallback active when the worker is stopped), the newly-merged agent-model-rewrite tracking feature is currently silently non-functional for the overwhelming majority of production requests. `original_model`/`applied_model` DB columns never get populated and the dashboard's live summary SSE event never surfaces rewrite info via the Worker path.

Output: `post-processor.worker.ts`'s `handleEndInternal` function updated with the same 4 mechanical changes already present in `usage-collector.ts`'s `_handleEndInternal`, with zero other behavioral changes.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@packages/proxy/src/post-processor.worker.ts
@packages/proxy/src/usage-collector.ts
@packages/proxy/src/worker-messages.ts
@packages/database/src/database-operations.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Mirror originalModel/appliedModel forwarding from usage-collector.ts into post-processor.worker.ts</name>
  <files>packages/proxy/src/post-processor.worker.ts</files>
  <action>
Make exactly 4 mechanical changes to `post-processor.worker.ts`, each mirroring the corresponding already-correct code in `usage-collector.ts`'s `_handleEndInternal` method precisely (same variable name, same relative placement). Do not touch any other line, do not refactor, do not rename anything.

Change 1 — Import: `post-processor.worker.ts` currently has a `import type { ... } from "./worker-messages"` block (all-type-only import) listing AckMessage, ChunkMessage, ConfigUpdateMessage, EndMessage, ReadyMessage, ShutdownCompleteMessage, StartMessage, SummaryMessage, WorkerMessage. `isModelRewrite` is a regular value export (a function), not a type, so it cannot go inside that `import type` block. Add a second, separate value import statement for it: `import { isModelRewrite } from "./worker-messages";` — placed immediately before the existing `import type { ... } from "./worker-messages"` block (matching the ordering convention `usage-collector.ts` uses, where it merges both into one mixed import via `import { type EndMessage, isModelRewrite, type StartMessage } from "./worker-messages";` — here, since post-processor.worker.ts already has a large type-only import from the same module, adding a separate value-only import statement immediately above it is cleaner and avoids restructuring the existing type import list).

Change 2 — Compute modelRewritten: In `handleEndInternal`, immediately before the `const projectAtEnd = state.project ?? null;` line (which precedes the `asyncWriter.enqueue(async () => { ... dbOps.saveRequest(...) ... })` block), add: `const modelRewritten = isModelRewrite(startMessage.originalModel, startMessage.appliedModel);` — placed on the line directly after `projectAtEnd`, matching usage-collector.ts's placement (there it appears right after `const projectAtEnd = state.project ?? null;` and before the `asyncWriter.enqueue` call, with the same explanatory comment usage-collector.ts uses: "// Only persist when an actual rewrite occurred — leaves both columns null for the (overwhelmingly common) unchanged case instead of duplicating the `model` column's value.").

Change 3 — Extra saveRequest args: In the `dbOps.saveRequest(...)` call inside the `asyncWriter.enqueue` block, after the existing `startMessage.comboName || null,` argument (the last positional arg currently passed), add two more trailing positional arguments: `modelRewritten ? startMessage.originalModel : null,` then `modelRewritten ? startMessage.appliedModel : null,` — matching the exact conditional expressions and ordering in usage-collector.ts's call.

Change 4 — Summary object fields: In the `summary: RequestResponse = { ... }` object literal built near the end of `handleEndInternal` (posted back to the main thread via `self.postMessage(summaryMsg)`), add two fields: `originalModel: startMessage.originalModel || undefined,` and `appliedModel: startMessage.appliedModel || undefined,` — placed after the `billingType: state.billingType,` field and before the `comboName: startMessage.comboName || undefined,` field, exactly matching the field ordering used in usage-collector.ts's summary object.

After making all 4 changes, read back only the modified `handleEndInternal` function region and confirm it is structurally identical (variable names, expressions, placement) to the corresponding region of `usage-collector.ts`'s `_handleEndInternal`, differing only in the module-scope wrapper (function vs. class method) and worker-specific mechanics (self.postMessage vs. onSummary callback) that were already present before this change.
  </action>
  <verify>
    <automated>bun test packages/proxy/src/__tests__/worker-messages.test.ts && bun run typecheck</automated>
  </verify>
  <done>
`post-processor.worker.ts` imports `isModelRewrite` from `./worker-messages`; `handleEndInternal` computes `modelRewritten` before enqueueing the DB write; `dbOps.saveRequest(...)` is called with 17 positional args (2 more than before — originalModel/appliedModel trailing the existing comboName arg); the `summary: RequestResponse` object includes `originalModel`/`appliedModel` fields matching usage-collector.ts's field set and ordering. `bun test packages/proxy/src/__tests__/worker-messages.test.ts` passes (unaffected — pins isModelRewrite's own behavior, not this file, but confirms no regression to the shared predicate). `bun run typecheck` passes with zero new errors (confirms saveRequest's optional trailing params 16/17 are satisfied with the correct types and RequestResponse's originalModel/appliedModel fields — both optional strings per the type — are assigned compatible types).

Note: no dedicated unit test exercises `post-processor.worker.ts` directly (Bun Workers with isolated module scope, live DB singletons, and self.postMessage are impractical to unit test in isolation — consistent with the file's existing lack of a `*.worker.test.ts` counterpart). Verification for the worker-specific logic itself relies on: (1) typecheck passing, which validates saveRequest's argument types and RequestResponse's shape against the actual signatures in database-operations.ts and types package, and (2) a manual code-diff comparison of the modified `handleEndInternal` region against usage-collector.ts's `_handleEndInternal`, confirming the two implementations are semantically identical for the 4 changed spots.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| main-thread → worker | StartMessage (already includes originalModel/appliedModel, structured-clone serialized) crosses into worker scope; no new boundary introduced by this fix — only wiring existing fields through to persistence |
| worker → database | dbOps.saveRequest(...) writes originalModel/appliedModel as nullable TEXT columns (schema/migrations already shipped and out of scope for this fix) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260712mqk-01 | Information Disclosure | post-processor.worker.ts summary object → SSE to dashboard | accept | originalModel/appliedModel are model identifier strings already present in StartMessage (itself already transmitted to the worker); no new sensitive data is introduced, and the equivalent fallback path (usage-collector.ts) already exposes these same fields over the same SSE mechanism with no reported issue |
| T-260712mqk-02 | Tampering | dbOps.saveRequest positional args | accept | Purely mechanical/positional wiring of two already-validated, already-typed nullable string fields sourced from StartMessage (populated upstream by response-handler.ts's isModelRewrite() gate); no new input validation surface is introduced by this change |
</threat_model>

<verification>
1. `bun test packages/proxy/src/__tests__/worker-messages.test.ts` — confirms the shared `isModelRewrite()` predicate (imported by the fixed file) still behaves correctly; no regression.
2. `bun run typecheck` — confirms `post-processor.worker.ts` compiles cleanly with the new import, the `modelRewritten` computation, the 2 extra `saveRequest` args (positions 16/17, matching `database-operations.ts`'s optional trailing params), and the 2 extra `RequestResponse` summary fields (matching the type in `@better-ccflare/types`).
3. Manual diff: compare the modified region of `handleEndInternal` in `post-processor.worker.ts` against `_handleEndInternal` in `usage-collector.ts` — the 4 changed spots (import, modelRewritten computation, saveRequest args, summary fields) must match variable names, expressions, and relative placement exactly.
4. `bun run lint && bun run format` — per project convention, confirm no style/import-order violations introduced.
</verification>

<success_criteria>
- `post-processor.worker.ts` imports and uses `isModelRewrite` exactly as `usage-collector.ts` does.
- `dbOps.saveRequest(...)` in `handleEndInternal` passes `modelRewritten ? startMessage.originalModel : null` and `modelRewritten ? startMessage.appliedModel : null` as the final two positional arguments.
- The `summary: RequestResponse` object posted back to the main thread includes `originalModel`/`appliedModel` fields, positioned after `billingType` and before `comboName`.
- `bun run typecheck` passes with zero new errors.
- `bun test packages/proxy/src/__tests__/worker-messages.test.ts` passes.
- No other line in `post-processor.worker.ts` is modified (surgical, mechanical fix only — no refactor).
</success_criteria>

<output>
Create `.planning/quick/260712-mqk-fix-post-processor-worker-ts-missing-ori/260712-mqk-SUMMARY.md` when done
</output>
