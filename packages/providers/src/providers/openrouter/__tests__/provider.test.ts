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
});
