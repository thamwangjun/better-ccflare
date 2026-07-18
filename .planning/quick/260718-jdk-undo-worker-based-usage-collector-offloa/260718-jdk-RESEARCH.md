# Undo worker-based usage-collector offload — File-by-File Change Research

**Researched:** 2026-07-18
**Baseline commit for comparison:** `e981fb78~1` (state immediately before quick task `260617-3fb` restored the worker)
**Current HEAD:** `thamw-main` @ `1aed4052`

This report is grounded entirely in actual `git log`/`git diff`/`git show` output captured
during research (all commands re-run against the live repo at research time). Every hunk
below is quoted from real diff output, not paraphrased.

---

## 0. Cross-cutting findings the planner MUST know before editing anything

1. **`usage-collector.ts` is NOT untouched** — CONTEXT.md's assumption that it needs no
   changes is correct for the *hot-path call sites*, but the file itself picked up two
   unrelated fork features since `e981fb78~1` (see §4). Do not treat `git diff e981fb78~1
   HEAD -- packages/proxy/src/usage-collector.ts` as empty — it is NOT empty. It only means
   no *worker-plumbing* changes are needed there (confirmed: no worker-related diff in this
   file).
2. **`initProxy()` must stay `async`, and must keep passing `DatabaseFactory.getInstance()`
   as the third arg to `initUsageCollector()`.** This is NOT part of the worker restoration
   — it's an unrelated PG-mode fix (commit `e071ae31`, "prevent PG-mode event-loop
   starvation"). Reverting `initProxy` to its old synchronous signature (as the raw
   `e981fb78~1` baseline shows) would be a regression. Only remove `startUsageWorker()` /
   `sendWorkerConfigUpdate()` calls that follow it in `server.ts`.
3. **`getUsageWorkerHealth` is a pre-existing public field name, unrelated to the worker.**
   Confirmed via `packages/types/src/context.ts` (`APIContext.getUsageWorkerHealth?: () =>
   { state: string }`) and `packages/http-api/src/handlers/health.ts` — the JSON key
   actually returned to the dashboard is `runtime.usageWorker` (shape `{ state: string }`),
   and this field name **already existed at the `e981fb78~1` baseline**, calling
   `getUsageCollectorHealth()` internally even then. Do not rename anything in
   `packages/types` or `packages/http-api` — only change what `server.ts`'s
   `getUsageWorkerHealth: () => …` callback calls internally, back to
   `getUsageCollectorHealth()`.
4. **Two test files outside CONTEXT.md's explicit delete-list are worker-coupled and must be
   fixed, not deleted wholesale:**
   - `packages/proxy/src/__tests__/response-handler-worker-protocol.test.ts` — mixes
     worker-protocol tests (delete) with an unrelated "passive model-catalog capture" test
     suite (~265 lines, added by `1c59f768`) that must be preserved. See §6.
   - `packages/proxy/src/__tests__/auto-refresh-probe-filter.test.ts` — entirely about a
     pre-worker regression (PR #200 probe-pollution fix) but was rewired in `5cd0e604` to
     spy on `getUsageWorker` instead of `getUsageCollector`. Must be reverted to spy on
     `getUsageCollector` again (baseline version exists verbatim at `e981fb78~1`), **plus**
     one small unrelated fixture addition (`getAgentFrontmatterModelFallback: () => false`)
     must be re-applied on top of that baseline. See §7.
5. **Gotcha: reverting `response-handler.ts`'s direct `getUsageCollector()` calls (no
   try/catch guard, matching the pre-worker baseline) will THROW inside any test that
   invokes `forwardToClient()` with `shouldProcessRequest === true` unless that test mocks
   `usage-collector`'s `getUsageCollector`/singleton state.** `getUsageCollector()` throws
   `"UsageCollector not initialized — call initUsageCollector() first"` if the singleton is
   null (confirmed in `packages/proxy/src/usage-collector.ts` lines ~946-952). The
   surviving "passive model-catalog capture" test suite (§6) does NOT currently mock the
   collector (it only mocks `getUsageWorker`, which safely no-ops when not started) — after
   the revert, those tests will crash unless a `getUsageCollector`/`tryGetUsageCollector`
   spy is added to that suite.
6. **`packages/proxy/src/usage-extraction.ts` requires NO changes** — `git diff e981fb78~1
   HEAD -- packages/proxy/src/usage-extraction.ts` is empty. Grep hits for "worker" in that
   file are stale comments only ("shared with the post-processor worker").

---

## 1. `packages/proxy/src/response-handler.ts`

### Commits touching this file since baseline (`git log --oneline e981fb78~1..HEAD -- packages/proxy/src/response-handler.ts`)
```
11233430 Merge branch 'main' into thamw-main
1c59f768 feat(proxy): console-only auto-refresh, 7-day jittered schedule, passive /v1/models capture, bundled asOf
15dce7d6 fix: address Greptile review findings on PR #300
88c9901a fix: stop rewriting subagent models from stale registry data
bba21ae3 fix(codex): synthesize count token responses
f2621e25 fix(quick-260620-29c-01): route usage data to in-process UsageCollector when worker is stopped — prevent silent data loss
5cd0e604 fix(proxy): wire usage Worker into hot path + server lifecycle (start/config/drain) — close #244 properly
bbe9835e fix(proxy): restore Worker-offloaded usage collector with transferable ArrayBuffers + safe dispatch guard (#244)
```
307 → 492 lines (baseline → HEAD); `git diff --stat`: `227 ++++/---, 206 insertions(+), 21 deletions(-)`.

