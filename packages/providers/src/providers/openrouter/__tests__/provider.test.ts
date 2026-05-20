import { describe, expect, it } from "bun:test";
import { OpenRouterProvider } from "../provider";

// ─────────────────────────────────────────────────────────────────────────────
// extractUsageInfo — CACHE-01
// ─────────────────────────────────────────────────────────────────────────────

describe("OpenRouterProvider.extractUsageInfo", () => {
	it("reads cache_write_tokens from prompt_tokens_details as cacheCreationInputTokens", async () => {
		const provider = new OpenRouterProvider();
		const responseBody = {
			model: "anthropic/claude-3-5-sonnet",
			usage: {
				prompt_tokens: 100,
				completion_tokens: 10,
				total_tokens: 110,
				prompt_tokens_details: {
					cache_write_tokens: 50,
					cached_tokens: 80,
				},
			},
		};
		const response = new Response(JSON.stringify(responseBody), {
			headers: { "content-type": "application/json" },
		});

		const usage = await provider.extractUsageInfo(response);

		expect(usage).not.toBeNull();
		expect(usage?.cacheCreationInputTokens).toBe(50);
	});

	it("reads cached_tokens from prompt_tokens_details as cacheReadInputTokens", async () => {
		const provider = new OpenRouterProvider();
		const responseBody = {
			usage: {
				prompt_tokens: 100,
				completion_tokens: 10,
				total_tokens: 110,
				prompt_tokens_details: {
					cache_write_tokens: 50,
					cached_tokens: 80,
				},
			},
		};
		const response = new Response(JSON.stringify(responseBody), {
			headers: { "content-type": "application/json" },
		});

		const usage = await provider.extractUsageInfo(response);

		expect(usage).not.toBeNull();
		expect(usage?.cacheReadInputTokens).toBe(80);
	});

	it("returns null when no usage field in response", async () => {
		const provider = new OpenRouterProvider();
		const responseBody = { model: "anthropic/claude-3-5-sonnet" };
		const response = new Response(JSON.stringify(responseBody), {
			headers: { "content-type": "application/json" },
		});

		const usage = await provider.extractUsageInfo(response);

		expect(usage).toBeNull();
	});

	it("returns prompt and completion tokens from usage field", async () => {
		const provider = new OpenRouterProvider();
		const responseBody = {
			model: "anthropic/claude-3-5-sonnet",
			usage: {
				prompt_tokens: 100,
				completion_tokens: 10,
				total_tokens: 110,
				prompt_tokens_details: {},
			},
		};
		const response = new Response(JSON.stringify(responseBody), {
			headers: { "content-type": "application/json" },
		});

		const usage = await provider.extractUsageInfo(response);

		expect(usage?.promptTokens).toBe(100);
		expect(usage?.completionTokens).toBe(10);
		expect(usage?.totalTokens).toBe(110);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// transformRequestBody — CACHE-02: 3-breakpoint per-block injection
// ─────────────────────────────────────────────────────────────────────────────

describe("OpenRouterProvider.transformRequestBody", () => {
	it("injects cache_control on the last tool when tools array is present", async () => {
		const provider = new OpenRouterProvider();
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			tools: [{ name: "tool_a" }, { name: "tool_b" }],
			messages: [{ role: "user", content: "hello" }],
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request);
		const result = await transformed.json();

		expect(result.tools[result.tools.length - 1].cache_control).toEqual({
			type: "ephemeral",
		});
		// First tool should NOT have cache_control
		expect(result.tools[0].cache_control).toBeUndefined();
	});

	it("converts string system to array with cache_control on single block", async () => {
		const provider = new OpenRouterProvider();
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			system: "string text",
			messages: [{ role: "user", content: "hello" }],
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request);
		const result = await transformed.json();

		expect(Array.isArray(result.system)).toBe(true);
		expect(result.system[0]).toEqual({
			type: "text",
			text: "string text",
			cache_control: { type: "ephemeral" },
		});
	});

	it("injects cache_control on last system block when system is an array", async () => {
		const provider = new OpenRouterProvider();
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			system: [
				{ type: "text", text: "a" },
				{ type: "text", text: "b" },
			],
			messages: [{ role: "user", content: "hello" }],
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request);
		const result = await transformed.json();

		expect(result.system[1].cache_control).toEqual({ type: "ephemeral" });
		// First block should NOT have cache_control
		expect(result.system[0].cache_control).toBeUndefined();
	});

	it("injects cache_control on last assistant turn with string content", async () => {
		const provider = new OpenRouterProvider();
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			messages: [
				{ role: "user", content: "hello" },
				{ role: "assistant", content: "I am an assistant" },
			],
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request);
		const result = await transformed.json();

		const lastAssistant = [...result.messages]
			.reverse()
			.find((m: any) => m.role === "assistant");
		expect(Array.isArray(lastAssistant?.content)).toBe(true);
		expect(lastAssistant?.content[0]).toEqual({
			type: "text",
			text: "I am an assistant",
			cache_control: { type: "ephemeral" },
		});
	});

	it("does NOT have a top-level cache_control key", async () => {
		const provider = new OpenRouterProvider();
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			messages: [{ role: "user", content: "hello" }],
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request);
		const result = await transformed.json();

		expect(result.cache_control).toBeUndefined();
	});

	it("preserves model, max_tokens, stream fields unchanged", async () => {
		const provider = new OpenRouterProvider();
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			messages: [{ role: "user", content: "hello" }],
			max_tokens: 50,
			stream: true,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request);
		const result = await transformed.json();

		expect(result.model).toBe("anthropic/claude-sonnet-4-6");
		expect(result.max_tokens).toBe(50);
		expect(result.stream).toBe(true);
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// transformRequestBody — CACHE-03: 4th breakpoint + count guard
	// ─────────────────────────────────────────────────────────────────────────────

	it("injects cache_control on last content block of last user message (array content)", async () => {
		const provider = new OpenRouterProvider();
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			messages: [
				{ role: "user", content: [{ type: "text", text: "first message" }] },
				{ role: "assistant", content: "ok" },
				{
					role: "user",
					content: [
						{ type: "text", text: "block a" },
						{ type: "text", text: "block b" },
					],
				},
			],
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request);
		const result = await transformed.json();

		const lastUser = [...result.messages]
			.reverse()
			.find((m: any) => m.role === "user");
		expect(
			lastUser?.content[lastUser.content.length - 1].cache_control,
		).toEqual({
			type: "ephemeral",
		});
		// First block of last user message should NOT have cache_control
		expect(lastUser?.content[0].cache_control).toBeUndefined();
	});

	it("converts string user content to array with cache_control on last user message", async () => {
		const provider = new OpenRouterProvider();
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			messages: [{ role: "user", content: "hello world" }],
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request);
		const result = await transformed.json();

		const lastUser = [...result.messages]
			.reverse()
			.find((m: any) => m.role === "user");
		expect(Array.isArray(lastUser?.content)).toBe(true);
		expect(lastUser?.content[0]).toEqual({
			type: "text",
			text: "hello world",
			cache_control: { type: "ephemeral" },
		});
	});

	it("count guard: stops at 4 cache_control injections total (no 5th injection)", async () => {
		const provider = new OpenRouterProvider();
		// 4 injection sites: tools (1) + system (1) + last assistant (1) + last user (1) = 4 total
		// With count guard, all 4 should inject; but if we already have 4 pre-existing, NO new ones are added
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			tools: [
				{ name: "tool_a", cache_control: { type: "ephemeral" } },
				{ name: "tool_b", cache_control: { type: "ephemeral" } },
			],
			system: [
				{ type: "text", text: "sys a", cache_control: { type: "ephemeral" } },
				{ type: "text", text: "sys b", cache_control: { type: "ephemeral" } },
			],
			messages: [
				{ role: "user", content: "hello" },
				{ role: "assistant", content: "ok" },
			],
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request);
		const result = await transformed.json();

		// The last assistant turn should NOT receive a new cache_control because we already have 4
		const _lastAssistant = [...result.messages]
			.reverse()
			.find((m: any) => m.role === "assistant");
		// Count total cache_control blocks across all injection sites
		const toolCacheCount = result.tools.filter(
			(t: any) => t.cache_control,
		).length;
		const systemCacheCount = result.system.filter(
			(s: any) => s.cache_control,
		).length;
		const msgCacheCount = result.messages.flatMap((m: any) =>
			Array.isArray(m.content)
				? m.content.filter((c: any) => c.cache_control)
				: m.cache_control
					? [1]
					: [],
		).length;
		const totalCacheCount = toolCacheCount + systemCacheCount + msgCacheCount;

		expect(totalCacheCount).toBe(4);
	});

	it("count guard: partial — injects only remaining slots when some already exist", async () => {
		const provider = new OpenRouterProvider();
		// Pre-existing: 3 cache_control blocks on tools; remaining budget = 1
		// Should inject on system but NOT on last assistant turn or last user
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			tools: [
				{ name: "tool_a", cache_control: { type: "ephemeral" } },
				{ name: "tool_b", cache_control: { type: "ephemeral" } },
				{ name: "tool_c", cache_control: { type: "ephemeral" } },
			],
			system: "a system prompt",
			messages: [
				{ role: "user", content: "hello" },
				{ role: "assistant", content: "ok" },
			],
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request);
		const result = await transformed.json();

		// Count all cache_control annotations across every injection site
		const toolCacheCount = result.tools.filter(
			(t: any) => t.cache_control,
		).length;
		const systemCacheCount = Array.isArray(result.system)
			? result.system.filter((s: any) => s.cache_control).length
			: 0;
		const msgBlocks = result.messages.flatMap((m: any) =>
			Array.isArray(m.content) ? m.content : [],
		);
		const msgCacheCount = msgBlocks.filter((b: any) => b.cache_control).length;
		const totalCacheCount = toolCacheCount + systemCacheCount + msgCacheCount;

		// With count guard: 3 pre-existing + 1 system injection = exactly 4 total
		expect(totalCacheCount).toBe(4);
		// Without count guard: 3 pre-existing + system + assistant = 5 (must NOT happen)
		expect(totalCacheCount).toBeLessThanOrEqual(4);
	});

	it("non-destructive guard: existing cache_control object is not overwritten by injection", async () => {
		const provider = new OpenRouterProvider();
		// Use a custom cache_control object that differs from what the code would inject.
		// If the code overwrites, the extra "ttl" key would be lost.
		const existingCacheControl = { type: "ephemeral", ttl: "5m" };
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			system: [
				{
					type: "text",
					text: "system block",
					cache_control: existingCacheControl,
				},
			],
			messages: [{ role: "user", content: "hello" }],
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request);
		const result = await transformed.json();

		// Pre-existing cache_control must be preserved exactly — not overwritten with { type: "ephemeral" }
		// If implementation overwrites, ttl key is lost and this assertion fails
		expect(result.system[result.system.length - 1].cache_control).toEqual({
			type: "ephemeral",
			ttl: "5m",
		});
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// transformRequestBody — CACHE-04: tool block TTL scope confirmation
	// ─────────────────────────────────────────────────────────────────────────────

	it("tool block cache_control has { type: 'ephemeral' } with no ttl field after transform", async () => {
		const provider = new OpenRouterProvider();
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			tools: [{ name: "tool_a" }],
			messages: [{ role: "user", content: "hello" }],
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request);
		const result = await transformed.json();

		const lastTool = result.tools[result.tools.length - 1];
		expect(lastTool.cache_control).toEqual({ type: "ephemeral" });
		// ttl field must NOT be present — injectSystemCacheTtl() adds ttl only to system blocks
		expect(lastTool.cache_control.ttl).toBeUndefined();
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// transformRequestBody — PROV-01: provider preference injection
	// ─────────────────────────────────────────────────────────────────────────────

	it("injects body.provider when account has openrouter_provider_preference and request has no provider field", async () => {
		const provider = new OpenRouterProvider();
		const account = {
			openrouter_provider_preference: JSON.stringify({
				order: ["anthropic/claude-3-5-sonnet"],
				allow_fallbacks: true,
			}),
		} as any;
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			messages: [{ role: "user", content: "hello" }],
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request, account);
		const result = await transformed.json();

		expect(result.provider).toEqual({
			order: ["anthropic/claude-3-5-sonnet"],
			allow_fallbacks: true,
		});
	});

	it("does NOT inject body.provider when request already has a provider field", async () => {
		const provider = new OpenRouterProvider();
		const account = {
			openrouter_provider_preference: JSON.stringify({
				order: ["anthropic/claude-3-5-sonnet"],
				allow_fallbacks: false,
			}),
		} as any;
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			messages: [{ role: "user", content: "hello" }],
			provider: { order: ["openai/gpt-4o"] }, // client-provided — must win
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request, account);
		const result = await transformed.json();

		// Client provider field must be preserved unchanged
		expect(result.provider).toEqual({ order: ["openai/gpt-4o"] });
	});

	it("allow_fallbacks defaults to true when absent from stored JSON", async () => {
		const provider = new OpenRouterProvider();
		const account = {
			openrouter_provider_preference: JSON.stringify({
				order: ["anthropic/claude-3-5-sonnet"],
				// allow_fallbacks intentionally absent
			}),
		} as any;
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			messages: [{ role: "user", content: "hello" }],
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request, account);
		const result = await transformed.json();

		expect(result.provider.allow_fallbacks).toBe(true);
	});

	it("corrupt openrouter_provider_preference JSON is ignored — request proceeds without body.provider", async () => {
		const provider = new OpenRouterProvider();
		const account = {
			openrouter_provider_preference: "{ this is not valid JSON {{{{",
		} as any;
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			messages: [{ role: "user", content: "hello" }],
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		// Must NOT throw — corrupt JSON is silently ignored
		const transformed = await provider.transformRequestBody(request, account);
		const result = await transformed.json();

		expect(result.provider).toBeUndefined();
	});

	// ─────────────────────────────────────────────────────────────────────────────
	// transformRequestBody — CACHE-05: no model-prefix gate
	// ─────────────────────────────────────────────────────────────────────────────

	it("injects cache_control on non-anthropic model without model-prefix gate", async () => {
		const provider = new OpenRouterProvider();
		const body = {
			model: "openai/gpt-4o",
			messages: [{ role: "user", content: "hello" }],
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request);
		const result = await transformed.json();

		const lastMsg = result.messages[result.messages.length - 1];
		const lastBlock = Array.isArray(lastMsg.content)
			? lastMsg.content[lastMsg.content.length - 1]
			: null;
		expect(lastBlock?.cache_control).toBeDefined();
	});
});
