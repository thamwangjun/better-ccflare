---
phase: 09-provider-class-unit-tests
reviewed: 2026-06-02T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - packages/providers/src/providers/openrouter-anthropic/provider.ts
  - packages/providers/src/providers/openrouter-anthropic/index.ts
  - packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-06-02T00:00:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Reviewed the new `OpenRouterAnthropicProvider` (extends `AnthropicCompatibleProvider`), its barrel `index.ts`, and the 34-case bun:test suite. The suite passes (34 pass / 0 fail), typecheck is clean, and the FORK-PATCH injections (provider preference, session_id, usage:{include:true}), zero-cache_control passthrough, and real-cost extraction (streaming + non-streaming) behave as documented and are well covered by tests.

No safety-rule violations: tests construct `Response`/`Request` objects in-memory and never make network calls to Anthropic or any live endpoint.

No BLOCKER/Critical defects found. The findings below are correctness-edge and coverage gaps. The strongest is the over-broad `/v1` prefix strip in `buildUrl` (WR-01), which can mangle non-`/v1/...` Anthropic paths that the inherited `canHandle` (returns `true` for everything) lets through.

## Warnings

### WR-01: `buildUrl` `/v1` prefix strip is over-broad — mangles `/v1beta` and other non-`/v1/` paths

**File:** `packages/providers/src/providers/openrouter-anthropic/provider.ts:37-39`
**Issue:** The strip uses `pathname.startsWith("/v1")` and `pathname.slice(3)`. This matches more than the intended `/v1/...` Claude Code path. `canHandle` is inherited from `BaseAnthropicCompatibleProvider` and returns `true` for **every** path (`base-anthropic-compatible.ts:86-88`), and `validateProviderPath` only gates on `canHandle`, so paths like `/v1beta/messages/batches` reach `buildUrl`. With this provider, `/v1beta/foo` becomes `slice(3)` → `"beta/foo"`, producing `https://openrouter.ai/api/v1beta/foo` — i.e. `baseUrl + "beta/foo"` with no separator, a malformed/incorrect URL. Any path beginning with `/v1` but not `/v1/` (e.g. a hypothetical `/v1x`) is similarly corrupted.
**Fix:** Match only the exact segment boundary:
```ts
const cleanPathname =
	pathname === "/v1"
		? "/"
		: pathname.startsWith("/v1/")
			? pathname.slice(3)
			: pathname;
return `${baseUrl}${cleanPathname}${search}`;
```
Then add a test asserting `/v1beta/...` is NOT stripped (e.g. `buildUrl("/v1beta/x","")` → `.../api/v1/v1beta/x` or the documented expectation).

### WR-02: `transformRequestBody` rebuilds the Request with stale client `content-length` header

**File:** `packages/providers/src/providers/openrouter-anthropic/provider.ts:100-104`
**Issue:** The new `Request` is built with `headers: mapped.headers`, which still carry the inbound client's `content-length`. After injecting `provider`/`session_id`/`usage`, the serialized body is longer than the original, so the `content-length` header is now wrong. Whether this surfaces depends on downstream fetch/proxy header sanitization; the sibling `OpenRouterProvider` uses the identical pattern (so this is pre-existing convention, not a regression), but it remains a latent correctness risk and is not covered by any test (the suite reads `transformed.json()` from a fresh `Request`, which recomputes length, so the bug is invisible in tests).
**Fix:** Strip the length header on the rebuilt request, e.g.:
```ts
const headers = new Headers(mapped.headers);
headers.delete("content-length");
return new Request(mapped.url, { method: mapped.method, headers, body: JSON.stringify(body) });
```
Verify downstream proxy header handling first to avoid double-stripping; at minimum add a note/test asserting the length is recomputed.

### WR-03: `provider`-preference injection silently drops a stored preference with no/empty `order`