### (a) Worker-related — MUST REMOVE

**Imports** (current, lines 1-20):
```ts
import { ingestModelsListing } from "./model-catalog";
import { getUsageWorker } from "./proxy";
import { combineChunks, teeStream } from "./stream-tee";
import { tryGetUsageCollector } from "./usage-collector";
import {
	type ChunkMessage,
	type EndMessage,
	isModelRewrite,
	type StartMessage,
} from "./worker-messages";
```
Remove `getUsageWorker` import (from `./proxy`) and `ChunkMessage` import. Change
`tryGetUsageCollector` → `getUsageCollector` (baseline imports `getUsageCollector` directly,
no `tryGetUsageCollector` usage in this file). Keep `ingestModelsListing` (unrelated,
§ below) and `isModelRewrite` (unrelated, § below).

**Entire block to delete** (lines 24-140 in current file):
```ts
const collectorRequestIds = new Set<string>();

export function resetForTesting(): void {
	collectorRequestIds.clear();
}

function safeHandleStart(msg: StartMessage): void { ... }   // full body, lines 50-66
function safeHandleChunk(requestId: string, value: Uint8Array): void { ... }  // lines 78-114
```

**`fireAndForgetEnd` — replace worker/collector-routing version with direct sync call:**

Current (lines 116-140):
```ts
function fireAndForgetEnd(msg: EndMessage): void {
	try {
		// If this request was routed to the in-process collector at Start time,
		// complete its lifecycle there and remove from tracking Set.
		if (collectorRequestIds.has(msg.requestId)) {
			collectorRequestIds.delete(msg.requestId);
			tryGetUsageCollector()
				?.handleEnd(msg)
				.catch((err: unknown) => {
					log.error(
						`handleEnd (collector) failed for request ${msg.requestId}`,
						err,
					);
				});
			return;
		}

		const w = getUsageWorker();
		if (w.isReady()) {
			w.postMessage(msg);
		}
	} catch (err: unknown) {
		log.error(`handleEnd failed for request ${msg.requestId}`, err);
	}
}
```
Restore to baseline (`git show e981fb78~1:packages/proxy/src/response-handler.ts`, lines 17-23):
```ts
function fireAndForgetEnd(msg: EndMessage): void {
	getUsageCollector()
		.handleEnd(msg)
		.catch((err: unknown) => {
			log.error(`handleEnd failed for request ${msg.requestId}`, err);
		});
}
```

**Call site — `startMessage` dispatch** (current line 320):
```ts
		safeHandleStart(startMessage);
```
→ restore direct call:
```ts
		getUsageCollector().handleStart(startMessage);
```

**Call site — `onChunk`** (current lines 348-351):
```ts
		const onChunk = (value: Uint8Array): void => {
			if (shouldProcessRequest) {
				safeHandleChunk(requestId, value);
			}
```
→ restore:
```ts
		const onChunk = (value: Uint8Array): void => {
			if (shouldProcessRequest) {
				getUsageCollector().handleChunk(requestId, value);
			}
```

### (b) Unrelated fork changes in the SAME window — MUST PRESERVE VERBATIM

1. **Model-catalog passive capture** (commit `1c59f768`): `ingestModelsListing` import,
   `query?: string | null` field on `ResponseHandlerOptions`, `query` destructured from
   `options`, and the block hoisted above the `shouldProcessRequest` filter inside the
   non-streaming `teeStream`'s `onClose`:
   ```ts
   const cappedBuf = combineChunks(buffered);

   if (
   	method === "GET" &&
   	path === "/v1/models" &&
   	response.status === 200 &&
   	account
   ) {
   	void ingestModelsListing(cappedBuf.toString("utf-8"), account, query);
   }

   if (!shouldProcessRequest) return;
   ```
2. **Model-rewrite observability** (agent-preference routing, unrelated commits):
   `isModelRewrite` import from `./worker-messages` (a pure helper function, not
   worker-specific — see §3), `MODEL_REWRITE_HEADER` const, `withModelRewriteHeader()`
   helper function, `originalModel`/`appliedModel` fields on `ResponseHandlerOptions`,
   destructured in `forwardToClient`, used to populate `startMessage.originalModel` /
   `startMessage.appliedModel` (gated through `isModelRewrite()`), and applied via
   `withModelRewriteHeader(...)` on all THREE response-construction sites (streaming
   passthrough headers, non-streaming null-body early return headers, final passthrough
   headers). Also the new early-return block:
   ```ts
   if (isModelRewrite(originalModel, appliedModel)) {
   	return new Response(null, {
   		status: response.status,
   		statusText: response.statusText,
   		headers: withModelRewriteHeader(response.headers, originalModel, appliedModel),
   	});
   }
   ```
3. **Codex count-tokens synthesis** (commit `bba21ae3`): the `isSyntheticCountTokens` filter
   was widened from `openai-compatible`-only to also include `codex`:
   ```ts
   const isSyntheticCountTokens =
   	path === "/v1/messages/count_tokens" &&
   	(ctx.provider.name === "openai-compatible" ||
   		ctx.provider.name === "codex");
   const shouldProcessRequest = !isSyntheticCountTokens && !isAutoRefreshProbe;
   ```
   (baseline only had the openai-compatible check inlined without the named
   `isSyntheticCountTokens` variable — the refactor + codex addition must be kept).
