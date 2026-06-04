import { describe, expect, it } from "bun:test";
import { logBus } from "@better-ccflare/logger";
import { OpenRouterAnthropicProvider } from "../provider";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers for OBS-01 metadata tap tests (D-04)
// ─────────────────────────────────────────────────────────────────────────────

// Capture all "log" events emitted on logBus while running `fn`. Restores the
// listener afterwards. Returns the captured events (msg + data).
async function captureLogEvents(
	fn: () => Promise<void>,
): Promise<Array<{ msg: string; data?: unknown }>> {
	const events: Array<{ msg: string; data?: unknown }> = [];
	const listener = (e: { msg: string; data?: unknown }) => {
		events.push({ msg: e.msg, data: e.data });
	};
	logBus.on("log", listener);
	try {
		await fn();
	} finally {
		logBus.off("log", listener);
	}
	return events;
}

// Build a streaming SSE Response whose terminal message_stop event carries
// openrouter_metadata (provider/backend name + latency).
function makeMetadataStreamingResponse(metadata: unknown): Response {
	const sse =
		`event: message_start\n` +
		`data: ${JSON.stringify({
			message: {
				model: "anthropic/claude-sonnet-4-6",
				usage: {
					input_tokens: 100,
					output_tokens: 0,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
				},
			},
		})}\n\n` +
		`event: message_delta\n` +
		`data: ${JSON.stringify({
			usage: { input_tokens: 100, output_tokens: 10, cost: 0.001 },
		})}\n\n` +
		`event: message_stop\n` +
		`data: ${JSON.stringify({ type: "message_stop", openrouter_metadata: metadata })}\n\n`;
	return new Response(sse, {
		headers: { "content-type": "text/event-stream" },
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE helpers
// ─────────────────────────────────────────────────────────────────────────────

// Build a minimal Anthropic-style SSE body whose final message_delta carries
// usage.cost (undefined → omit the cost key entirely, testing absent-cost path).
function makeStreamingResponse(cost: unknown): Response {
	const deltaUsage: Record<string, unknown> = {
		input_tokens: 100,
		output_tokens: 10,
		cache_read_input_tokens: 0,
	};
	// Only attach cost when explicitly provided (undefined → omit the key entirely)
	if (cost !== undefined) {
		deltaUsage.cost = cost;
	}
	const sse =
		`event: message_start\n` +
		`data: ${JSON.stringify({
			message: {
				model: "anthropic/claude-sonnet-4-6",
				usage: {
					input_tokens: 100,
					output_tokens: 0,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
				},
			},
		})}\n\n` +
		`event: message_delta\n` +
		`data: ${JSON.stringify({ usage: deltaUsage })}\n\n`;
	return new Response(sse, {
		headers: { "content-type": "text/event-stream" },
	});
}

// Captured-real streaming fixture (D-04): exact usage object from the empirical probe
// run on 2026-06-02 against OpenRouter's native /api/v1/messages endpoint.
function makeCapturedRealStreamingResponse(): Response {
	const deltaUsage = {
		input_tokens: 7,
		output_tokens: 32,
		output_tokens_details: { thinking_tokens: 32 },
		cache_creation_input_tokens: null,
		cache_read_input_tokens: 4,
		server_tool_use: null,
		service_tier: null,
		speed: "standard",
		cost: 0.0000070581,
		is_byok: false,
		cost_details: {
			upstream_inference_cost: 0.0000070581,
			upstream_inference_prompt_cost: 7.669e-7,
			upstream_inference_completions_cost: 0.0000062912,
		},
	};
	const sse =
		`event: message_start\n` +
		`data: ${JSON.stringify({
			message: {
				model: "anthropic/claude-sonnet-4-6",
				usage: {
					input_tokens: 7,
					output_tokens: 0,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 0,
				},
			},
		})}\n\n` +
		`event: message_delta\n` +
		`data: ${JSON.stringify({ usage: deltaUsage })}\n\n`;
	return new Response(sse, {
		headers: { "content-type": "text/event-stream" },
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// buildUrl — SC#1 (PROV-01): no double-segment + Bearer auth
// ─────────────────────────────────────────────────────────────────────────────

describe("OpenRouterAnthropicProvider.buildUrl", () => {
	it("returns exactly https://openrouter.ai/api/v1/messages for /v1/messages", () => {
		const provider = new OpenRouterAnthropicProvider();
		const url = provider.buildUrl("/v1/messages", "");
		expect(url).toBe("https://openrouter.ai/api/v1/messages");
	});

	it("never produces the double-segment /api/v1/v1/messages", () => {
		const provider = new OpenRouterAnthropicProvider();
		const url = provider.buildUrl("/v1/messages", "");
		expect(url).not.toContain("/api/v1/v1/messages");
	});

	it("uses custom_endpoint from account when provided, still strips /v1 prefix", () => {
		const provider = new OpenRouterAnthropicProvider();
		const account = {
			custom_endpoint: "https://custom.example.com/api/v1",
		} as any;
		const url = provider.buildUrl("/v1/messages", "", account);
		expect(url).toBe("https://custom.example.com/api/v1/messages");
		expect(url).not.toContain("/v1/v1");
	});

	it("appends search string to the URL", () => {
		const provider = new OpenRouterAnthropicProvider();
		const url = provider.buildUrl("/v1/messages", "?foo=bar");
		expect(url).toBe("https://openrouter.ai/api/v1/messages?foo=bar");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// transformRequestBody — SC#2 (PROV-02 / CACHE-01): zero cache_control injection
// ─────────────────────────────────────────────────────────────────────────────

describe("OpenRouterAnthropicProvider.transformRequestBody (cache passthrough)", () => {
	it("passes through a body with 4 pre-existing cache_control blocks unchanged — count in = count out", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			system: [
				{ type: "text", text: "sys a", cache_control: { type: "ephemeral" } },
				{ type: "text", text: "sys b", cache_control: { type: "ephemeral" } },
			],
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "block a",
							cache_control: { type: "ephemeral" },
						},
						{
							type: "text",
							text: "block b",
							cache_control: { type: "ephemeral" },
						},
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

		// Count all cache_control blocks in result
		let count = 0;
		if (Array.isArray(result.system)) {
			count += result.system.filter((b: any) => b.cache_control).length;
		}
		if (Array.isArray(result.messages)) {
			for (const msg of result.messages) {
				if (Array.isArray(msg.content)) {
					count += msg.content.filter((b: any) => b.cache_control).length;
				}
			}
		}
		// 4 blocks in, 4 blocks out — no injection
		expect(count).toBe(4);
	});

	it("passes through a body with 0 cache_control blocks — still 0 after transform (no injection)", async () => {
		const provider = new OpenRouterAnthropicProvider();
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

		// No cache_control should be added
		let count = 0;
		if (Array.isArray(result.system)) {
			count += result.system.filter((b: any) => b.cache_control).length;
		}
		if (Array.isArray(result.messages)) {
			for (const msg of result.messages) {
				if (Array.isArray(msg.content)) {
					count += msg.content.filter((b: any) => b.cache_control).length;
				} else if (msg.cache_control) {
					count++;
				}
			}
		}
		expect(count).toBe(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// transformRequestBody — SC#3 (ROUTE-01): provider preference injection
// ─────────────────────────────────────────────────────────────────────────────

describe("OpenRouterAnthropicProvider.transformRequestBody (provider preference)", () => {
	it("injects body.provider when account has openrouter_provider_preference and no provider field", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const account = {
			id: "acc-1",
			openrouter_provider_preference: JSON.stringify({
				order: ["anthropic"],
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
			order: ["anthropic"],
			allow_fallbacks: true,
		});
	});

	it("does NOT inject body.provider when account has no openrouter_provider_preference", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const account = { id: "acc-1" } as any;
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

		expect("provider" in result).toBe(false);
	});

	it("preserves client-supplied provider field unchanged (non-empty object)", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const account = {
			id: "acc-1",
			openrouter_provider_preference: JSON.stringify({
				order: ["anthropic"],
				allow_fallbacks: false,
			}),
		} as any;
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			messages: [{ role: "user", content: "hello" }],
			provider: { order: ["openai/gpt-4o"] },
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request, account);
		const result = await transformed.json();

		expect(result.provider).toEqual({ order: ["openai/gpt-4o"] });
	});

	it("preserves client-supplied provider field even when it is an empty object {}", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const account = {
			id: "acc-1",
			openrouter_provider_preference: JSON.stringify({
				order: ["anthropic"],
				allow_fallbacks: true,
			}),
		} as any;
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			messages: [{ role: "user", content: "hello" }],
			provider: {},
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request, account);
		const result = await transformed.json();

		// Empty object {} is a valid provider field — must be preserved as-is, not overridden
		expect(result.provider).toEqual({});
	});

	it("corrupt JSON in openrouter_provider_preference does not throw and does not inject provider field", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const account = {
			id: "acc-1",
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

		// Must not throw — corrupt JSON is silently ignored
		const transformed = await provider.transformRequestBody(request, account);
		const result = await transformed.json();

		expect(result.provider).toBeUndefined();
	});

	it("allow_fallbacks defaults to true when absent from stored JSON", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const account = {
			id: "acc-1",
			openrouter_provider_preference: JSON.stringify({
				order: ["anthropic"],
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
});

// ─────────────────────────────────────────────────────────────────────────────
// transformRequestBody — SC#4 (ROUTE-02): session_id injection
// ─────────────────────────────────────────────────────────────────────────────

describe("OpenRouterAnthropicProvider.transformRequestBody (session_id)", () => {
	it("injects session_id when client body does not include it", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const account = { id: "test-account-id" } as any;
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

		expect(typeof result.session_id).toBe("string");
		expect(result.session_id.length).toBeGreaterThan(0);
	});

	it("produces identical session_id across two calls with the same account.id (stability)", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const account = { id: "stable-account-id" } as any;
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			messages: [{ role: "user", content: "hello" }],
			max_tokens: 10,
		};

		const req1 = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		const req2 = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const r1 = await (
			await provider.transformRequestBody(req1, account)
		).json();
		const r2 = await (
			await provider.transformRequestBody(req2, account)
		).json();

		expect(r1.session_id).toBe(r2.session_id);
	});

	it("produces different session_id for two different account.id values", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const account1 = { id: "account-id-alpha" } as any;
		const account2 = { id: "account-id-beta" } as any;
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			messages: [{ role: "user", content: "hello" }],
			max_tokens: 10,
		};

		const req1 = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		const req2 = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const r1 = await (
			await provider.transformRequestBody(req1, account1)
		).json();
		const r2 = await (
			await provider.transformRequestBody(req2, account2)
		).json();

		expect(r1.session_id).not.toBe(r2.session_id);
	});

	it("does NOT override a client-supplied session_id", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const account = { id: "test-account-id" } as any;
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			messages: [{ role: "user", content: "hello" }],
			session_id: "client-supplied-session",
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request, account);
		const result = await transformed.json();

		expect(result.session_id).toBe("client-supplied-session");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// transformRequestBody — D-03: usage:{include:true} injection
// ─────────────────────────────────────────────────────────────────────────────

describe("OpenRouterAnthropicProvider.transformRequestBody (usage injection)", () => {
	it("injects usage:{include:true} when client body has no usage field", async () => {
		const provider = new OpenRouterAnthropicProvider();
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

		expect(result.usage).toEqual({ include: true });
	});

	it("does NOT override a client-supplied usage field", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const body = {
			model: "anthropic/claude-sonnet-4-6",
			messages: [{ role: "user", content: "hello" }],
			usage: { include: false, custom: "field" },
			max_tokens: 10,
		};
		const request = new Request("https://openrouter.ai/api/v1/messages", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

		const transformed = await provider.transformRequestBody(request);
		const result = await transformed.json();

		expect(result.usage).toEqual({ include: false, custom: "field" });
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// extractUsageInfo — SC#5 (COST-01): non-streaming real cost extraction
// ─────────────────────────────────────────────────────────────────────────────

describe("OpenRouterAnthropicProvider.extractUsageInfo (non-streaming)", () => {
	it("returns real costUsd from usage.cost when it is a number", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const responseBody = {
			model: "anthropic/claude-sonnet-4-6",
			usage: {
				input_tokens: 100,
				output_tokens: 20,
				cache_creation_input_tokens: 50,
				cache_read_input_tokens: 80,
				cost: 0.002,
			},
		};
		const response = new Response(JSON.stringify(responseBody), {
			headers: { "content-type": "application/json" },
		});

		const usage = await provider.extractUsageInfo(response);

		expect(usage?.costUsd).toBe(0.002);
	});

	it("reads Anthropic-native cache_creation_input_tokens correctly", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const responseBody = {
			model: "anthropic/claude-sonnet-4-6",
			usage: {
				input_tokens: 100,
				output_tokens: 20,
				cache_creation_input_tokens: 50,
				cache_read_input_tokens: 80,
				cost: 0.002,
			},
		};
		const response = new Response(JSON.stringify(responseBody), {
			headers: { "content-type": "application/json" },
		});

		const usage = await provider.extractUsageInfo(response);

		expect(usage?.cacheCreationInputTokens).toBe(50);
		expect(usage?.cacheReadInputTokens).toBe(80);
	});

	it("returns costUsd undefined when usage.cost is null (typeof guard)", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const responseBody = {
			model: "anthropic/claude-sonnet-4-6",
			usage: {
				input_tokens: 100,
				output_tokens: 20,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				cost: null,
			},
		};
		const response = new Response(JSON.stringify(responseBody), {
			headers: { "content-type": "application/json" },
		});

		const usage = await provider.extractUsageInfo(response);

		expect(usage?.costUsd).toBeUndefined();
	});

	it("returns costUsd undefined when usage.cost is a string (type confusion guard)", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const responseBody = {
			model: "anthropic/claude-sonnet-4-6",
			usage: {
				input_tokens: 100,
				output_tokens: 20,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				cost: "0.001",
			},
		};
		const response = new Response(JSON.stringify(responseBody), {
			headers: { "content-type": "application/json" },
		});

		const usage = await provider.extractUsageInfo(response);

		expect(usage?.costUsd).toBeUndefined();
	});

	it("returns costUsd 0 when usage.cost is zero (free model, not confused with undefined)", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const responseBody = {
			model: "anthropic/claude-sonnet-4-6",
			usage: {
				input_tokens: 100,
				output_tokens: 20,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				cost: 0,
			},
		};
		const response = new Response(JSON.stringify(responseBody), {
			headers: { "content-type": "application/json" },
		});

		const usage = await provider.extractUsageInfo(response);

		expect(usage?.costUsd).toBe(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// extractStreamingUsage / parseUsage — SC#5 (COST-02): streaming real cost
// ─────────────────────────────────────────────────────────────────────────────

describe("OpenRouterAnthropicProvider.extractStreamingUsage / parseUsage (streaming)", () => {
	// Captured-real fixture (D-04): proven against the real OpenRouter native endpoint
	it("returns costUsd 0.0000070581 from captured-real streaming fixture via extractUsageInfo", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const usage = await provider.extractUsageInfo(
			makeCapturedRealStreamingResponse(),
		);

		expect(usage?.costUsd).toBe(0.0000070581);
	});

	it("returns costUsd 0.0000070581 from captured-real streaming fixture via parseUsage", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const usage = await provider.parseUsage(
			makeCapturedRealStreamingResponse(),
		);

		expect(usage?.costUsd).toBe(0.0000070581);
	});

	it("returns costUsd as a number from a streaming response with a numeric cost", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const usage = await provider.extractUsageInfo(
			makeStreamingResponse(0.0034),
		);

		expect(usage?.costUsd).toBe(0.0034);
	});

	it("returns costUsd 0 when streaming usage.cost is zero (free model) — not confused with undefined", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const usage = await provider.extractUsageInfo(makeStreamingResponse(0));

		// 0 is a valid number — must be 0, not undefined
		expect(usage?.costUsd).toBe(0);
	});

	it("returns costUsd undefined when streaming usage.cost is absent (no estimate fallback)", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const usage = await provider.extractUsageInfo(
			makeStreamingResponse(undefined),
		);

		expect(usage?.costUsd).toBeUndefined();
	});

	it("returns costUsd undefined when streaming usage.cost is null (typeof guard)", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const usage = await provider.extractUsageInfo(makeStreamingResponse(null));

		expect(usage?.costUsd).toBeUndefined();
	});

	it("returns costUsd undefined when streaming usage.cost is a string (type confusion guard)", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const usage = await provider.extractUsageInfo(
			makeStreamingResponse("0.001"),
		);

		expect(usage?.costUsd).toBeUndefined();
	});

	// parseUsage variants
	it("returns costUsd 0 when parseUsage with zero-cost streaming response (free model)", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const usage = await provider.parseUsage(makeStreamingResponse(0));

		expect(usage?.costUsd).toBe(0);
	});

	it("returns costUsd undefined when parseUsage with absent-cost streaming response", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const usage = await provider.parseUsage(makeStreamingResponse(undefined));

		expect(usage?.costUsd).toBeUndefined();
	});

	it("returns costUsd undefined when parseUsage with null cost (no estimate fallback)", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const usage = await provider.parseUsage(makeStreamingResponse(null));

		expect(usage?.costUsd).toBeUndefined();
	});

	it("returns costUsd undefined when parseUsage with string cost (type confusion guard)", async () => {
		const provider = new OpenRouterAnthropicProvider();
		const usage = await provider.parseUsage(makeStreamingResponse("0.001"));

		expect(usage?.costUsd).toBeUndefined();
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// OBS-01 — D-03: X-OpenRouter-Experimental-Metadata header injection
// ─────────────────────────────────────────────────────────────────────────────

describe("OpenRouterAnthropicProvider.transformRequestBody (metadata header, D-03)", () => {
	it("injects X-OpenRouter-Experimental-Metadata: enabled on the transformed request", async () => {
		const provider = new OpenRouterAnthropicProvider();
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

		expect(transformed.headers.get("X-OpenRouter-Experimental-Metadata")).toBe(
			"enabled",
		);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// OBS-01 — D-04: openrouter_metadata debug logging on message_stop
// ─────────────────────────────────────────────────────────────────────────────

describe("OpenRouterAnthropicProvider openrouter_metadata debug tap (D-04)", () => {
	it("logs openrouter_metadata when BETTER_CCFLARE_DEBUG is set", async () => {
		const saved = process.env.BETTER_CCFLARE_DEBUG;
		process.env.BETTER_CCFLARE_DEBUG = "1";
		try {
			const provider = new OpenRouterAnthropicProvider();
			const response = makeMetadataStreamingResponse({
				provider: "Anthropic",
				latency: 100,
			});

			const events = await captureLogEvents(async () => {
				await provider.extractStreamingUsage(response, response.headers);
			});

			const serialized = JSON.stringify(events);
			expect(serialized).toContain("openrouter_metadata");
			expect(serialized).toContain("Anthropic");
		} finally {
			if (saved === undefined) delete process.env.BETTER_CCFLARE_DEBUG;
			else process.env.BETTER_CCFLARE_DEBUG = saved;
		}
	});

	it("does NOT log openrouter_metadata when BETTER_CCFLARE_DEBUG is unset", async () => {
		const saved = process.env.BETTER_CCFLARE_DEBUG;
		delete process.env.BETTER_CCFLARE_DEBUG;
		try {
			const provider = new OpenRouterAnthropicProvider();
			const response = makeMetadataStreamingResponse({
				provider: "Anthropic",
				latency: 100,
			});

			const events = await captureLogEvents(async () => {
				await provider.extractStreamingUsage(response, response.headers);
			});

			const serialized = JSON.stringify(events);
			expect(serialized).not.toContain("openrouter_metadata");
		} finally {
			if (saved === undefined) delete process.env.BETTER_CCFLARE_DEBUG;
			else process.env.BETTER_CCFLARE_DEBUG = saved;
		}
	});
});
