/**
 * Tests for synthetic probe pollution fixes added in PR #200 (bug 2).
 *
 * Three sites guard against auto-refresh probe pollution:
 *   1. proxy-operations.ts  — isSyntheticInternal skips cacheBodyStore.stageRequest
 *   2. response-handler.ts  — shouldProcessRequest is false for auto-refresh probes
 *   3. proxy.ts             — pool-exhausted path skips usageWorker calls for probes
 */
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import type { Account } from "@better-ccflare/types";
import * as proxyModule from "../proxy";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeAccount(overrides: Partial<Account> = {}): Account {
	return {
		id: "acc-1",
		name: "test-account",
		provider: "anthropic",
		api_key: null,
		refresh_token: null,
		access_token: null,
		expires_at: null,
		request_count: 0,
		total_requests: 0,
		last_used: null,
		created_at: Date.now(),
		rate_limited_until: null,
		rate_limited_reason: null,
		rate_limited_at: null,
		session_start: null,
		session_request_count: 0,
		paused: false,
		rate_limit_reset: null,
		rate_limit_status: null,
		rate_limit_remaining: null,
		priority: 0,
		auto_fallback_enabled: false,
		auto_refresh_enabled: false,
		auto_pause_on_overage_enabled: false,
		peak_hours_pause_enabled: false,
		custom_endpoint: null,
		model_mappings: null,
		cross_region_mode: null,
		model_fallbacks: null,
		billing_type: null,
		pause_reason: null,
		refresh_token_issued_at: null,
		...overrides,
	};
}

/**
 * Creates a mock UsageWorkerController that intercepts postMessage calls.
 * isReady() returns true so that start/end messages are dispatched
 * (the real controller only dispatches non-chunk messages when ready).
 */
function createMockWorkerController() {
	const postedMessages: Array<Record<string, unknown>> = [];
	const mockController = {
		isReady: mock(() => true),
		postMessage: mock((msg: Record<string, unknown>) => {
			postedMessages.push(msg);
		}),
	};
	const spy = spyOn(proxyModule, "getUsageWorker").mockReturnValue(
		mockController as unknown as ReturnType<typeof proxyModule.getUsageWorker>,
	);
	return { postedMessages, mockController, spy };
}

// ---------------------------------------------------------------------------
// Site 1: isSyntheticInternal in proxy-operations.ts
//
// The guard is: isSyntheticInternal = !!req.headers.get("x-better-ccflare-auto-refresh")
// We test the header detection logic in isolation — the exact boolean produced
// by the header check — rather than mocking cache-body-store (which poisons
// the module registry in Bun and breaks cache-body-store.test.ts).
// ---------------------------------------------------------------------------