4. Minor doc-comment reword on `forwardToClient`'s JSDoc (cosmetic, keep either way — not
   worth reverting).

### (c) Exact target file shape

Use `git show e981fb78~1:packages/proxy/src/response-handler.ts` as the structural skeleton,
then re-apply (b)(1)-(3) on top of it. Do NOT `git checkout` the baseline directly — hand-edit.

---

## 2. `packages/proxy/src/proxy.ts`

### Commits touching this file since baseline
```
225cba6b fix: remove unused getUsageCollector import after upstream merge
9292bfa9 Merge upstream/main into thamw-main
11233430 Merge branch 'main' into thamw-main
ef272d7e fix(proxy): harden session governor accounting and eviction
66bb1485 feat(proxy): session volume circuit breaker for runaway fan-out
ebfaf3f6 Merge pull request #300 from lunetics
88c9901a fix: stop rewriting subagent models from stale registry data
b8e67c94 fix: harden model-aware throttling per codex/grok/fable review
05ed2e47 feat: model-aware usage throttling from Anthropic limits[]
99a0de83 fix: remove redundant async-writer hard-abort, close usage-collector init race
e071ae31 fix: prevent PG-mode event-loop starvation (#282)
b09f6519 feat(lb): session-affinity strategy — per-client sticky + least-used spread
f42a9325 feat(proxy): optional X-Anthropic-Agent-Id header for explicit agent attribution
5cd0e604 fix(proxy): wire usage Worker into hot path + server lifecycle (start/config/drain) — close #244 properly
bbe9835e fix(proxy): restore Worker-offloaded usage collector with transferable ArrayBuffers + safe dispatch guard (#244)
```
568 → 703 lines; `git diff --stat`: `185 insertions(+), 50 deletions(-)`.

### (a) Worker-related — MUST REMOVE

**Import block** (current lines 30-40):
```ts
import {
	buildSessionRejectResponse,
	recordSessionRequest,
} from "./session-governor";
import {
	initUsageCollector,
	tryGetUsageCollector,
	type UsageCollectorHealth,
} from "./usage-collector";
import { UsageWorkerController } from "./usage-worker-controller";
import type { ConfigUpdateMessage, SummaryMessage } from "./worker-messages";
```
- Re-add `getUsageCollector` to the `"./usage-collector"` import (removed by `225cba6b` when
  it became dead after the worker restoration — it is needed again now).
- Delete the `UsageWorkerController` import entirely.
- Delete the `ConfigUpdateMessage, SummaryMessage` import from `"./worker-messages"` (no
  longer used once the worker block below is removed).
- Keep `buildSessionRejectResponse`/`recordSessionRequest` (session-governor, unrelated).

**Entire "WORKER MANAGEMENT" block — DELETE** (current lines 132-191):
```ts
// ===== WORKER MANAGEMENT =====
// Worker-based async usage accounting (restored from 315440fa^).
// The controller is a module-level singleton started eagerly by server.ts.

let pendingStorePayloads: boolean | null = null;

const usageWorkerController = new UsageWorkerController( ... );  // full constructor body

export function getUsageWorker(): UsageWorkerController { ... }
export function startUsageWorker(): void { ... }
export function sendWorkerConfigUpdate(storePayloads: boolean): void { ... }
export function terminateUsageWorker(): Promise<void> { ... }
export function getUsageWorkerHealth() { ... }
```
Note: the `cacheBodyStore.onSummary(...)` call inside the deleted
`usageWorkerController`'s `onSummary` callback is REDUNDANT once removed — confirmed
`usage-collector.ts`'s own `handleEnd()` already calls `cacheBodyStore.onSummary(...)`
internally (see §0 item 1 / §4), and this was ALREADY true at the `e981fb78~1` baseline.
Do not try to re-home this call anywhere else in `proxy.ts` — it doesn't need to exist here
at all.

