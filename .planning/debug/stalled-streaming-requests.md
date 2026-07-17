---
status: investigating
slug: stalled-streaming-requests
trigger: "There are a lot of stalled requests when using better-ccflare with claude code. Stalls as in claude code LLM requests just stalls without receiving any tokens in streams. And it just hangs there. Compare thamw-main with main (upstream) branches to find fork-specific causes. Web search multiple times on bun and worker behavior. DO NOT FIX — diagnose only. Suggest logging locations to make this visible in logs when it happens."
created: 2026-07-13
updated: 2026-07-13
cycles: 3
---

# Debug Session: stalled-streaming-requests

## Status Summary (read this first — updated 2026-07-13, cycle 3)

Two candidate root causes identified, NOT yet runtime-distinguished. Both are plausible; they are not mutually exclusive and may compound. Session remains diagnose-only per user directive — no fix applied.

1. **OAuth refresh fetch hang** (`AnthropicProvider.refreshToken()`, `provider.ts:136`) — unguarded `fetch()`, no timeout, on the pre-stream critical path, deduplicated per-account via `refreshInFlight`. Predicts: stall scoped to ONE account, other accounts/requests unaffected. See `## Resolution` for full writeup — this was the first-confirmed hypothesis, written before the "temporary, self-recovers" evidence arrived, so treat its `status: diagnosed`-style certainty as superseded pending the distinguishing test below.
2. **SQLite `SQLITE_BUSY` lock contention** (`withBusyRetry` in `bun-sql-adapter.ts`, up to 10-minute retry loop against a VACUUM/integrity-check worker holding a competing lock) — genuine synchronous main-thread blocking. Predicts: stall affects ALL concurrent requests/accounts simultaneously, then all resume together. See `## New Evidence (2026-07-13): stall is temporary...` section. **This is the better fit for the "long stall, then full automatic recovery, no status updates during" evidence the user provided** and is currently the leading hypothesis, though not yet runtime-confirmed either.

**Distinguishing test (not yet run):** during a future stall, check whether an unrelated concurrent request (different account, or a `/health` hit) is also frozen. All-frozen → SQLite contention. Only-affected-account frozen → OAuth refresh hang. See `## Open Question: does adding a fetch/request-level watchdog distinguish these hypotheses?`.

**Mitigations discussed** (DB is 10-20 GiB, driven by 15-day payload retention vs. 1-day default) are in `## Mitigation Options` — none applied yet, ranked by effort/impact.

**Cross-reference:** `.planning/debug/chunk-dropped-worker-stopped.md` (separate, still-open session) investigates why `UsageWorkerController` enters `stopped` state. The SQLite lock-contention mechanism found in this session is a plausible contributing explanation for that too — see the note added to that file.

## Symptoms

- **expected**: Claude Code requests proxied through better-ccflare should stream tokens continuously until completion.
- **actual**: Requests stall — no tokens are received in the stream, and the request just hangs (does not error out, does not complete).
- **error_messages**: None observed by user in logs at the time of stalling. (Note: an existing related session `.planning/debug/chunk-dropped-worker-stopped.md` documents a DIFFERENT but topically adjacent symptom — `[WARN] Chunk dropped: worker is in "stopped" state` — from the async usage-collector worker. That symptom includes an explicit warning; THIS symptom (silent stall, no warning) may or may not be the same root cause. Cross-reference but do not assume identical.)
- **timeline**: User suspects it's likely due to fork-specific changes on `thamw-main` vs upstream `main`, but is not certain. No confirmed "used to work" baseline given.
- **reproduction**: Random / no clear pattern identified (not tied to a specific account, provider, or response length as far as the user has observed).
- **environment**: better-ccflare proxy used with Claude Code as the client.

## Investigation Directives (from user, verbatim intent — treat as required scope, not just hints)

1. Diff/compare `thamw-main` (fork) against `main` (upstream) branches — look specifically for fork-only changes that could cause a stream to stop emitting data without erroring (e.g. async worker offload changes, post-processor changes, SSE handling, response-processor changes).
2. Web search (multiple queries) on Bun-specific and Bun Worker-specific behavior relevant to streaming stalls: e.g. Bun `ReadableStream` backpressure bugs, Bun Worker `postMessage` blocking behavior, Bun `fetch`/undici streaming hangs, known Bun issues with SSE proxying, Bun Worker termination/restart edge cases.
3. Identify possible causes — do NOT apply a fix. This is diagnose-only.
4. Recommend specific file/line locations to add logging so future occurrences are visible in logs (e.g. timestamps at stream start/each chunk/stream end, account/provider selected, worker state at time of stall, last-chunk-received watchdog).

## Current Focus

