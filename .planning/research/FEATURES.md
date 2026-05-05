# Features Research — v1.1

**Project:** better-ccflare (personal fork)
**Researched:** 2026-05-05
**Overall confidence:** HIGH (Anthropic API), MEDIUM (OpenRouter provider preference)

---

## Summary

Three features extend the existing OpenRouter cache injection in `openrouter/provider.ts`. Feature 1 adds a 4th cache breakpoint targeting the last high-token user message in `messages[]`, reaching the Anthropic API maximum. Feature 2 upgrades selected cache blocks from the default 5-minute TTL to a 1-hour TTL using the `ttl: "1h"` field on the `cache_control` object — critical for agentic sessions where turns exceed 5 minutes. Feature 3 adds a `provider_order` column to the `accounts` table and injects `provider.order` into every OpenRouter request during `transformRequestBody`, with an ENV var seeding it at startup and a Dashboard UI field for changing it at runtime.

The three features are additive and non-conflicting, but Feature 2 (1hr TTL) has a strict Anthropic ordering constraint — 1hr TTL blocks must appear before 5-minute TTL blocks in the prompt — that interacts directly with the breakpoint injection order established by Feature 1.

---

## Feature 1: Extended Cache Breakpoints

**Current state:** `transformRequestBody` injects 3 breakpoints — last tool in `tools[]`, last system block in `system`, last content block of last assistant turn in `messages[]`.

**Table stakes (minimum for correct behavior):**
- Identify the last `messages[]` entry with `role: "user"` that has substantial content.
- Inject `cache_control: { type: "ephemeral" }` on the last content block of that user message.
- Maintain injection order: tools → system → user message → assistant turn. Anthropic processes breakpoints in document order and caches from the start of the prompt up to each breakpoint.

**Anthropic API specifics (HIGH confidence — official Anthropic docs):**
- Hard limit is 4 cache breakpoints per request. If more than 4 are present, Anthropic silently uses only the 4 most recent (from back to front). There is no 400 error — the extra breakpoints are silently discarded.
- Minimum cacheable token threshold varies by model: 1,024 tokens for Claude Sonnet 3.x; 2,048 for Sonnet 4.6 and Haiku 3.5; 4,096 for Opus 4.x and Haiku 4.5. A breakpoint on a block under the threshold is silently ignored — no error, no cache write.
- OpenRouter passes `cache_control` blocks through to Anthropic unchanged (HIGH confidence — OpenRouter docs confirm pass-through for explicit per-block breakpoints across Anthropic, Bedrock, and Vertex routing paths).

**Edge cases:**
- **Short user messages:** A short clarifying question ("ok, proceed") injected as a 4th breakpoint wastes the slot — Anthropic silently ignores it (below token threshold) but the breakpoint slot is still consumed, meaning a longer earlier user message that would have qualified gets skipped by the silent back-to-front selection. Mitigation: only inject the 4th breakpoint if the target user message content exceeds a rough character-count heuristic (e.g., >500 chars equates to ~125 tokens minimum). No SDK token counter is needed — a character estimate is sufficient as a guard.
- **No eligible user message:** If `messages[]` contains only assistant turns (pathological case) or a single short user message below threshold, skip the 4th breakpoint injection. The slot is better left unused.
- **String vs array content:** The existing assistant-turn code already handles string-to-array conversion. The same pattern applies to user messages: convert string content to `[{ type: "text", text: ..., cache_control: ... }]`.
- **4th breakpoint + existing 3 equals exactly 4:** This is the target state. No silent truncation occurs in normal use.
- **Image content blocks in user messages:** `cache_control` can be placed on image blocks. The implementation should target the last content block of the user message regardless of type, consistent with the existing assistant-turn logic.
- **Injection order relative to existing 3 breakpoints:** The 4th breakpoint (user message) must be inserted between breakpoint 2 (system) and breakpoint 3 (last assistant). In document order: tools → system → **user message** → last assistant. The current `transformRequestBody` method injects tools first, then system, then assistant — the user message breakpoint must be injected between system and assistant in the same method body.

---

## Feature 2: 1-Hour TTL Cache Blocks

**Current state:** All injected breakpoints use `{ type: "ephemeral" }` which defaults to 5-minute TTL.

**Table stakes (minimum for correct behavior):**
- Add `ttl: "1h"` to the `cache_control` object for stable breakpoints: `{ type: "ephemeral", ttl: "1h" }`.
- Apply 1hr TTL only to breakpoints 1 (tools) and 2 (system prompt) — content that does not change between turns.
- Keep 5-minute TTL on breakpoints 3 (user message) and 4 (last assistant turn) — content that changes every turn and whose cache entry is invalidated by the next message regardless of TTL.