**Pool-exhausted branch — replace worker-postMessage calls with direct collector calls**
(current lines ~444-503, inside `handleProxy`):
```ts
		if (!isAutoRefreshProbe) {
			// Log to request history via usage worker (guarded — must not throw
			// into the proxy hot path; any worker error is swallowed + logged).
			try {
				const w = getUsageWorker();
				if (w.isReady()) {
					w.postMessage({
						type: "start",
						messageId: crypto.randomUUID(),
						requestId: requestMeta.id,
						accountId: null,
						method: req.method,
						path: url.pathname,
						timestamp: requestMeta.timestamp,
						requestHeaders: Object.fromEntries(req.headers.entries()),
						requestBody: null,
						project: project ?? null,
						responseStatus: 503,
						responseHeaders: Object.fromEntries(
							poolExhaustedResponse.headers.entries(),
						),
						isStream: false,
						providerName: ctx.provider.name,
						accountBillingType: null,
						accountAutoPauseOnOverageEnabled: 0,
						accountName: null,
						agentUsed: agentUsed || null,
						originalModel: originalModel || null,
						appliedModel: appliedModel || null,
						comboName: null,
						apiKeyId: apiKeyId || null,
						apiKeyName: apiKeyName || null,
						retryAttempt: 0,
						failoverAttempts: 0,
					});
				}
			} catch (err: unknown) {
				log.warn(
					`handleStart swallowed for pool_exhausted request ${requestMeta.id}:`,
					err,
				);
			}

			try {
				const w = getUsageWorker();
				if (w.isReady()) {
					w.postMessage({
						type: "end",
						requestId: requestMeta.id,
						success: false,
						error: "pool_exhausted",
					});
				}
			} catch (err: unknown) {
				log.warn(
					`handleEnd swallowed for pool_exhausted request ${requestMeta.id}:`,
					err,
				);
			}
		}
```
Restore to a direct-sync-call version modeled on the baseline
(`git show e981fb78~1:packages/proxy/src/proxy.ts`) **but keeping the unrelated
`originalModel`/`appliedModel` fields** (added after baseline, part of the agent-rewrite
feature — must NOT be dropped):
```ts
		if (!isAutoRefreshProbe) {
			// Log to request history via usage collector
			getUsageCollector().handleStart({
				type: "start",
				messageId: crypto.randomUUID(),
				requestId: requestMeta.id,
				accountId: null,
				method: req.method,
				path: url.pathname,
				timestamp: requestMeta.timestamp,
				requestHeaders: Object.fromEntries(req.headers.entries()),
				requestBody: null,
				project: project ?? null,
				responseStatus: 503,
				responseHeaders: Object.fromEntries(
					poolExhaustedResponse.headers.entries(),
				),
				isStream: false,
				providerName: ctx.provider.name,
				accountBillingType: null,
				accountAutoPauseOnOverageEnabled: 0,
				accountName: null,
				agentUsed: agentUsed || null,
				originalModel: originalModel || null,
				appliedModel: appliedModel || null,
				comboName: null,
				apiKeyId: apiKeyId || null,
				apiKeyName: apiKeyName || null,
				retryAttempt: 0,
				failoverAttempts: 0,
			});

			getUsageCollector()
				.handleEnd({
					type: "end",
					requestId: requestMeta.id,
					success: false,
					error: "pool_exhausted",
				})
				.catch((err: unknown) => {
					log.error(
						`handleEnd failed for pool_exhausted request ${requestMeta.id}`,
						err,
					);
				});
		}
```

### (b) Unrelated changes — MUST PRESERVE VERBATIM

1. **`DatabaseFactory` import + `initProxy()` async signature + `sharedDbOps` arg** (commit
   `e071ae31`, PG-mode fix — NOT worker-related, see §0 item 2):
   ```ts
   import { DatabaseFactory } from "@better-ccflare/database";
   ...
   export async function initProxy(
   	getStorePayloads: () => boolean,
   ): Promise<void> {
   	await initUsageCollector(
   		getStorePayloads,
   		(summary) => {
   			requestEvents.emit("event", { type: "summary", payload: summary });
   		},
   		DatabaseFactory.getInstance(),
   	);
   }
   ```
   Keep this exactly as-is — do NOT revert to the baseline's synchronous
   `initProxy(getStorePayloads: () => boolean): void { initUsageCollector(...) }` (2-arg,
   no `await`, no `DatabaseFactory`).
2. **Session-governor circuit breaker** (commits `66bb1485`, `ef272d7e`): `import {
   buildSessionRejectResponse, recordSessionRequest } from "./session-governor";`,
   `requestMeta.clientSessionId = requestBodyContext.getClientId();`, and the entire
   `if (url.pathname === "/v1/messages") { const verdict = recordSessionRequest(...); if
   (verdict?.rejected) { return buildSessionRejectResponse(verdict); } }` block.
3. **`resolveEffectiveModel` combo/agent-rewrite-aware routing** (commit `f42a9325` +
   later): `resolveEffectiveModel` import from `./handlers`, `interceptAndModifyRequest(...)`
   call gaining `req.headers` + `{ frontmatterModelFallback: ... }` args,
   `requestMeta.originalModel`/`requestMeta.appliedModel` assignment, and:
   ```ts
   const effectiveModel = resolveEffectiveModel(appliedModel, requestModel);
   const selectedAccounts = await selectAccountsForRequest(
   	requestMeta,
   	ctx,
   	effectiveModel ?? undefined,
   );
   ```
4. **Model-aware usage throttling** (commits `05ed2e47`, `b8e67c94`): the `comboRouted` /
   `effectiveModel` locals inside `applyUsageThrottling` and the extra
   `{ requestModel: comboRouted ? null : effectiveModel, scopedMode: "match" }` argument to
   `getUsageThrottleUntil(...)`.

### (c) Exact target shape
Baseline: `git show e981fb78~1:packages/proxy/src/proxy.ts`. Apply (b)(1)-(4) forward onto
it, then re-insert the two `initProxy`/pool-exhausted hunks exactly as shown in (a) above
(note (a)'s pool-exhausted restoration already differs from the *raw* `e981fb78~1` text
because it must additionally carry `originalModel`/`appliedModel` — don't lose those two
fields when reverting).

---

## 3. `packages/proxy/src/worker-messages.ts`