- hypothesis: "CONFIRMED (see reasoning_checkpoint below): AnthropicProvider.refreshToken() (packages/providers/src/providers/anthropic/provider.ts, upstream code, unchanged by fork) calls `await fetch('https://platform.claude.com/v1/oauth/token', ...)` with NO AbortSignal/timeout. This runs synchronously in the critical path BEFORE the upstream proxied request is ever issued (proxy-operations.ts line 595, called from getValidAccessToken -> refreshAccessTokenSafe). If this bare fetch hangs (a documented Bun runtime behavior — fetch() calls from inside a running Bun.serve() process can hang indefinitely with zero error/zero timeout per oven-sh/bun#17525 and related issues), the request never reaches the upstream Anthropic API at all: zero bytes, zero tokens, zero error — silent hang. This matches the symptom text exactly ('just stalls without receiving any tokens... does not error out, does not complete') and is NOT a mid-stream tee()-backpressure issue (that was the wrong scope for the ruled-out OpenRouter hypothesis)."
- test: "n/a — root cause confirmed via code inspection + external corroboration; diagnose-only mode, no fix applied."
- expecting: "n/a"
- next_action: "n/a — returning ROOT CAUSE FOUND to caller."
- reasoning_checkpoint: |
    hypothesis: "AnthropicProvider.refreshToken()'s OAuth token-refresh fetch() (provider.ts line 136) has no timeout/AbortSignal, runs pre-stream on the critical path for every OAuth account whose token needs refreshing, and is deduplicated per-account via ctx.refreshInFlight — so if this single fetch hangs (a known Bun fetch-inside-Bun.serve hang pattern), EVERY concurrent request routed to that account hangs silently and simultaneously, with no tokens ever received and no error surfaced."
    confirming_evidence:
      - "provider.ts:136 `const response = await fetch(\"https://platform.claude.com/v1/oauth/token\", {...})` — grepped entire file (and oauth.ts) for AbortSignal/AbortController/timeout: zero matches on the actual network call. Only extractUsageInfo (a POST-response usage-parsing path, irrelevant to the hang) has Promise.race timeout guards."
      - "Contrast: packages/proxy/src/handlers/request-handler.ts makeProxyRequest() (the ACTUAL upstream proxy fetch) DOES wire an AbortController + setTimeout(PROXY_REQUEST_TIMEOUT_MS=30min) when no signal is passed — proving the codebase's established convention is to guard fetch() calls, and the OAuth refresh fetch is the outlier that doesn't follow it."
      - "proxy-operations.ts line 595: `const accessToken = ... : await getValidAccessToken(account, ctx);` executes BEFORE the provider request is built (line 623) and BEFORE makeProxyRequest is ever called — confirms this hang occurs pre-stream, consistent with literally zero tokens received (not a mid-stream stop after partial output), matching the user's exact symptom wording."
      - "token-manager.ts lines 230-300: refreshAccessTokenSafe dedupes concurrent refreshes via ctx.refreshInFlight.get(account.id) — all concurrent requests for the same account await the SAME hung promise, so one stalled refresh silently blocks every in-flight request on that account, explaining why users observe 'random' stalls with no clear per-request pattern (only manifests when a refresh coincides with a transient Bun fetch stall)."
      - "git diff origin/main...thamw-main -- packages/providers/src/providers/anthropic/provider.ts packages/providers/src/providers/anthropic/oauth.ts: EMPTY (zero diff). This confirms the bug is NOT fork-specific — it is a latent upstream gap that happens to only manifest for OAuth accounts (API-key/console accounts skip refreshToken's fetch entirely, see provider.ts lines 93-108)."
      - "Web search corroboration: oven-sh/bun#17525 ('fetch is hanging up, no response') describes the near-identical scenario — a fetch() to an OAuth token endpoint hanging with no response/error specifically when called from inside a running Bun.serve() instance, only released by Bun's internal idle timeout (~225s in the reporter's case) or never. Also: oven-sh/bun#13302 and #29546 (AbortSignal.timeout() unreliable/not firing), #27351 (TLS segment blackhole causes indefinite fetch hang with no built-in timeout), and Bun's documented 256-connections-per-host pooling limit (queues silently past that). These are open/recent (issues from Feb-Apr 2026) — this is an active, still-unresolved category of Bun runtime bugs, not a one-off."
      - "TOKEN_SAFETY_WINDOW_MS=30min (proxy constants) means proactive refresh triggers roughly once per OAuth token lifetime (~7-8h) per account — low frequency, consistent with the user's 'random / no clear pattern' reproduction report (only manifests when a refresh call happens to coincide with a transient Bun-level fetch stall)."
    falsification_test: "If the user's stalls can be shown to occur when NO token refresh was due (e.g. access_token still fresh per TOKEN_SAFETY_WINDOW_MS, confirmed via added logging — see recommendation below), this hypothesis is wrong and the hang must be elsewhere in the request path (e.g. inside makeProxyRequest itself despite its timeout, or a Bun networking issue on the main proxied fetch rather than the refresh fetch)."
    fix_rationale: "n/a — diagnose-only mode, no fix applied. (For future fix: wrap provider.refreshToken()'s fetch() calls, in both provider.ts and oauth.ts, with an AbortSignal.timeout() or manual AbortController+setTimeout, mirroring makeProxyRequest's existing pattern, with a short deadline e.g. 15-30s — refresh calls should be fast and there's no reason to allow a 30-minute-equivalent hang on a token endpoint call.)"
    blind_spots: "(1) Not runtime-reproduced in this diagnose-only session — could not force a live Bun fetch hang to observe the exact failure mode end-to-end; conclusion rests on static code inspection + external Bun issue corroboration, not a captured live trace from the user's environment. (2) Have not fully ruled out a hang inside makeProxyRequest's guarded fetch itself surviving past its 30-minute AbortController deadline due to one of the Bun AbortSignal reliability bugs found (#13302/#29546) — if AbortSignal silently fails to fire in the user's Bun version, even the 'guarded' proxied fetch could hang indefinitely too, which would mean BOTH the refresh fetch AND the main fetch need explicit runtime verification, not just the refresh path. (3) Cannot confirm from this session which Bun version the user runs or whether it intersects the specific open issues found. (4) Prior OpenRouter readFinalSseCost hypothesis remains a valid separate bug (unbounded reader loop, no timeout) but is confirmed inapplicable to the user's anthropic-oauth scenario specifically — it should still be fixed independently but is not this session's root cause."

## Evidence

- timestamp: 2026-07-13T00:00:00Z
  checked: "git diff origin/main...thamw-main --stat -- packages/proxy/src packages/database/src"
  found: >
    30 files changed, fork-specific. Highest-signal files for streaming: proxy.ts (+166/-),
    response-handler.ts (+131/-), usage-worker-controller.ts (new, 415 lines), post-processor.worker.ts
    (new, 799 lines). packages/load-balancer/src and most of packages/proxy/src/handlers/
    (request-handler.ts, proxy-operations.ts, agent-interceptor.ts, response-processor.ts,
    account-selector.ts) have ZERO fork changes — confirms upstream-fetch/account-selection/retry
    mechanics are identical to upstream.
  implication: "Worker-based usage accounting is the fork's main structural change to the streaming path; ruled out as direct stall cause after review (see next entries) but led to discovery of the provider-layer issue."

- timestamp: 2026-07-13T00:00:01Z
  checked: "packages/proxy/src/stream-tee.ts (teeStream) diff vs upstream"
  found: "No diff — byte-identical to upstream. pull() calls controller.enqueue(value) BEFORE onChunk?.(value), synchronously, in a try/catch that calls controller.error(error) on throw."
  implication: "Client bytes are already enqueued before any usage-accounting callback runs; a throwing onChunk cannot un-enqueue already-sent bytes, but a callback that never RETURNS (hangs pull()) would still stall subsequent reads. onChunk here is the fork's safeHandleChunk, confirmed synchronous+non-blocking (see next entry) so this particular path is not the stall source."

- timestamp: 2026-07-13T00:00:02Z
  checked: "packages/proxy/src/response-handler.ts and usage-worker-controller.ts full read"
  found: >
    safeHandleStart/safeHandleChunk/fireAndForgetEnd are synchronous, wrapped in try/catch,
    call Worker.postMessage (fire-and-forget, non-blocking Bun API) or fall back to
    tryGetUsageCollector(). No Atomics.wait, no SharedArrayBuffer, no await inside the
    onChunk hot path. grep for blocking primitives returned nothing.
  implication: "Worker-controller/response-handler chunk dispatch is well-guarded and NOT the stall mechanism, despite being the largest fork diff. Ruled out."