**Anthropic API specifics (HIGH confidence — official Anthropic docs, confirmed by OpenRouter caching docs):**
- TTL field is `"ttl"` with values `"5m"` (default, equivalent to omitting the field) or `"1h"`.
- Cache read cost is identical for both TTLs: 0.1x base input tokens (90% discount).
- Cache write cost differs: `"5m"` = 1.25x input tokens (25% premium), `"1h"` = 2x input tokens (100% premium). The higher write cost for tools and system prompt is offset by avoiding repeated cache writes across turns.
- **Ordering constraint (CRITICAL — enforced by Anthropic API):** Within a single request, 1hr TTL blocks must appear before 5-minute TTL blocks in document order. Violating this returns a 400 error from Anthropic. OpenRouter propagates this 400 to the client unchanged.
- Both TTL types count against the 4-breakpoint limit equally.
- OpenRouter confirms support for both TTL values with pass-through behavior for Anthropic-routed requests.

**When to use 1hr vs 5min:**
- Tools (`body.tools`) and system prompt (`body.system`) do not change across turns in a Claude Code or agentic session. The 1hr TTL ensures the cache remains warm even when a user pauses between turns for more than 5 minutes. The 2x write premium is justified by the elimination of repeat cache writes on every request.
- Last user message and last assistant turn are invalidated on every new turn — their cache lifetime is bounded by the conversation turn, not by any TTL. Using 1hr TTL for them wastes the 2x write premium.

**Edge cases:**
- **Provider switch mid-session:** If a subsequent request routes to a different OpenRouter account, the prior backend's cache is cold. The 1hr TTL guarantees warmth on the specific backend for 1 hour, but backend identity across accounts is not guaranteed by OpenRouter unless `provider.order` is also set (Feature 3 dependency). Without Feature 3, the 1hr TTL benefit is probabilistic for multi-account sessions.
- **Bedrock and Vertex AI routing via OpenRouter:** Explicit per-block breakpoints work across Anthropic, Bedrock, and Vertex AI routing paths through OpenRouter. However, `ttl: "1h"` is an Anthropic-specific feature. Bedrock and Vertex may not support the 1hr TTL parameter and may return an error or silently ignore it. LOW confidence on exact behavior — needs empirical verification. Safe mitigation: only inject `ttl: "1h"` for `anthropic/*` model prefixes, and fall back to `"5m"` (omit the `ttl` field) for Bedrock/Vertex models. This is a low-risk decision — the existing breakpoints already work for all model prefixes.
- **Minimum token threshold still applies for 1hr blocks.** A 1hr block under threshold is silently ignored (wasting the 2x write premium and consuming the breakpoint slot). The tools and system prompt breakpoints in agentic sessions nearly always exceed threshold, so this is low-risk in practice.

**Interaction with Feature 1 (ordering constraint):**
The recommended injection order (tools 1hr → system 1hr → user message 5min → last assistant 5min) satisfies the Anthropic ordering constraint (1hr before 5min). This constraint is naturally satisfied by the document order of the prompt and requires no explicit sequencing logic beyond maintaining the current injection order and assigning TTL by breakpoint position.

---

## Feature 3: Per-Account OpenRouter Provider Preference

**Current state:** No `provider.order` is injected. OpenRouter uses its own load balancing across all available backends for the requested model.

**Table stakes (minimum for correct behavior):**
- Add a `provider_order` TEXT column to the `accounts` table (following the established pattern of `model_mappings` and `model_fallbacks` — stored as JSON array string, parsed at use time). Migration: `ALTER TABLE accounts ADD COLUMN provider_order TEXT`.
- Add `provider_order: string | null` to `AccountRow` and `Account` interfaces in `packages/types/src/account.ts` and wire through `toAccount()`.
- In `transformRequestBody` in `openrouter/provider.ts`, when `account?.provider_order` is non-null and parses to a non-empty array, merge `{ provider: { order: [...] } }` into the outgoing request body after the cache injection block.
- Allow the value to be seeded via ENV var at startup (e.g., `BETTER_CCFLARE_OR_PROVIDER_ORDER_<ACCOUNT_NAME>=anthropic,together`). The startup code parses the env var, converts comma-separated string to JSON array, and persists to DB if not already set.
- Expose a text input field in the Dashboard UI Account settings panel for editing the provider order as a comma-separated list, with save wired to the existing account update API endpoint.

**OpenRouter API specifics (HIGH confidence — official OpenRouter docs):**
- The request body field is `provider.order` — a JSON array of provider slug strings, e.g., `["anthropic", "together"]`.
- Provider slugs are OpenRouter's internal identifiers. Examples: `"anthropic"`, `"together"`, `"fireworks"`, `"aws-bedrock"`, `"google-vertex"`. These are distinct from better-ccflare account provider names.
- With `order` set, OpenRouter disables its default load balancing and attempts providers sequentially.
- Default `allow_fallbacks: true` means if the first provider fails or is unavailable, OpenRouter tries the next in order, then falls back to any available provider. This default is correct for this use case.
- The `provider` object is a top-level field in the OpenRouter request body alongside `model`, `messages`, and `max_tokens`.

**Differentiators (useful but not required for v1.1):**
- Dashboard UI validation that entered provider slugs are valid OpenRouter slugs. LOW priority — OpenRouter returns a clear error message on invalid slugs, and valid slugs can be discovered at https://openrouter.ai/docs.
- Per-model override within one account (different `provider.order` for `claude-opus-4` vs `claude-sonnet-4-5`). Significant added complexity — requires a map structure instead of a flat array, a richer DB schema, and a more complex UI. Defer to future milestone.