### Commits touching this file since baseline
```
11233430 Merge branch 'main' into thamw-main
6cf08447 feat(proxy): add live Anthropic model catalog with daily refresh
bbe9835e fix(proxy): restore Worker-offloaded usage collector with transferable ArrayBuffers + safe dispatch guard (#244)
```
(The `6cf08447` hit is a false-positive touch from the merge — no actual diff hunk from that
commit lands in this file's final diff; only `bbe9835e` produced real changes.)

### (a) Worker-related — MUST REVERT

**`ChunkMessage.data` type** — current:
```ts
/**
 * ChunkMessage carries a transferable ArrayBuffer.
 *
 * TRANSFER CONTRACT: the producer calls
 *   const copy = value.slice();
 *   postMessage({ type: "chunk", requestId, data: copy.buffer }, [copy.buffer]);
 *
 * ... (full doc comment) ...
 */
export interface ChunkMessage {
	type: "chunk";
	requestId: string;
	data: ArrayBuffer;
}
```
→ revert to baseline:
```ts
export interface ChunkMessage {
	type: "chunk";
	requestId: string;
	data: Uint8Array;
}
```
(Delete the whole "TRANSFER CONTRACT" doc comment above it — it only describes the
now-removed worker transfer protocol.)

### (b) Unrelated — MUST PRESERVE

**`StartMessage.originalModel`/`appliedModel` fields** and the **`isModelRewrite()`**
function (both needed by `usage-collector.ts` and `response-handler.ts`'s surviving
model-rewrite feature — see §1(b)(2) and §4):
```ts
	// Model rewrite observability: the model the client originally requested
	// and the model actually forwarded upstream. Both null unless an
	// agent-preference rewrite (agent-interceptor.ts) changed the model —
	// gate every write through isModelRewrite() so "agent detected but
	// nothing rewritten" never records a pair of equal values.
	originalModel: string | null;
	appliedModel: string | null;
```
```ts
export function isModelRewrite(
	originalModel: string | null | undefined,
	appliedModel: string | null | undefined,
): boolean {
	return !!originalModel && !!appliedModel && originalModel !== appliedModel;
}
```

All other message shapes (`Start/End/Control/ConfigUpdate/Ready/Ack/ShutdownComplete/
Summary`) are unchanged from baseline and still used by `usage-collector.ts` — leave as-is.

---

## 4. `packages/proxy/src/usage-collector.ts` (confirmation — NOT in the 6-file edit list, but verified per task step 4)

`git diff e981fb78~1 HEAD -- packages/proxy/src/usage-collector.ts` is **NOT empty**. Two
unrelated fork features landed here since baseline — **no action needed, these are correct
as-is and must not be touched by this revert**:

1. **Model-rewrite persistence** (pairs with §1(b)(2)/§3(b)):
   ```ts
   import {
   	type EndMessage,
   	isModelRewrite,
   	type StartMessage,
   } from "./worker-messages";
   ...
   const modelRewritten = isModelRewrite(
   	startMessage.originalModel,
   	startMessage.appliedModel,
   );
   ...
   modelRewritten ? startMessage.originalModel : null,
   modelRewritten ? startMessage.appliedModel : null,
   ```
   plus `originalModel`/`appliedModel` added to the summary object passed to `onSummary`.

2. **PG-mode shared-DatabaseOperations support** (pairs with §2(b)(1), commit `e071ae31`):
   `initUsageCollector()` signature changed from
   ```ts
   export function initUsageCollector(
   	getStorePayloads: () => boolean,
   	onSummary: (summary: RequestResponse) => void,
   ): UsageCollector {
   	...
   	const dbOps = new DatabaseOperations();
   	dbOps.initializeAsync().catch(...);
   	...
   }
   ```
   to:
   ```ts
   export async function initUsageCollector(
   	getStorePayloads: () => boolean,
   	onSummary: (summary: RequestResponse) => void,
   	sharedDbOps?: DatabaseOperations,
   ): Promise<UsageCollector> {
   	...
   	const dbOps = sharedDbOps ?? new DatabaseOperations();
   	await dbOps.initializeAsync();
   	...
   }
   ```
   This is why `proxy.ts`'s `initProxy()` must stay `async` and pass
   `DatabaseFactory.getInstance()` (§2(b)(1)) — the two changes are linked.

3. `cacheBodyStore.onSummary(...)` is called inside `handleEnd()` (line ~820) — **this
   already existed at `e981fb78~1`**, confirmed via `git show e981fb78~1:packages/proxy/src/usage-collector.ts | grep cacheBodyStore`. This is why the worker's duplicate
   `cacheBodyStore.onSummary(...)` call in `proxy.ts`'s worker-management block (§2(a)) is
   safe to delete outright with no replacement.

---

## 5. `apps/server/src/server.ts`

### Commits touching this file since baseline (abbreviated — 21 commits total, full list captured; only worker-relevant ones shown, rest are unrelated features listed in (b))
Worker-relevant: `5cd0e604` (wire worker into hot path + server lifecycle).
All other commits in the range (`b09f6519` session-affinity, `05ed2e47`/model-aware
throttling references, `1c59f768`/model-catalog, `d6edfb7c`/usage-history, `d6083306`+
`101c0926`/xAI usage polling, `0484714f`/integrity-check banner fix, etc.) are unrelated fork
features layered on top — see (b).

1695 → 1794 lines; `git diff --stat` not separately captured but the unified diff spans ~10
distinct hunks.

### (a) Worker-related — MUST REMOVE (4 call sites + 1 import block edit)

**Import block** (current lines 44-66):
```ts
import {
	AutoRefreshScheduler,
	CacheKeepaliveScheduler,
	drainUsageCollector,
	getModelCatalog,
	getUsageWorkerHealth,
	getValidAccessToken,
	handleProxy,
	initModelCatalogRefresh,
	initProxy,
	type ProxyContext,
	refreshModelCatalog,
	registerCodexUsageRefresher,
	registerPollingRestarter,
	registerRefreshClearer,
	sendWorkerConfigUpdate,
	startGlobalTokenHealthChecks,
	startIntegrityScheduler,
	startUsageWorker,
	stopGlobalTokenHealthChecks,
	terminateUsageWorker,
	unregisterCodexUsageRefresher,
} from "@better-ccflare/proxy";
```
- Replace `getUsageWorkerHealth` import with `getUsageCollectorHealth` (baseline import
  name — the exported function from `proxy.ts`, NOT the object field name used at the call
  site below, which is unrelated and stays `getUsageWorkerHealth`, see §0 item 3).
- Delete `sendWorkerConfigUpdate`, `startUsageWorker`, `terminateUsageWorker` from this
  import list.
- Keep `getModelCatalog`, `initModelCatalogRefresh`, `refreshModelCatalog` (unrelated).

**Call site 1 — APIRouter config** (current line 739):
```ts
		getUsageWorkerHealth: () => getUsageWorkerHealth(),
```
→
```ts
		getUsageWorkerHealth: () => getUsageCollectorHealth(),
```
(Field name `getUsageWorkerHealth:` on the left of the colon is the `APIContext`/
`APIRouterConfig` key — DO NOT rename it, see §0 item 3. Only the function invoked on the
right changes.)

**Call site 2 — server startup** (current lines 918-920):
```ts
	await initProxy(() => config.getStorePayloads());
	startUsageWorker();
	sendWorkerConfigUpdate(config.getStorePayloads());
```
→
```ts
	await initProxy(() => config.getStorePayloads());
```
(Keep `await` — see §0 item 2 / §2(b)(1). Just delete the two worker lines.)

**Call site 3 — hot-reload config watcher** (current lines 1111-1113):
```ts
		if (key === "store_payloads") {
			sendWorkerConfigUpdate(config.getStorePayloads());
		}
```
→ restore baseline comment (no code — the collector reads config via a getter):
```ts
		// store_payloads changes are picked up automatically via the getStorePayloads getter
```

**Call site 4 — graceful shutdown** (current lines 1729-1733):
```ts
		usageCache.clear(); // Stop all usage polling
		await terminateUsageWorker();
		// Drain the in-process fallback collector too — usage data that fell
		// back to it while the worker was stopped would otherwise be lost.
		await drainUsageCollector();
```
→
```ts
		usageCache.clear(); // Stop all usage polling
		await drainUsageCollector();
```

### (b) Unrelated changes — MUST PRESERVE VERBATIM (large — this file picked up the most unrelated churn of the six)

1. **Session-affinity strategy** (`b09f6519`): `SessionAffinityStrategy` import,
   `case StrategyName.SessionAffinity: return new SessionAffinityStrategy(sessionDurationMs);`
   in `buildStrategy()`.
2. **Model catalog** (`6cf08447`, `1c59f768`): `getModelCatalog`/`initModelCatalogRefresh`/
   `refreshModelCatalog` imports; `stopModelCatalogRefreshJob` variable + its
   start-scheduler call (`stopModelCatalogRefreshJob = initModelCatalogRefresh(proxyContext);`)
   + its shutdown-handler stop call; `modelCatalogProxyContext` mutable ref +
   `modelCatalogProxyContext = proxyContext;` assignment; the `modelCatalog: { get, refresh }`
   block passed into `new APIRouter({...})`.
3. **xAI refresh-backed usage polling** (`d6083306`, `101c0926`): new
   `supportsRefreshBackedUsagePolling(provider)` helper function; rename of
   `anthropicAccounts` → `refreshBackedUsageAccounts` throughout the usage-polling startup
   loop with updated log strings; the extra `(accountId, data) => { proxyContext.dbOps
   .recordUsageSnapshot(...) }` callback arg added to `startUsagePollingWithRefresh(...)`.
4. **Usage history / snapshot retention** (`d6edfb7c`, `869368bf`): `pruneUsageSnapshots(...)`
   calls added in BOTH `runStartupMaintenance()` and the periodic-cleanup job.
5. **Adaptive incremental vacuum** (unrelated DB-maintenance improvement): replacement of
   `dbOps.incrementalVacuum(8000)` with `dbOps.incrementalVacuumAdaptive()` (+ richer
   logging of `reclaimedPages`/`chunks`).

### (c) Exact target shape
Baseline: `git show e981fb78~1:apps/server/src/server.ts`. Apply all of (b) forward onto it
(these are numerous and interleaved — hand-edit rather than attempt a mechanical patch),
then make the 5 edits in (a).

---

## 6. `apps/cli/package.json`

### Commits touching this file since baseline
```
9292bfa9 Merge upstream/main into thamw-main
e1fb90f5 🚀 chore: bump version for deployment
... (10 more version-bump-only commits, all auto-generated, no manual diff content) ...
a4509ae8 fix(cli): restore post-processor worker bundle build step (omit tiktoken)
```
Only `a4509ae8` produced a real hunk; all `🚀 chore: bump version for deployment` commits
only touch the `"version"` field (auto-managed — per CLAUDE.md, NEVER touch this).

### (a) Worker-related — MUST REMOVE from the `scripts.build` string

Three additions made by `a4509ae8`, all inside the single `"build"` script string:

1. Existence-guard (added after the integrity-check-worker guard, before the vacuum-worker
   `bun build` calls):
   ```
   && bun -e "const fs=require('fs'); if (!fs.existsSync('../../packages/proxy/src/inline-worker.ts')) { fs.writeFileSync('../../packages/proxy/src/inline-worker.ts', 'export const EMBEDDED_WORKER_CODE = \"\";'); }"
   ```
2. Build + base64-encode step (added after the integrity-check-worker encode step, before
   the final `dist/better-ccflare` compile):
   ```
   && bun build ../../packages/proxy/src/post-processor.worker.ts --outfile dist/post-processor.worker.js --target=bun --minify && bun -e "const fs=require('fs'); const code=fs.readFileSync('dist/post-processor.worker.js','utf8'); const encoded=Buffer.from(code).toString('base64'); fs.writeFileSync('../../packages/proxy/src/inline-worker.ts', 'export const EMBEDDED_WORKER_CODE = \"' + encoded + '\";');"
   ```
3. Cleanup entry appended to the final `rm -f`:
   ```
   dist/post-processor.worker.js
   ```
   (i.e. final `rm -f` goes from `... dist/integrity-check-worker.js` back to
   `... dist/integrity-check-worker.js dist/post-processor.worker.js` — remove just the
   trailing ` dist/post-processor.worker.js`.)

### (b) Unrelated changes — NONE
The only other diff in this file is the `"version"` field bump (`3.5.23` → `3.5.39`) —
auto-managed by the release pre-push hook per CLAUDE.md. **Do not touch the version field**
either direction; leave it at its current value.

### (c) Exact target shape
Baseline `scripts.build` string: `git show e981fb78~1:apps/cli/package.json` (the exact
pre-`a4509ae8` string, reproduced verbatim in the "Files to hand-edit" section of
CONTEXT.md and confirmed identical via diff above). Splice that string in, keeping the
current (unrelated) `"version"` field untouched.

---

## 7. `packages/proxy/src/inline-worker.ts` — confirmed gitignored, untracked, no action

- `.gitignore` line 17: `packages/proxy/src/inline-worker.ts`
- `git ls-tree HEAD -- packages/proxy/src/inline-worker.ts` → empty (not tracked at HEAD).
- File exists on disk (197KB, build artifact from a previous `bun run build`) but is
  correctly gitignored and untracked — this matches CONTEXT.md's expectation exactly. No
  git action needed. (It was explicitly untracked by commit `1ebdded1`, "chore: untrack
  auto-generated inline-worker.ts from git", well before this revert's scope.) Once the CLI
  build script (§6) stops regenerating it, a stray stale copy may remain on disk after the
  next `bun run build` — that's expected/harmless per the file's own gitignore comment
  ("regenerated on every build").

---

## 8. Test-file fallout NOT listed in CONTEXT.md's delete-list (found via broad grep for `getUsageWorker|UsageWorkerController|resetForTesting|safeHandleStart|safeHandleChunk|collectorRequestIds` across `packages/proxy/src/`)

CONTEXT.md's delete-list covers `usage-worker-controller.ts`, `post-processor.worker.ts`,
and 4 test files (`usage-worker-controller.test.ts`,
`usage-worker-controller-restart.test.ts`, `worker-transfer-aliasing.test.ts`,
`rss-soak.manual.test.ts`) — all confirmed pure worker-only (no unrelated content) and safe
to delete entirely as specified.

**Two additional test files reference worker symbols and are NOT safe to delete wholesale:**

### 8a. `packages/proxy/src/__tests__/response-handler-worker-protocol.test.ts`

- First introduced by `ea19e3da` (long before this revert's window), it already existed at
  `e981fb78~1` as a 284-line file that spies on `usageCollectorModule.getUsageCollector`
  (not the worker) — this is its true pre-worker-restoration baseline.
- `1c59f768` (unrelated, model-catalog feature) appended a NEW describe block, `"forwardToClient
  passive model-catalog capture"` (current file lines 743-1007, ~265 lines, 7 test cases),
  to this SAME file. This block only spies on `modelCatalogModule.ingestModelsListing` — it
  does not touch worker or collector mocking directly.
- **Action:** rewrite this file using `git show e981fb78~1:packages/proxy/src/__tests__/response-handler-worker-protocol.test.ts`
  as the base (restores `getUsageCollector`-based mocking, `Uint8Array` chunk type, drops
  all worker-controller/fallback-routing suites), then append the "passive model-catalog
  capture" describe block from current HEAD verbatim.
- **Gotcha (see §0 item 5):** the appended model-catalog describe block's tests call
  `forwardToClient(...)` with `shouldProcessRequest === true` paths (e.g. `GET /v1/models`
  with a 200 response) and currently rely on the worker's `getUsageWorker()` no-op-when-
  not-ready behavior to avoid a crash. After the revert, `forwardToClient` will call
  `getUsageCollector().handleStart(...)` directly with NO try/catch — this WILL throw
  `"UsageCollector not initialized"` in these tests unless a `getUsageCollector`/
  `tryGetUsageCollector` mock is added. Add a `spyOn(usageCollectorModule,
  "getUsageCollector").mockReturnValue({ handleStart: mock(), handleChunk: mock(),
  handleEnd: mock(() => Promise.resolve()) } as unknown as UsageCollector)` (restored +
  active for the whole model-catalog describe block, not just the worker-protocol suites)
  before wiring this back in.
- Consider renaming the file (drop "worker-protocol" from the name, e.g.
  `response-handler.test.ts` or `usage-collector-protocol.test.ts`) since after the revert
  it no longer tests any worker protocol — cosmetic, planner's call.

### 8b. `packages/proxy/src/__tests__/auto-refresh-probe-filter.test.ts`

- Existed at `e981fb78~1` verbatim (originally added by `bee9341d`, "add tests for PR #200
  cooldown guard and probe pollution fixes" — predates this revert's entire window). Full
  baseline body confirmed via `git show e981fb78~1:...` — spies on
  `usageCollectorModule.getUsageCollector`, tests 3 "sites" (isSyntheticInternal header
  detection in proxy-operations.ts, `shouldProcessRequest` in response-handler.ts,
  pool-exhausted path in proxy.ts).
- `5cd0e604` rewired ALL of Site 2 and Site 3 to spy on `proxyModule.getUsageWorker`
  instead, added a `createMockWorkerController()` helper, and wrapped each test body in
  `try { ... } finally { spy.mockRestore(); }` (previously no try/finally).
- **One unrelated addition buried in this same diff:** both `ctx.config` mock objects in
  Site 3 (`describe("proxy.ts — pool-exhausted path ...")`) gained
  `getAgentFrontmatterModelFallback: () => false,` — required because `handleProxy()` now
  calls `interceptAndModifyRequest(..., { frontmatterModelFallback:
  ctx.config.getAgentFrontmatterModelFallback() })` (§2(b)(3), unrelated agent-rewrite
  feature). This field does NOT exist in the raw `e981fb78~1` version of this test file.
- **Action:** revert to `git show e981fb78~1:packages/proxy/src/__tests__/auto-refresh-probe-filter.test.ts`
  (drops `proxyModule`/`getUsageWorker` import and mock helper, restores
  `usageCollectorModule`/`getUsageCollector` spies, restores the doc-comment line 7 to
  "usageCollector calls" and both `describe(...)` title strings back to their
  `usageCollector`-worded originals), **then** re-add
  `getAgentFrontmatterModelFallback: () => false,` to both `ctx.config` mock objects in the
  Site 3 describe block (otherwise `handleProxy()` will throw calling
  `ctx.config.getAgentFrontmatterModelFallback()` as `undefined()`).

### 8c. Sanity check — no other files break

Grepped `apps/` + `packages/` for the same symbol set; all other hits
(`packages/database/src/repositories/__tests__/request-cost-zero.test.ts`,
`packages/database/src/__tests__/async-writer-interleaving.test.ts`,
`packages/providers/src/providers/openrouter/__tests__/provider.test.ts`,
`packages/proxy/src/__tests__/memory-leak.test.ts`, `packages/proxy/src/usage-extraction.ts`)
are stale prose comments mentioning "post-processor worker" historically — no functional
dependency, no action needed. `packages/types/src/context.ts` hit is the `getUsageWorkerHealth`
field discussed in §0 item 3 — out of scope, no change needed.

---

## 9. Task-6 answer: `getUsageWorkerHealth` naming — confirmed internal-only, safe to swap the call

- `packages/types/src/context.ts` — `APIContext.getUsageWorkerHealth?: () => { state:
  string }` — **this field name predates the worker restoration entirely** (unrelated to
  whether the backend is sync or worker-based; it's just what the interface has always
  called this callback slot).
- `packages/http-api/src/router.ts` (lines 161, 171) and
  `packages/http-api/src/handlers/health.ts` (`UsageWorkerHealthFn` type, `getUsageWorkerHealth`
  param) — purely internal parameter/type naming. The actual JSON key returned to
  dashboard consumers is `response.runtime.usageWorker` (shape `{ state: string }`,
  built at `health.ts` line ~193: `usageWorker: usageWorkerHealth`).
- **Conclusion:** safe to change what `server.ts`'s `getUsageWorkerHealth: () =>
  getUsageWorkerHealth()` calls internally (→ `getUsageCollectorHealth()`, §5(a) call site
  1) without touching `packages/types` or `packages/http-api` or the dashboard at all — the
  field/param/JSON-key names are unrelated naming and out of scope for this revert.

---

## 10. Suggested verification commands for the planner (after edits, before commit)

```bash
# Confirm zero worker symbols remain anywhere in packages/proxy or apps/server:
grep -rn "getUsageWorker\|UsageWorkerController\|startUsageWorker\|terminateUsageWorker\|sendWorkerConfigUpdate\|UsageWorkerHealth\|usage-worker-controller\|post-processor.worker\|safeHandleStart\|safeHandleChunk\|collectorRequestIds" packages/proxy/src apps/server/src apps/cli/package.json
# (expect: zero hits, or only stale prose comments in unrelated files per §8c)

bun run lint && bun run typecheck && bun run format
bun test packages/proxy
```

Route both `gitnexus_impact` (before editing `UsageWorkerController`, `getUsageCollector`,
`forwardToClient`, `handleProxy`) and `gitnexus_detect_changes` (before committing) through
the `gitnexus-analyst` subagent per CLAUDE.md — do not call GitNexus MCP tools directly in
the main planning/execution session.