- timestamp: 2026-07-13T00:00:03Z
  checked: "packages/proxy/src/handlers/sse-rate-limit-sniffer.ts and token-manager.ts diffs"
  found: >
    sse-rate-limit-sniffer.ts: added 'openrouter-anthropic' to ANTHROPIC_SHAPE_PROVIDERS set
    (regex matching only, bounded 16KB buffer, synchronous). token-manager.ts: API-key
    providers now return '' instead of account.api_key from getValidAccessToken (unrelated
    to streaming; affects auth header selection only).
  implication: "Neither touches stream chunk flow in a way that could block. Ruled out as stall cause."

- timestamp: 2026-07-13T00:00:04Z
  checked: "packages/providers/src/providers/openrouter/provider.ts full diff (409 lines) and openrouter-anthropic/provider.ts (new file, 363 lines)"
  found: >
    OpenRouterProvider overrides extractStreamingUsage: calls super.extractStreamingUsage(clone,...)
    (bounded/timeout-protected base implementation) THEN separately calls
    this.readFinalSseCost(costClone) on an INDEPENDENT clone. readFinalSseCost implementation:
    `for (;;) { const { value, done } = await reader.read(); if (done) break; buffered +=
    decoder.decode(...); if (buffered.length > maxBytes) buffered = buffered.slice(-maxBytes); }`
    — NO Promise.race, NO setTimeout, NO Date.now() deadline check anywhere in the loop.
    OpenRouterAnthropicProvider.readFinalSseCost is explicitly commented "Ported verbatim from
    OpenRouterProvider.readFinalSseCost" — same unguarded loop duplicated in a second file.
  implication: >
    This is the standout anomaly: every OTHER stream-reading loop in the codebase (base class's
    own extractStreamingUsage, used by every non-OpenRouter provider) has both a per-read timeout
    (30s) and an overall deadline (60s). This fork-added function reading a THIRD tee branch of
    the same response body has neither. Candidate root cause.

- timestamp: 2026-07-13T00:00:05Z
  checked: "packages/providers/src/providers/base-anthropic-compatible.ts extractStreamingUsage (upstream, unchanged in fork)"
  found: >
    Uses `while (buffered.length < maxBytes) { if (Date.now() - startTime > READ_TIMEOUT_MS)
    { await reader.cancel(); throw ...} ... await Promise.race([readPromise, timeoutPromise]) }`
    — STREAM_READ_TIMEOUT_MS=60000ms, STREAM_OPERATION_TIMEOUT_MS=30000ms
    (packages/core/src/constants.ts lines 25-26).
  implication: >
    Confirms the codebase's OWN established convention for safely reading a cloned/tee'd
    upstream body requires timeout guards specifically BECAUSE an unguarded reader.read()
    loop on a tee branch is a known risk in this codebase. The fork's OpenRouter cost-extraction
    addition does not follow this established pattern.

- timestamp: 2026-07-13T00:00:06Z
  checked: "packages/proxy/src/handlers/response-processor.ts updateAccountMetadata + proxy-operations.ts call ordering"
  found: >
    updateAccountMetadata (called from processProxyResponse, upstream/unchanged) runs
    `parseUsage(response.clone())` in a fire-and-forget async IIFE — NOT awaited by caller.
    proxy-operations.ts calls processProxyResponse(response,...) at line 1133, THEN
    forwardToClient(response,...) at line 1176 on the SAME response object. forwardToClient
    creates its own teeStream(response.body,...) branch independently.
  implication: >
    Confirms 3-way branching of the same upstream body for OpenRouter/openrouter-anthropic
    streaming responses: (1) response-processor's response.clone() branch, (2) that branch's
    OWN internal clone.clone() inside extractStreamingUsage for readFinalSseCost, (3) the
    client-facing teeStream() branch in forwardToClient. All three share one underlying
    upstream connection/stream.

- timestamp: 2026-07-13T00:00:07Z
  checked: "Web search: Bun/undici/node-fetch Response.clone() and ReadableStream.tee() backpressure semantics"
  found: >
    MDN + node-fetch maintainer (Matteo Collina, quoted via Cloudflare blog) confirm: a teed
    stream signals backpressure at the rate of the SLOWER branch; unread data enqueues without
    limit on the slower branch; "the controller stops pulling from the underlying source" once
    all branches' queues are full (desiredSize <= 0). This is a WHATWG streams spec-level
    behavior, not Bun-specific, though Bun's own implementation may have additional quirks
    (found unrelated Bun 1.3.14 segfault issue in Response.body finalizer while proxying
    Anthropic-style SSE traffic, filed May 2026 — noted but not confirmed related).
  implication: >
    Provides the causal mechanism connecting the unguarded readFinalSseCost loop to a
    CLIENT-VISIBLE stall: if readFinalSseCost's reader falls behind (slow upstream, GC pause,
    event-loop contention from Bun's `{smol: true}` worker, or any transient slowdown), its
    branch's internal queue fills, and per spec the shared underlying source stops being pulled
    for ALL branches — including the one feeding Claude Code's response. No exception is thrown
    client-side because the client's teeStream() pull() is simply never resolved again (not
    rejected) — matching the reported symptom exactly: silent hang, no error, no completion.

## Evidence (continued — anthropic-oauth re-scoped investigation)

- timestamp: 2026-07-13T00:00:08Z
  checked: "packages/providers/src/providers/anthropic/oauth.ts (full read) and provider.ts refreshToken() (full read)"
  found: >
    oauth.ts only implements exchangeCode() (initial login/authorization-code exchange flow,
    used once at account setup, not on the request-time critical path) — its bare `await
    fetch(config.tokenUrl, ...)` at line 102 has no timeout either, but is not invoked during
    normal proxy request handling. The REQUEST-TIME token refresh is AnthropicProvider.refreshToken()
    in provider.ts, called via getValidAccessToken -> refreshAccessTokenSafe on every request
    where the account's access_token is within TOKEN_SAFETY_WINDOW_MS (30 min) of expiry.
    provider.ts:136 `await fetch("https://platform.claude.com/v1/oauth/token", {...})` has
    NO AbortSignal, NO timeout, NO Promise.race guard anywhere in the function.
  implication: >
    provider.ts's refreshToken() fetch is the real request-time risk (oauth.ts's exchangeCode
    is setup-time only, not relevant to steady-state stalls).

- timestamp: 2026-07-13T00:00:09Z
  checked: "git diff origin/main...thamw-main -- packages/providers/src/providers/anthropic/oauth.ts packages/providers/src/providers/anthropic/provider.ts packages/proxy/src/handlers/request-handler.ts packages/proxy/src/handlers/agent-interceptor.ts packages/proxy/src/handlers/account-selector.ts"
  found: >
    Zero diff on oauth.ts, provider.ts, request-handler.ts, agent-interceptor.ts. account-selector.ts
    also zero diff (the OAuth-related content there — 'anthropic-oauth' exclusion filtering for
    Codex CLI traffic — is upstream, filtering-only, not a stream-blocking path). Only
    token-manager.ts has a tiny 3-line fork diff (getValidAccessToken returns "" instead of
    account.api_key for API-key providers — unrelated, affects header selection only, not OAuth
    accounts). proxy.ts's fork diff (166 lines) is entirely UsageWorkerController wiring for the
    pool-exhausted logging path, which runs before account selection and cannot affect an
    in-flight OAuth refresh.
  implication: >
    Confirms this bug is NOT fork-specific — it exists identically in upstream main. The fork
    changes are provably unrelated to the anthropic-oauth stall mechanism.