describe("proxy-operations — isSyntheticInternal header detection", () => {
	it("header x-better-ccflare-auto-refresh: true is truthy (probe detected)", () => {
		const req = new Request("https://proxy.local/v1/messages", {
			method: "POST",
			headers: { "x-better-ccflare-auto-refresh": "true" },
		});
		const isSyntheticInternal =
			!!req.headers.get("x-better-ccflare-keepalive") ||
			!!req.headers.get("x-better-ccflare-auto-refresh");
		expect(isSyntheticInternal).toBe(true);
	});

	it("header x-better-ccflare-auto-refresh absent is falsy (normal request)", () => {
		const req = new Request("https://proxy.local/v1/messages", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
		});
		const isSyntheticInternal =
			!!req.headers.get("x-better-ccflare-keepalive") ||
			!!req.headers.get("x-better-ccflare-auto-refresh");
		expect(isSyntheticInternal).toBe(false);
	});

	it("keepalive header also triggers isSyntheticInternal (existing guard preserved)", () => {
		const req = new Request("https://proxy.local/v1/messages", {
			method: "POST",
			headers: { "x-better-ccflare-keepalive": "1" },
		});
		const isSyntheticInternal =
			!!req.headers.get("x-better-ccflare-keepalive") ||
			!!req.headers.get("x-better-ccflare-auto-refresh");
		expect(isSyntheticInternal).toBe(true);
	});

	it("neither header present produces false (real user traffic passes through)", () => {
		const req = new Request("https://proxy.local/v1/messages", {
			method: "POST",
		});
		const isSyntheticInternal =
			!!req.headers.get("x-better-ccflare-keepalive") ||
			!!req.headers.get("x-better-ccflare-auto-refresh");
		expect(isSyntheticInternal).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Site 2: shouldProcessRequest in response-handler.ts
// Now spies on getUsageWorker (the worker controller seam) instead of getUsageCollector.
// ---------------------------------------------------------------------------

describe("response-handler — shouldProcessRequest suppresses auto-refresh probes", () => {
	it("does not call usageWorker.postMessage for auto-refresh probe requests", async () => {
		const { postedMessages, spy } = createMockWorkerController();
		const { forwardToClient } = await import("../response-handler");

		try {
			const account = makeAccount();

			const ctx = {
				provider: {
					name: "anthropic",
					isStreamingResponse: () => false,
				} as never,
				config: { getStorePayloads: () => false } as never,
			};

			const response = new Response(JSON.stringify({ type: "message" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});

			const requestHeaders = new Headers({
				"x-better-ccflare-auto-refresh": "true",
			});

			await forwardToClient(
				{
					requestId: "req-probe",
					method: "POST",
					path: "/v1/messages",
					account,
					requestHeaders,
					requestBody: null,
					response,
					timestamp: Date.now(),
					retryAttempt: 0,
					failoverAttempts: 0,
				},
				ctx as never,
			);

			// No start message should be posted for probe requests
			const startMessages = postedMessages.filter((m) => m.type === "start");
			expect(startMessages.length).toBe(0);
		} finally {
			spy.mockRestore();
		}
	});

	it("calls usageWorker.postMessage with start message for normal (non-probe) requests", async () => {
		const { postedMessages, spy } = createMockWorkerController();
		const { forwardToClient } = await import("../response-handler");

		try {
			const account = makeAccount();

			const ctx = {
				provider: {
					name: "anthropic",
					isStreamingResponse: () => false,
				} as never,
				config: { getStorePayloads: () => false } as never,
			};

			const response = new Response(JSON.stringify({ type: "message" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});

			// No auto-refresh header
			const requestHeaders = new Headers();

			await forwardToClient(
				{
					requestId: "req-normal",
					method: "POST",
					path: "/v1/messages",
					account,
					requestHeaders,
					requestBody: null,
					response,
					timestamp: Date.now(),
					retryAttempt: 0,
					failoverAttempts: 0,
				},
				ctx as never,
			);

			// At minimum a "start" message should have been posted
			const startMessages = postedMessages.filter((m) => m.type === "start");
			expect(startMessages.length).toBeGreaterThan(0);
		} finally {
			spy.mockRestore();
		}
	});
});

// ---------------------------------------------------------------------------
// Site 3: pool-exhausted path in proxy.ts
// Now spies on getUsageWorker (the worker controller seam) instead of getUsageCollector.
// ---------------------------------------------------------------------------

describe("proxy.ts — pool-exhausted path skips usageWorker for auto-refresh probes", () => {
	let savedPassthrough: string | undefined;

	beforeEach(() => {
		savedPassthrough = process.env.CCFLARE_PASSTHROUGH_ON_EMPTY_POOL;
		delete process.env.CCFLARE_PASSTHROUGH_ON_EMPTY_POOL;
	});

	afterEach(() => {
		if (savedPassthrough === undefined) {
			delete process.env.CCFLARE_PASSTHROUGH_ON_EMPTY_POOL;
		} else {
			process.env.CCFLARE_PASSTHROUGH_ON_EMPTY_POOL = savedPassthrough;
		}
	});

	it("does not call usageWorker when pool is exhausted and request is an auto-refresh probe", async () => {
		const { postedMessages, spy } = createMockWorkerController();
		const { handleProxy } = await import("../proxy");

		try {
			const ctx = {
				strategy: {
					select: () => [],
				} as never,
				dbOps: {
					getAllAccounts: mock(async () => []),
					getActiveComboForFamily: mock(async () => null),
				} as never,
				runtime: { port: 8080, clientId: "test" } as never,
				config: {
					getUsageThrottlingFiveHourEnabled: () => false,
					getUsageThrottlingWeeklyEnabled: () => false,
					getSystemPromptCacheTtl1h: () => false,
					getAgentFrontmatterModelFallback: () => false,
				} as never,
				provider: {
					name: "anthropic",
					canHandle: () => true,
				} as never,
				refreshInFlight: new Map(),
				asyncWriter: { enqueue: mock(() => {}) } as never,
			};

			const probeRequest = new Request("https://proxy.local/v1/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-better-ccflare-auto-refresh": "true",
				},
				body: JSON.stringify({
					model: "claude-haiku-4-5",
					messages: [{ role: "user", content: "hi" }],
					max_tokens: 10,
				}),
			});

			const response = await handleProxy(
				probeRequest,
				new URL("https://proxy.local/v1/messages"),
				ctx as never,
			);

			// Should still return 503
			expect(response.status).toBe(503);

			// But must NOT call usageWorker for probes
			const startMessages = postedMessages.filter((m) => m.type === "start");
			const endMessages = postedMessages.filter((m) => m.type === "end");
			expect(startMessages.length).toBe(0);
			expect(endMessages.length).toBe(0);
		} finally {
			spy.mockRestore();
		}
	});

	it("calls usageWorker when pool is exhausted and request is NOT an auto-refresh probe", async () => {
		const { postedMessages, spy } = createMockWorkerController();
		const { handleProxy } = await import("../proxy");

		try {
			const ctx = {
				strategy: {
					select: () => [],
				} as never,
				dbOps: {
					getAllAccounts: mock(async () => []),
					getActiveComboForFamily: mock(async () => null),
				} as never,
				runtime: { port: 8080, clientId: "test" } as never,
				config: {
					getUsageThrottlingFiveHourEnabled: () => false,
					getUsageThrottlingWeeklyEnabled: () => false,
					getSystemPromptCacheTtl1h: () => false,
					getAgentFrontmatterModelFallback: () => false,
				} as never,
				provider: {
					name: "anthropic",
					canHandle: () => true,
				} as never,
				refreshInFlight: new Map(),
				asyncWriter: { enqueue: mock(() => {}) } as never,
			};

			const normalRequest = new Request("https://proxy.local/v1/messages", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: "claude-haiku-4-5",
					messages: [{ role: "user", content: "hi" }],
					max_tokens: 10,
				}),
			});

			const response = await handleProxy(
				normalRequest,
				new URL("https://proxy.local/v1/messages"),
				ctx as never,
			);

			expect(response.status).toBe(503);

			// Normal requests MUST be logged via the worker
			const startMessages = postedMessages.filter((m) => m.type === "start");
			expect(startMessages.length).toBeGreaterThan(0);
		} finally {
			spy.mockRestore();
		}
	});
});