**Anti-features (explicitly excluded):**
- `provider.only` — eliminates OpenRouter's fallback entirely; causes hard failures when the preferred provider is down. PROJECT.md explicitly excludes this. Always use `provider.order` with fallbacks enabled.
- Per-request provider override via request header (e.g., `x-better-ccflare-openrouter-provider`) — deferred to a future milestone per PROJECT.md. Do not add this in v1.1.
- Auto-detecting optimal provider per model — no OpenRouter API for real-time per-provider-per-model status; not feasible.

**Edge cases:**
- **Provider unavailable:** With `allow_fallbacks: true` (the default; do not override), OpenRouter falls back gracefully. The injection must never include `allow_fallbacks: false`.
- **Non-OpenRouter accounts:** The injection must be gated on `account.provider === "openrouter"`. Anthropic-native, Bedrock, and other provider accounts do not accept the `provider` field and may return 400 errors. The gate is already natural — `transformRequestBody` is only called for the OpenRouter provider.
- **Null or empty `provider_order`:** If the column is null or parses to an empty array, skip injection and return to OpenRouter's default load balancing. This is the correct default for accounts without routing preference.
- **BYOK (Bring Your Own Key) on OpenRouter:** OpenRouter prioritizes BYOK endpoints before the `provider.order` list regardless of ordering. This is an OpenRouter platform behavior outside our control. LOW confidence on whether typical users of this proxy configure BYOK on their OpenRouter account. Treat as a known limitation, not a blocker.
- **Multiple OpenRouter accounts with different `provider_order`:** `SessionStrategy` selects the account; `transformRequestBody` receives the selected `account` object. Each account's `provider_order` is injected independently after selection. Two accounts with different values will correctly inject their respective preferences — no shared state issue.
- **Cache interaction:** When `provider.order` routes primarily to `"anthropic"`, OpenRouter forwards to Anthropic's native API. Cache injection (Features 1 and 2) is fully effective in this path. When routing to Bedrock or Vertex, 1hr TTL behavior may differ (see Feature 2 edge cases) — this is the primary interaction risk between Feature 3 and Feature 2.

---

## Feature Interactions

**Feature 1 + Feature 2 (breakpoints + TTL):** The recommended TTL assignment by breakpoint position (tools 1hr, system 1hr, user message 5min, last assistant 5min) satisfies the Anthropic ordering constraint (1hr before 5min) naturally, since document order mirrors breakpoint position order. No explicit sequencing logic is needed beyond maintaining the current injection order. Implement Feature 1 and Feature 2 together in the same code change — they share the same `transformRequestBody` method and the TTL field is simply an additional key on the `cache_control` object.

**Feature 2 + Feature 3 (1hr TTL + provider preference):** The 1hr TTL benefit is maximized when the same backend processes all turns of an agentic session. Without provider preference, OpenRouter may route different turns to different Anthropic-compatible backends, making the cache cold on each new backend. Setting `provider_order: ["anthropic"]` on an OpenRouter account makes the 1hr TTL fully effective — each turn hits the same Anthropic-native backend where the cache was written. Feature 3 amplifies Feature 2's value for agentic use cases.

**Feature 1 + Feature 3 (4th breakpoint + provider preference):** No direct interaction. The 4th breakpoint is structural (what gets cached); provider preference is routing (where it gets cached). They compose without conflict.

**All three + existing v1.0 patches:** The existing 3-breakpoint injection and `cache_write_tokens` extraction are unaffected. Features 1 and 2 extend `transformRequestBody` in `openrouter/provider.ts` (same file, same method, same `// FORK PATCH:` annotation pattern). Feature 3 adds a new injection step at the end of `transformRequestBody` after the cache breakpoint logic. The `// FORK PATCH:` annotation must cover all three additions to maintain upstream merge safety per the v1.0 SOP.

**Regression test surface:** The existing 10-test suite covers cache injection and usage extraction. New tests required: (a) 4th breakpoint injected on last high-token user message; (b) 4th breakpoint skipped when user message content is below threshold; (c) `ttl: "1h"` present on tools and system blocks; (d) `ttl` absent (or `"5m"`) on user message and assistant blocks; (e) `provider.order` injected when `account.provider_order` is non-null; (f) no `provider.order` injection when field is null; (g) no injection for non-OpenRouter accounts.

---

## Sources

- Anthropic prompt caching API (HIGH confidence): https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- OpenRouter provider selection (HIGH confidence): https://openrouter.ai/docs/guides/routing/provider-selection
- OpenRouter prompt caching guide (HIGH confidence): https://openrouter.ai/docs/guides/best-practices/prompt-caching
- OpenRouter presets (MEDIUM confidence): https://openrouter.ai/docs/guides/features/presets
- Current codebase — `packages/providers/src/providers/openrouter/provider.ts` (v1.0 3-breakpoint injection)
- Current codebase — `packages/types/src/account.ts` (Account interface, model_mappings/model_fallbacks pattern)
- Current codebase — `packages/database/src/migrations.ts` (ALTER TABLE pattern for adding JSON TEXT columns)