**File:** `packages/providers/src/providers/openrouter-anthropic/provider.ts:66-71`
**Issue:** Injection only fires when `Array.isArray(pref.order) && pref.order.length > 0`. A stored preference of the form `{ "allow_fallbacks": false }` (valid OpenRouter routing config — restrict fallbacks without pinning order) is parsed successfully but silently discarded, with no warning. The operator's intent (disable fallbacks) is lost and no diagnostic is emitted, unlike the corrupt-JSON branch which at least logs. Untested edge case.
**Fix:** Either (a) inject `allow_fallbacks` even when `order` is absent, or (b) log a debug/warn when a parsed-but-unusable preference is dropped so the silent loss is observable. Add a test for the `{allow_fallbacks:false}`-only stored preference.

### WR-04: Provider is never registered or exported — unreachable at runtime

**File:** `packages/providers/src/providers/openrouter-anthropic/index.ts:1`
**Issue:** `OpenRouterAnthropicProvider` is not added to `registry.registerProvider(...)` in `packages/providers/src/index.ts` and is not re-exported from the package barrel (only `OpenRouterProvider` is). As shipped, this class is reachable only from its own test file — it cannot be selected for any account at runtime. This is consistent with a phased plan (registration deferred to a later phase), but until then the entire class is dead code from the application's perspective, and a reviewer cannot confirm the `name: "openrouter-anthropic"` does not collide or that account-mode wiring exists.
**Fix:** Confirm registration is owned by a subsequent phase and tracked. If this phase is meant to be self-contained, register the provider in `packages/providers/src/index.ts` and export it from the barrel, then add a registry/canHandle integration assertion.

## Info

### IN-01: Large duplicated block — `extractStreamingUsage` + `readFinalSseCost` copied verbatim from `OpenRouterProvider`

**File:** `packages/providers/src/providers/openrouter-anthropic/provider.ts:195-299`
**Issue:** Lines 195-299 are a near-verbatim copy of `OpenRouterProvider.extractStreamingUsage`/`readFinalSseCost` (`openrouter/provider.ts:331-435`), including comments. The header comment explains why inheritance was avoided (would drag in the OAI-format extractor + 4-breakpoint cache injector), which is a reasonable call, but the SSE-tail parsing logic now lives in two places and will drift. A future fix to one (e.g. SSE framing) will silently miss the other.
**Fix:** Extract the shared SSE-final-cost reader into a small utility (e.g. `utils/openrouter-sse-cost.ts`) and have both providers call it. Out of scope for v1 if the fork-patch-cleanliness constraint forbids shared-package edits — note as tech debt.

### IN-02: `extractUsageInfo` performs two independent `response.clone().json()` parses

**File:** `packages/providers/src/providers/openrouter-anthropic/provider.ts:141,145`
**Issue:** The non-streaming branch clones+parses once inside `super.extractUsageInfo(response.clone())` and again at line 145 (`response.clone().json()`) solely to read `usage.cost`. Two full JSON parses of the same body. Correct, but redundant. (Performance is out of v1 scope; flagged as a quality/clarity note only.)
**Fix:** Parse once, pass the parsed object into the cost extraction, or read `cost` from the same parse that feeds token extraction.

### IN-03: Test fixtures omit `[DONE]` sentinel and use only single-event-per-block SSE — narrow coverage of the tail parser

**File:** `packages/providers/src/providers/openrouter-anthropic/__tests__/provider.test.ts:20-78`
**Issue:** All streaming fixtures are short, single-`message_delta`, and never exceed `ANTHROPIC_STREAM_CAP_BYTES`, so the sliding-tail buffer (`buffered.slice(-maxBytes)`, lines 256-258) and the mid-line-truncation path are never exercised. The documented "stream >32KB" scenario in the CR-01 comment is untested, so a regression in the tail-window logic would not be caught.
**Fix:** Add a fixture that pads the stream beyond `ANTHROPIC_STREAM_CAP_BYTES` with filler events before the final `message_delta` and assert `usage.cost` is still extracted. Also add a multi-`message_delta` fixture asserting the LAST cost wins.

---

_Reviewed: 2026-06-02T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