- timestamp: 2026-07-13T00:00:10Z
  checked: "packages/proxy/src/handlers/proxy-operations.ts proxyWithAccount() call ordering (lines 582-623)"
  found: >
    `const accessToken = ... await getValidAccessToken(account, ctx)` (line 595) executes BEFORE
    `provider.prepareHeaders()` (line 603), BEFORE `provider.buildUrl()` (line 612), and BEFORE
    the `providerRequest`/`makeProxyRequest` call that actually hits the upstream Anthropic API.
    This is strictly pre-stream — no bytes of any kind (headers or body) have been sent to or
    received from Anthropic yet when this await is pending.
  implication: >
    A hang here produces EXACTLY the reported symptom: zero tokens ever received (not a partial
    stream that stops), no error, indefinite hang — because the request to Anthropic's actual
    /v1/messages endpoint never even gets issued.

- timestamp: 2026-07-13T00:00:11Z
  checked: "packages/proxy/src/handlers/request-handler.ts makeProxyRequest() (the actual upstream-request fetch, contrasted with refreshToken's fetch)"
  found: >
    makeProxyRequest wires an AbortController + setTimeout(PROXY_REQUEST_TIMEOUT_MS = 30 * 60 * 1000)
    (packages/core/src/constants.ts:30) whenever no external signal is passed — this IS a timeout-guarded
    fetch, following the codebase's established convention. AnthropicProvider.refreshToken()'s fetch
    has no equivalent guard at all.
  implication: >
    Establishes the codebase already knows to guard fetch() calls against hangs (same convention
    seen earlier in base-anthropic-compatible.ts's extractStreamingUsage) — refreshToken() is the
    outlier that omits this guard, on a call that sits directly on the pre-stream critical path.

- timestamp: 2026-07-13T00:00:12Z
  checked: "packages/proxy/src/handlers/token-manager.ts refreshAccessTokenSafe() refreshInFlight deduplication (lines 230-300)"
  found: >
    Concurrent calls for the same account.id share a single in-flight refresh promise
    (`ctx.refreshInFlight.get(account.id)`), cleaned up only in a `.finally()` after the fetch
    settles. If the underlying fetch never settles, the promise never resolves/rejects and is
    never removed from the map — every concurrent request for that account awaits the same
    permanently-pending promise.
  implication: >
    Explains why the user reports "random" stalls with no clear per-request pattern: a single
    transient Bun-level fetch hang on one account's refresh call blocks ALL requests concurrently
    routed to that account until the process restarts (no self-healing — no timeout to trigger
    cleanup or fallback).

- timestamp: 2026-07-13T00:00:13Z
  checked: "Web search: Bun fetch() hang behavior inside Bun.serve(), AbortSignal.timeout() reliability, OAuth token endpoint fetch hangs"
  found: >
    oven-sh/bun#17525 ('fetch is hanging up, no response') — near-identical shape: a fetch() to
    an OAuth token endpoint hangs with no response/error specifically when called from inside a
    running Bun.serve() instance; only resolved by Bun's internal idle timeout (~225s in the
    reporter's case) or otherwise permanently. oven-sh/bun#13302 and #29546 (both confirmed open):
    AbortSignal.timeout() sometimes never fires / not respected. oven-sh/bun#27351 (Feb 2026):
    fetch() hangs indefinitely with no built-in timeout on certain TLS/network conditions (MTU
    blackhole) unless an explicit AbortSignal is set. Bun also silently queues fetch() calls past
    256 concurrent connections per host (BUN_CONFIG_MAX_HTTP_REQUESTS). These are recent
    (Feb-Apr 2026), several still open, confirming this is an active unresolved category of Bun
    runtime behavior, not a hypothetical.
  implication: >
    Provides the external causal mechanism: Bun's fetch(), when run inside Bun.serve() (exactly
    this proxy's architecture) and without an explicit AbortSignal, can hang indefinitely with
    zero error under real, currently-open Bun runtime conditions. Combined with refreshToken()'s
    unguarded fetch + refreshInFlight's request-blocking deduplication, this fully explains the
    reported symptom: silent, random, complete (zero-token) stalls on anthropic-oauth accounts.

## Eliminated Hypotheses

- hypothesis: "Fork's UsageWorkerController (Bun Worker for async usage accounting) blocks or crashes the main thread during chunk streaming, causing the stall."
  evidence: >
    Full read of usage-worker-controller.ts and response-handler.ts shows all postMessage calls
    are synchronous, non-blocking, wrapped in try/catch, and explicitly designed (per code
    comments referencing #244/#245 regressions) to never propagate into teeStream's pull()
    catch. No Atomics.wait or SharedArrayBuffer usage found anywhere in the worker protocol.
  timestamp: 2026-07-13T00:00:02Z

- hypothesis: "sse-rate-limit-sniffer.ts or token-manager.ts fork changes (both touch streaming-adjacent code) cause the stall."
  evidence: >
    sse-rate-limit-sniffer.ts only added a provider name to a Set used for regex matching
    (bounded 16KB buffer, synchronous, no loop-without-exit). token-manager.ts change only
    affects which auth header value is returned pre-request, unrelated to response streaming.
  timestamp: 2026-07-13T00:00:03Z

- hypothesis: "The chunk-dropped-worker-stopped symptom (separate debug session) is the same root cause as this stall."
  evidence: >
    That session's symptom always includes an explicit WARN log line and pertains to
    analytics/DB-write data loss when UsageWorkerController is in stopped state — it does
    NOT block or stall the client-facing response stream (safeHandleChunk drops silently
    and returns; teeStream's controller.enqueue already happened). This symptom (silent
    stall, no warning, client never receives further tokens) is mechanistically different.
    Cross-referenced but confirmed NOT identical; likely independent issues.
  timestamp: 2026-07-13T00:00:00Z

## User Clarification (2026-07-13, post-diagnosis)

User reports the stall is observed with an **anthropic-oauth provider account**, not OpenRouter/OpenRouter-Anthropic. This narrows scope significantly — the diagnosed root cause (`readFinalSseCost` unbounded reader loop) is OpenRouter-provider-specific code and does NOT execute for anthropic-oauth requests. Checked:

- `packages/providers/src/providers/anthropic/provider.ts` (`AnthropicProvider extends BaseProvider`, not `BaseAnthropicCompatible`) — has **zero diff vs `origin/main`** (only a new test file added). Not fork-modified.
- `extractUsageInfo()` in this file already has proper guards: `READ_TIMEOUT_MS = 10000` overall cap + per-`reader.read()` `Promise.race` against a 5s timeout, with `reader.cancel()` in a `finally` block. This is upstream code, unchanged by the fork — already immune to the readFinalSseCost-style unbounded-loop bug.
- `transformStreamToOpenAIFormat()` (the other reader loop in this file) explicitly early-returns when `requestHeaders.has("anthropic-version")` — native Anthropic SDK clients (Claude Code) always send this header, so this transform doesn't even run for Claude Code + anthropic-oauth traffic.
- Fork diff of `proxy.ts` (166 lines) is almost entirely the new `UsageWorkerController` wiring + a guarded `pool_exhausted` logging path (try/catch, `isReady()` checked, non-blocking) — provider-agnostic but already covered by the "Eliminated Hypotheses" entry above (postMessage is fire-and-forget, doesn't block already-enqueued client bytes).
- `token-manager.ts` fork diff is 5 lines, only affects which auth header value is attached pre-request — unrelated to response streaming.

**Conclusion: the diagnosed root cause does NOT explain the anthropic-oauth stall.** Reopening investigation — need a fork-vs-upstream diff pass and Bun-behavior research scoped specifically to the anthropic-oauth request path (OAuth token refresh mid-stream? `agent-interceptor.ts`? account-selector retry-after-stream-start?) rather than the OpenRouter cost-extraction path.

## Specialist Review

**Reviewer:** typescript-expert (general-purpose review, Bun/TS specifics)
**Verdict:** SUGGEST_CHANGE

- `AbortSignal.timeout()` is fine here — the cited Bun issues concern fetch calls with NO signal at all; `AbortSignal.timeout(N)` is a real timer-backed signal and well-supported in Bun. Prefer it over manual `AbortController` + `setTimeout` unless an additional abort reason (e.g. shutdown) is needed, in which case use `AbortSignal.any([AbortSignal.timeout(N), otherSignal])`.
- **Real gap:** `refreshInFlight` cleanup is coupled to the fetch promise settling. Timing out the fetch fixes the common hang case but does not defend against a fetch that ignores its abort signal, or any other stuck-await in the refresh chain (JSON parsing, DB write). Recommend an independent deadline on `refreshAccessTokenSafe`'s dedup entry itself — wrap the stored promise in `Promise.race([refreshPromise, timeoutRejection])` at the point it's cached in `refreshInFlight`, with `.finally()` clearing the cache keyed off the race, not the inner fetch. Makes the dedup cache self-healing regardless of what hangs inside.
- **Timer leak:** `AbortSignal.timeout()` self-cleans, no leak risk. If a manual watchdog `setTimeout` is added for the `refreshInFlight` race, clear it in a `finally` on the outer race — not inside the fetch call — or every successful fast refresh leaves a dangling timer for the full duration.
- Apply the same pattern to both `provider.ts:136` and `oauth.ts:102` — do not fix one and leave the other.

## Considered Hypothesis (2026-07-13, user follow-up): main-thread UsageCollector fallback

User asked whether the fork's usage-worker-offload architecture, specifically its **fallback to the in-process (main-thread) `UsageCollector`** when `UsageWorkerController` is in `stopped` state, could cause the stall. Investigated directly (no subagent dispatch — targeted code read).

**Mechanism considered:** `response-handler.ts` (`safeHandleStart`/`safeHandleChunk`/`fireAndForgetEnd`) routes chunk-by-chunk usage accounting to `tryGetUsageCollector()?.handleChunk(...)` on the main thread when the shared worker is stopped (lines 55-59, 88-91, 120-123). `UsageCollector.handleChunk` synchronously calls `processStreamChunk` → `processSSELine` → `JSON.parse` per SSE line, all on the Bun.serve() main thread — this IS genuine synchronous main-thread work, and Bun (like Node) is single-threaded for JS execution, so any such work delays servicing of *other* concurrent connections' I/O for its duration (classic head-of-line blocking).

**Findings that weigh AGAINST this being the primary cause:**
- `git diff origin/main...thamw-main -- packages/proxy/src/usage-collector.ts`: the fork's changes here are a pure refactor (moved `parseSSELine`/`extractUsageFromJson`/`extractUsageFromData` into a shared `usage-extraction.ts` module for reuse by OpenRouter's cost extraction) plus added `providerCostUsd`/`resolveCostUsd` for provider-returned cost. **The hot per-chunk logic itself (`processStreamChunk`/`processSSELine`) is behaviorally unchanged from upstream.**
- `UsageCollector` is upstream's own module (exists on `origin/main`, not fork-invented) and per its own doc comment is a "drop-in replacement for the post-processor Worker" — meaning **upstream runs this exact synchronous main-thread logic unconditionally for every single request, all the time**, not just as a rare fallback. If per-chunk JSON.parse-on-main-thread reliably produced multi-second silent hangs, upstream (which has no worker offload at all) would exhibit constant/universal stalls, not the intermittent pattern reported — this is a real, checkable signal that the per-chunk cost itself is small (single small JSON.parse call per SSE line, microseconds-to-low-single-digit-milliseconds), not the kind of blocking that produces an indefinite silent hang.
- The one genuinely expensive synchronous path in `UsageCollector` — `cleanupStaleRequests()`'s emergency eviction sort (`Array.from(...).sort(...)` over the full requests Map) — only triggers at `MAX_REQUESTS_MAP_SIZE = 10000` concurrent tracked requests (`usage-collector.ts:58,296-317`). Not realistically reachable for a single user's Claude Code traffic.

**Verdict: plausible compounding/secondary factor, not the primary cause.** The fallback path is real and does move work back onto the main thread, but (a) it's the same work upstream does unconditionally without a reported hang epidemic, so it explains jitter/latency more than indefinite "zero tokens, hangs forever" stalls, and (b) it can only fire when the worker is already in `stopped` state — a precondition that is itself the subject of the separate, still-open `chunk-dropped-worker-stopped` debug session. If this fallback contributes at all, it's likely as an *amplifier* during an already-degraded period (worker crashed, possibly under load, right when main-thread accounting load spikes for all in-flight streams simultaneously) rather than an independent root cause. It does NOT explain a *total* stall (zero bytes ever received) the way the OAuth refresh fetch hang does, since `teeStream()` already enqueues bytes to the client *before* `safeHandleChunk` runs (confirmed earlier in this session) — so main-thread accounting work delays the *next* chunk's delivery but doesn't block bytes already read from the upstream response.

**Suggested logging (additive, per user's directive #4):** log a warning + timestamp whenever `tryGetUsageCollector()` fallback path is actually taken (currently silent — only the *drop* path in `stopped`/`shutting_down` warns, not the *successful* fallback-routing path), so a correlation between "worker stopped → fallback active → concurrent stream stalls" becomes visible in logs instead of requiring code inspection to even know the fallback fired.

## New Evidence (2026-07-13): stall is temporary, self-recovers "after a long while" — RE-OPENS main-thread-blocking hypothesis with a much stronger mechanism

User clarified the stall is NOT permanent: no status updates / no tokens for an extended period, then everything resumes on its own, with no user or code intervention. This rules IN a genuine main-thread-blocking mechanism far more strongly than the per-chunk-JSON.parse angle considered above, because a real synchronous block is exactly the kind of thing that (a) freezes everything simultaneously and (b) self-clears once the blocking condition ends — unlike an async hung Promise, which does NOT block other unrelated concurrent connections.

**Mechanism found — SQLite `SQLITE_BUSY` contention + `withBusyRetry`, up to 10 minutes:**

- `packages/database/src/adapters/bun-sql-adapter.ts:185-202` (`withBusyRetry`): on `SQLITE_BUSY`, retries for up to **10 minutes** (`deadline = Date.now() + 10*60*1000`), sleeping 500ms (`await new Promise(r => setTimeout(r, 500))`) between attempts. This code is **unchanged from upstream** (zero diff vs `origin/main`).
- Each retry attempt (`fn()`) is a **synchronous** `bun:sqlite` call (`db.query(...).all()` / `db.run(...)`). Because `PRAGMA busy_timeout` is set (default 5000-10000ms, `database-operations.ts:259,1453`, `config/src/index.ts:657,718`), SQLite's own C-level busy-handler blocks **synchronously inside that single call** for up to the busy_timeout duration before returning `SQLITE_BUSY`. Bun/Node are single-threaded for JS execution — a synchronous native call still occupies the one JS thread for its full duration, freezing literally everything else (all concurrent connections, all accounts) until it returns.
- Net effect: a genuine "blocked ~5-10s → free for 500ms → blocked ~5-10s → ..." pattern, persisting for up to 10 minutes if the lock-holder doesn't release. This is **explicitly acknowledged in the codebase's own comments**: `packages/database/src/async-writer.ts:172-190` — *"The SQLite path is not bounded the same way — `withBusyRetry` in BunSqlAdapter can legitimately retry SQLITE_BUSY for up to 10 minutes while a separate Worker holds an exclusive lock (e.g. VACUUM) — so a SQLite job can still stall the writer queue for that long. That is an accepted, pre-existing tradeoff."**
- **Lock-holder identity:** `packages/database/src/vacuum-worker.ts` and `packages/database/src/integrity-check-worker.ts` (both separate Bun Workers, both unchanged from upstream) run periodically via `packages/proxy/src/integrity-scheduler.ts` (also unchanged from upstream) — quick integrity check every 6h (`DEFAULT_QUICK_INTERVAL_HOURS`), full check every 24h (`DEFAULT_FULL_INTERVAL_HOURS`), both configurable. A VACUUM or full integrity check holding a competing lock on the SQLite file while ANY main-thread write is attempted is the trigger.
- **Low, "random" frequency matches symptom:** 6h/24h intervals line up well with the user's earlier "random / no clear pattern" reproduction report — this only manifests when a scheduled maintenance operation happens to overlap with active request traffic.
- **10 minutes matches "a long while" and full self-recovery** far more precisely than the OAuth-refresh-fetch-hang hypothesis (which, per Bun issue oven-sh/bun#16682, has its own internal ~5-minute hardcoded ceiling — also plausible, but less concretely evidenced in this repo than the `withBusyRetry` comment, which explicitly documents this exact 10-minute behavior).

**Fork relevance:** the retry/lock mechanism itself is upstream, unmodified. But the fork's `post-processor.worker.ts` (415 new lines) opens **its own independent `DatabaseOperations()` instance** on the same SQLite file (`post-processor.worker.ts:83`), in addition to the main thread's instance (`usage-collector.ts:930`, used both as the worker-stopped fallback and by other main-thread DB callers) and the vacuum/integrity-check workers. This is a **net increase in the number of concurrent connections/writers contending for the same SQLite file** versus upstream's simpler single-main-thread-writer model — increasing the probability of triggering `SQLITE_BUSY` contention, even though the contention-handling code itself is unchanged. Not yet confirmed whether WAL mode's multi-reader/single-writer semantics make this materially worse with more connections open (open question below).

**This is now the leading hypothesis for "long stall, then full recovery, no status updates during."** It directly answers the user's question: yes, this can be — and given the evidence, most likely is — a genuine blocking-thread issue, specifically synchronous SQLite lock contention, not an async hung-Promise issue like the OAuth refresh fetch (which would NOT freeze unrelated concurrent connections, only requests to the affected account).

**Suggested logging (per user directive #4):** log a warning with elapsed time whenever `withBusyRetry` actually retries (currently fully silent — no log line exists for either an individual retry attempt or a resolved-after-retry success), and separately log start/end + duration of every `runVacuumInWorker`/`runIntegrityCheckInWorker` invocation so a stall can be directly correlated against a concurrent maintenance run in the logs.

## Open Question: does adding a fetch/request-level watchdog distinguish these hypotheses?

The two leading hypotheses (OAuth refresh fetch hang vs SQLite busy-retry lock contention) predict different observable scope:
- **SQLite busy-retry (main-thread block):** ALL concurrent Claude Code sessions/requests — regardless of account or provider — would freeze simultaneously during each synchronous busy_timeout window, and resume together.
- **OAuth refresh fetch hang (async, per-account dedup):** only requests routed to the SPECIFIC account whose token needed refreshing would stall; unrelated concurrent requests to other accounts should continue normally throughout.

Next diagnostic step: during a future stall, check whether *other* concurrent requests (different account, or a simple `/health` endpoint hit) are also unresponsive. If yes → points to SQLite lock contention. If only the specific account's requests stall while others work fine → points to the OAuth refresh hang. The suggested logging above (busy-retry warnings + vacuum/integrity-check start/end) would make this distinction automatic without needing a live test.

## Mitigation Options (2026-07-13, user follow-up — DB is 10-20 GiB, 15-day payload retention, 30-day request retention)

User's retention config directly explains the DB size and is the single biggest lever on the SQLite-lock-contention hypothesis (larger DB → longer VACUUM/integrity_check hold times → longer/more-frequent SQLITE_BUSY windows). Findings, grounded in code:

- `packages/config/src/index.ts:294-307` (`getDataRetentionDays`, payload retention): **default is 1 day**, not 15. Comment explicitly states why: *"each request stores up to ~4 MiB of conversation history, so high-volume proxies otherwise reach tens of GB."* This is describing the user's exact situation. Configurable via `DATA_RETENTION_DAYS` env var or `data_retention_days` config key.
- `packages/config/src/index.ts:314-323` (`getRequestRetentionDays`, metadata-only retention): default is 90 days; user's 30 days is already below default — not a size driver.
- `packages/database/src/vacuum-worker.ts`: runs a **full `PRAGMA VACUUM`** — but this is **NOT automatically scheduled**. Confirmed via full-repo grep: only reachable via the manual CLI command `better-ccflare --compact` (`apps/cli/src/main.ts:742-743,1243`). If the user has this in a personal cron/script, that is a direct, controllable trigger for the worst-case lock hold; if not, full VACUUM is not part of the automatic stall pattern.
- `packages/database/src/incremental-vacuum-worker.ts`: runs automatically, hourly, small bounded chunks (~32 MiB/tick via `PRAGMA incremental_vacuum(8000)`), `busy_timeout=200ms` — designed to be low-impact. Requires `auto_vacuum=2` (INCREMENTAL) to be active; refuses (no-op) otherwise. Worth confirming the user's DB actually has `PRAGMA auto_vacuum` = 2 — if the DB predates this feature or was created before the bootstrap migration ran, incremental vacuum silently no-ops every hour, free pages accumulate unbounded, and the DB grows larger than necessary (compounding the retention-driven size problem), making manual `--compact` more tempting.
- `packages/proxy/src/integrity-scheduler.ts`: runs a **full `PRAGMA integrity_check`** automatically every 24h (`DEFAULT_FULL_INTERVAL_HOURS=24`, overridable via `CCFLARE_FULL_INTEGRITY_CHECK_INTERVAL`), auto-skipped (falls back to `quick_check`) once the DB exceeds `CCFLARE_FULL_INTEGRITY_MAX_DB_BYTES` (default 16 GiB, since "a 27 GiB DB times out" in the worker). **The user's 10-20 GiB range straddles this threshold** — below 16 GiB, they get a genuine full-file integrity scan daily; above it, this specific check self-disables (though quick_check, every 6h, still runs). This is the most likely *automatic, recurring* trigger for the lock-contention pattern (vacuum-worker's full VACUUM is opt-in/manual).

**Ranked mitigations:**

| # | Mitigation | Effort | Impact | Tradeoff |
|---|---|---|---|---|
| 1 | Lower `DATA_RETENTION_DAYS` (payload retention) from 15 toward the 1-7 day default range | Env var / config change, no code | High — directly shrinks DB size, which shrinks every maintenance operation's duration proportionally | Shorter payload history available for debugging/replay past that window |
| 2 | Reduce or disable the automatic full integrity check: raise `CCFLARE_FULL_INTEGRITY_CHECK_INTERVAL` (e.g. weekly instead of daily), or set to `0` to disable and rely on `quick_check` only | Env var, no code | Medium-high — removes the most likely automatic daily full-DB scan | Full integrity_check catches corruption quick_check may miss; lower frequency = later detection |
| 3 | Verify `PRAGMA auto_vacuum` is actually `2` (INCREMENTAL) on the live DB; if not, run the bootstrap migration/re-create to enable it | One-time check + possible migration | Medium — prevents unbounded free-page accumulation that inflates DB size beyond what retention alone would produce | None significant — this looks like a pure bug-fix/config-correction, not a real tradeoff |
| 4 | If `--compact` (full VACUUM) is run manually/via cron, move it to a scheduled low-traffic window rather than during active use | Operational change only | High for that specific trigger, if applicable | Only relevant if the user is actually running `--compact` periodically — needs confirmation |
| 5 | Migrate to PostgreSQL backend (already supported: `bun-sql-adapter.ts`, `migrations-pg.ts`) | High — new deployment, data migration | Structural fix — PG's MVCC doesn't need file-level VACUUM locks blocking all readers/writers the way SQLite's single-writer model does | Real infra change: needs a running PG server, migration of existing data, ongoing PG maintenance |
| 6 | Tune `busy_timeout` down (via `db_busy_timeout_ms` config, default 5-10s) | Config change | Low-medium — shortens each individual synchronous freeze at the cost of more frequent, shorter ones | Doesn't reduce total contention window (`withBusyRetry`'s 10-min deadline is unaffected); just changes the freeze "shape" from fewer-long to more-frequent-short |

**Recommendation ranking, not yet applied (this session remains diagnose-only per original directive):** #1 (retention) is the highest-leverage, lowest-effort change and directly targets the root size driver the maintainers already flagged as the known failure mode. #3 is worth a one-time check regardless — free-page bloat silently defeats retention pruning if incremental vacuum isn't actually running. #2 trades detection latency for reduced daily disruption. #5 is the "real fix" if this deployment needs both large retention AND no lock-contention risk, but is a much bigger step.

## Open Questions for Next Session

0. **(New, highest priority)** Re-scope investigation to anthropic-oauth specifically: review `packages/providers/src/providers/anthropic/oauth.ts` (token refresh — could a mid-stream refresh attempt hang without timeout?), and re-check `agent-interceptor.ts` / `account-selector.ts` for anything invoked specifically on OAuth-mode accounts during an active stream (both were previously confirmed byte-identical to upstream for the general path, but re-verify no OAuth-conditional branches were missed).
1. Runtime confirmation needed: reproduce with an OpenRouter or openrouter-anthropic
   account, force a slow/stalled upstream read (e.g. throttle network to the OpenRouter
   endpoint, or use a mock slow SSE server), and confirm the client-facing stream actually
   stalls when readFinalSseCost's reader lags — this would definitively confirm the tee()
   backpressure mechanism in Bun's actual runtime (vs spec-level reasoning from web search).
2. Confirm whether the user's better-ccflare instance has any openrouter/openrouter-anthropic
   accounts configured (this session's sqlite3 query on the dev machine returned no accounts —
   need to check the user's actual deployment).
3. Suggested logging locations (per user's directive #4) if this is confirmed:
   - packages/providers/src/providers/openrouter/provider.ts `readFinalSseCost`: log
     timestamp before/after each `reader.read()` call, and total elapsed time; add a
     watchdog (mirror base class's STREAM_OPERATION_TIMEOUT_MS/STREAM_READ_TIMEOUT_MS
     pattern) so a stalled read is visible AND self-heals via reader.cancel().
   - packages/providers/src/providers/openrouter-anthropic/provider.ts: same, for the
     "ported verbatim" duplicate.
   - packages/proxy/src/stream-tee.ts `pull()`: log timestamp of each `reader.read()` call
     and time-since-last-chunk, so a generic "last chunk received N ms ago" watchdog metric
     is available for ANY provider's client-facing stream (would surface this class of bug
     regardless of which internal branch is the culprit).
   - packages/proxy/src/handlers/response-processor.ts `updateAccountMetadata`: log which
     provider/requestId a usage-extraction IIFE started for, and log again on completion —
     currently only errors are logged (`log.warn` in the catch), so a HUNG (never-resolving)
     extraction is invisible; add a start-timestamp log and a periodic "still running after Xs"
     warning.

   NOTE (2026-07-13, re-scoped session): the above 3 recommendations remain valid for the
   OpenRouter code path but do NOT apply to the anthropic-oauth root cause confirmed below —
   see the anthropic-oauth-specific logging recommendations in Resolution.

## Resolution (Hypothesis #1 — see Status Summary at top for current standing vs. Hypothesis #2)

**NOTE (added 2026-07-13, cycle 3):** this section documents the OAuth-refresh-fetch-hang hypothesis as it stood when first confirmed via code inspection — before the user clarified the stall is temporary and self-recovers "after a long while." That later evidence fits Hypothesis #2 (SQLite lock contention, see above) more precisely, since a hung fetch does not explain simultaneous freezing of unrelated concurrent requests or full automatic recovery on a ~10-minute-ish cadence. This hypothesis is not ruled out — it remains a valid, independently-confirmed bug (unguarded fetch, real gap) — but it is no longer treated as the sole/certain root cause pending the distinguishing test.

root_cause: >
  AnthropicProvider.refreshToken() (packages/providers/src/providers/anthropic/provider.ts,
  line 136 — upstream code, unchanged by the fork) issues `await fetch("https://platform.claude.com/v1/oauth/token",
  {...})` with no AbortSignal, timeout, or Promise.race guard of any kind. This call runs
  synchronously on the pre-stream critical path (proxy-operations.ts:595, via getValidAccessToken
  -> refreshAccessTokenSafe) whenever an OAuth account's access_token is within
  TOKEN_SAFETY_WINDOW_MS (30 min) of expiry — BEFORE the actual upstream request to Anthropic's
  /v1/messages endpoint is built or sent. Bun's fetch(), when invoked from inside a running
  Bun.serve() process without an explicit AbortSignal, is documented (oven-sh/bun#17525 and
  related open issues, Feb-Apr 2026) to occasionally hang indefinitely with zero error and zero
  timeout. Because refreshAccessTokenSafe deduplicates concurrent refreshes per account via
  ctx.refreshInFlight (a single in-flight promise shared by all concurrent requests for that
  account, cleaned up only in a .finally() that never fires if the fetch never settles), one
  transient Bun-level fetch hang on a single account's token refresh silently blocks every
  request concurrently routed to that account — with zero tokens received, zero errors, and no
  self-healing (no timeout to trigger cleanup or account failover). This matches the reported
  symptom exactly (silent, random, complete stall with no error) and is NOT fork-specific — the
  affected files have zero diff vs upstream `main`. It is a latent upstream gap that only
  manifests for OAuth accounts (API-key/console accounts skip this fetch entirely).
fix: "Not applied — diagnose-only session per user directive. See Suggested Fix Direction below."
verification: "n/a — not applicable in diagnose-only mode."
files_changed: []

## Suggested Fix Direction (diagnose-only — not applied)

Wrap the OAuth token-refresh fetch() calls with an explicit timeout, mirroring the existing
`makeProxyRequest()` pattern (AbortController + setTimeout) already used for the main proxied
request in `packages/proxy/src/handlers/request-handler.ts`:
- `packages/providers/src/providers/anthropic/provider.ts:136` (`refreshToken()`) — add
  `AbortSignal.timeout(15000)` or an equivalent manual AbortController, short deadline (refresh
  calls should complete in low single-digit seconds under normal conditions).
- `packages/providers/src/providers/anthropic/oauth.ts:102` (`exchangeCode()`) — same guard,
  lower priority since this only runs at account setup/login time, not on the steady-state
  request path.
- Consider also adding a deadline/self-cleanup to `refreshInFlight` in `token-manager.ts` so a
  hung refresh promise doesn't permanently block an account even if the underlying fetch's own
  timeout is somehow bypassed (defense in depth, given Bun's AbortSignal reliability issues
  found in this session's research — oven-sh/bun#13302, #29546).

## Suggested Logging Locations — anthropic-oauth path (per user directive #4)

1. **`packages/providers/src/providers/anthropic/provider.ts` `refreshToken()`** (highest
   priority — this is the confirmed root cause location): log a timestamp immediately before
   the `fetch()` call at line 136 (e.g. `log.info(\`Starting OAuth token refresh fetch for
   account ${account.name}\`)`) and immediately after it resolves (e.g.
   `log.info(\`OAuth token refresh fetch completed for ${account.name} in
   ${Date.now() - start}ms\`)`). Without this, a hang here is currently invisible — the only
   existing log before the fetch is `log.info("Refreshing OAuth token for account...")` at
   line 115, with no corresponding "completed" or "still waiting" log, so a hung request looks
   identical to a slow-but-healthy one in the logs.
2. **`packages/proxy/src/handlers/token-manager.ts` `refreshAccessTokenSafe()`**: add a
   periodic "still waiting on refresh" watchdog — wrap the `provider.refreshToken(...)` call
   so that while the promise is unsettled, log
   `log.warn(\`Token refresh for ${account.name} has been pending for ${elapsedMs}ms — possible
   hang\`)` every 10-15s, cleared in the existing `.finally()`. This directly surfaces the
   refreshInFlight blocking-amplification effect described in root_cause (one hung refresh
   silently blocking all concurrent requests for that account).
3. **`packages/proxy/src/handlers/proxy-operations.ts` `proxyWithAccount()`**: log a timestamp
   immediately before line 595's `await getValidAccessToken(account, ctx)` and immediately
   after, so it's possible to distinguish "hung getting a token" (pre-stream) from "hung waiting
   for upstream response" (post-token, inside makeProxyRequest) purely from log timing — this
   directly resolves the ambiguity this session had to work through via code-reading (whether
   "no tokens received" meant pre-stream vs mid-stream).
4. **`packages/proxy/src/handlers/request-handler.ts` `makeProxyRequest()`**: log request start
   timestamp, the effective timeout being applied, and — in the `finally` block — whether
   `timeoutId` actually fired (i.e., whether the AbortController triggered). This would help
   confirm/deny blind spot #2 (whether Bun's AbortSignal reliability bugs, per oven-sh/bun#13302
   and #29546, are also silently affecting the "guarded" main proxied fetch and not just the
   refresh fetch).
5. **General watchdog** (complementary to the OpenRouter-path recommendation above, still valid
   as a cross-cutting signal): log "time since request start with zero bytes sent to client"
   whenever a request has been in-flight (from `createRequestMetadata`'s timestamp) longer than
   a threshold (e.g. 20s) with no response yet — this would catch this entire bug class
   regardless of which specific unguarded await in the chain is the culprit, present or future.
</content>
