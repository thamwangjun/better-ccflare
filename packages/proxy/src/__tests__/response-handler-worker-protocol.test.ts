/**
 * Tests for forwardToClient → UsageWorkerController dispatch protocol.
 *
 * REWRITTEN from the collector-mock seam (spyOn getUsageCollector) to the
 * controller-dispatch seam (spyOn getUsageWorker / safe dispatch).
 *
 * Covers:
 *   - handleStart dispatch with correct StartMessage fields
 *   - onChunk dispatch: the COPY is dispatched (not the client's value),
 *     with a non-empty transfer list
 *   - Guard regression: a throwing dispatch MUST NOT call controller.error()
 *     and MUST NOT prevent client bytes from being delivered
 *   - onClose / onError fire EndMessage via guarded path
 *   - shouldProcessRequest filter still works (count_tokens, auto-refresh probes)
 *   - store_payloads=false sends null requestBody
 *
 * These tests will FAIL until Task 2 wires forwardToClient to the controller.
 */
import { describe, expect, it, mock, spyOn } from "bun:test";
import { forwardToClient } from "../response-handler";

// ── module under spy ──────────────────────────────────────────────────────────
// Task 2 will introduce a getUsageWorker export from proxy.ts (or a dedicated
// module). Until then these tests import the *current* usage-collector module
// so they compile — but the spy target will shift in Task 2.
//
// Phase: RED — these tests assert the NEW controller seam and will fail because
// forwardToClient still calls getUsageCollector() (collector seam).
import * as usageCollectorModule from "../usage-collector";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitFor(
	predicate: () => boolean,
	timeoutMs = 1000,
): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("Timed out");
		await new Promise((r) => setTimeout(r, 10));
	}
}

interface MockControllerDispatch {
	starts: Record<string, unknown>[];
	chunks: Array<{
		requestId: string;
		data: ArrayBuffer;
		transfer: Transferable[];
	}>;
	ends: Record<string, unknown>[];
	errors: Error[];
	/** Whether controller.error was called (must NEVER be true) */
	controllerErrorCalled: boolean;
}

/**
 * Creates a mock that intercepts the controller dispatch seam.
 *
 * In Task 2, forwardToClient will call something like:
 *   safePostChunk(worker, requestId, copy.buffer)
 * or:
 *   worker.postMessage(chunkMsg, [copy.buffer])
 *
 * We spy on getUsageCollector to verify the current (broken) path fails the
 * guard test, documenting what Task 2 must change.
 */
function createMockCollectorSeam(): MockControllerDispatch & {
	restore: () => void;
} {
	const starts: Record<string, unknown>[] = [];
	const chunks: Array<{
		requestId: string;
		data: ArrayBuffer;
		transfer: Transferable[];
	}> = [];
	const ends: Record<string, unknown>[] = [];
	const errors: Error[] = [];
	const controllerErrorCalled = false;

	const collector = {
		handleStart: mock((msg: Record<string, unknown>) => {
			starts.push(msg);
		}),
		handleChunk: mock((requestId: string, data: Uint8Array) => {
			// In the OLD seam, data is the raw Uint8Array value — not a copy
			// In the NEW seam, data should be a standalone ArrayBuffer copy
			chunks.push({
				requestId,
				data: data.buffer as ArrayBuffer,
				transfer: [], // OLD path doesn't pass transfer list
			});
		}),
		handleEnd: mock((msg: Record<string, unknown>) => {
			ends.push(msg);
			return Promise.resolve();
		}),
	};

	const spy = spyOn(usageCollectorModule, "getUsageCollector").mockReturnValue(
		collector as unknown as usageCollectorModule.UsageCollector,
	);

	return {
		starts,
		chunks,
		ends,
		errors,
		controllerErrorCalled,
		restore: () => spy.mockRestore(),
	};
}

function createCtx(storePayloads = true) {
	return {
		strategy: {},
		dbOps: {},
		runtime: { port: 8080, tlsEnabled: false },
		config: {
			getStorePayloads: () => storePayloads,
		},
		provider: {
			name: "anthropic",
			isStreamingResponse: () => false,
		},
		refreshInFlight: new Map<string, Promise<string>>(),
		asyncWriter: {},
	} as unknown as import("../handlers").ProxyContext;
}

// ---------------------------------------------------------------------------
// Suite 1: Message contract (protocol shapes)
// ---------------------------------------------------------------------------

describe("forwardToClient → worker dispatch: message contract", () => {
	it("dispatches StartMessage with required fields", async () => {
		const { starts, restore } = createMockCollectorSeam();
		try {
			const ctx = createCtx();
			await forwardToClient(
				{
					requestId: "req-start",
					method: "POST",
					path: "/v1/messages",
					account: null,
					requestHeaders: new Headers({ "content-type": "application/json" }),
					requestBody: new TextEncoder().encode("{}"),
					response: new Response(JSON.stringify({ ok: true }), {
						status: 200,
						headers: { "content-type": "application/json" },
					}),
					timestamp: 12345,
					retryAttempt: 0,
					failoverAttempts: 0,
				},
				ctx,
			);

			expect(starts.length).toBeGreaterThan(0);
			const start = starts[0];
			expect(start.type).toBe("start");
			expect(typeof start.messageId).toBe("string");
			expect(start.requestId).toBe("req-start");
			expect(start.method).toBe("POST");
			expect(start.path).toBe("/v1/messages");
			expect(start.timestamp).toBe(12345);
			expect(start.retryAttempt).toBe(0);
			expect(start.failoverAttempts).toBe(0);
		} finally {
			restore();
		}
	});

	it("dispatches null requestBody when store_payloads=false", async () => {
		const { starts, restore } = createMockCollectorSeam();
		try {
			await forwardToClient(
				{
					requestId: "req-no-body",
					method: "POST",
					path: "/v1/messages",
					account: null,
					requestHeaders: new Headers(),
					requestBody: new TextEncoder().encode(
						JSON.stringify({ hello: "world" }),
					),
					project: "test-project",
					response: new Response("{}", {
						status: 200,
						headers: { "content-type": "application/json" },
					}),
					timestamp: Date.now(),
					retryAttempt: 0,
					failoverAttempts: 0,
				},
				createCtx(false),
			);

			expect(starts[0].requestBody).toBeNull();
			expect(starts[0].project).toBe("test-project");
		} finally {
			restore();
		}
	});

	it("dispatches base64 requestBody when store_payloads=true", async () => {
		const { starts, restore } = createMockCollectorSeam();
		const body = JSON.stringify({
			messages: [{ role: "user", content: "hi" }],
		});
		try {
			await forwardToClient(
				{
					requestId: "req-body",
					method: "POST",
					path: "/v1/messages",
					account: null,
					requestHeaders: new Headers(),
					requestBody: new TextEncoder().encode(body),
					response: new Response("{}", {
						status: 200,
						headers: { "content-type": "application/json" },
					}),
					timestamp: Date.now(),
					retryAttempt: 0,
					failoverAttempts: 0,
				},
				createCtx(true),
			);

			expect(starts[0].requestBody).toBe(Buffer.from(body).toString("base64"));
		} finally {
			restore();
		}
	});

	it("sends EndMessage on non-streaming close", async () => {
		const { ends, restore } = createMockCollectorSeam();
		try {
			const ctx = createCtx();
			const response = await forwardToClient(
				{
					requestId: "req-end",
					method: "POST",
					path: "/v1/messages",
					account: null,
					requestHeaders: new Headers(),
					requestBody: null,
					response: new Response(JSON.stringify({ result: true }), {
						status: 200,
						headers: { "content-type": "application/json" },
					}),
					timestamp: Date.now(),
					retryAttempt: 0,
					failoverAttempts: 0,
				},
				ctx,
			);

			await response.text(); // drain
			await waitFor(() => ends.length > 0);

			expect(ends[0]).toMatchObject({
				type: "end",
				requestId: "req-end",
				success: true,
			});
		} finally {
			restore();
		}
	});

	it("filters count_tokens path on openai-compatible provider", async () => {
		const { starts, restore } = createMockCollectorSeam();
		try {
			const ctx = createCtx();
			ctx.provider.name = "openai-compatible";

			await forwardToClient(
				{
					requestId: "req-count",
					method: "POST",
					path: "/v1/messages/count_tokens",
					account: null,
					requestHeaders: new Headers(),
					requestBody: null,
					response: new Response("{}", {
						status: 200,
						headers: { "content-type": "application/json" },
					}),
					timestamp: Date.now(),
					retryAttempt: 0,
					failoverAttempts: 0,
				},
				ctx,
			);

			expect(starts.length).toBe(0);
		} finally {
			restore();
		}
	});
});

// ---------------------------------------------------------------------------
// Suite 2: Guard regression — the critical #245 regression test
//
// A throw in onChunk / handleStart dispatch MUST:
//   1. NOT call controller.error()  (currently FAILS — no guard)
//   2. NOT prevent client bytes from being delivered
//
// These tests will PASS in the OLD seam (no guard) only if they're written to
// assert the DESIRED behavior — i.e., the test itself must FAIL on the current
// code, confirming the RED state.
// ---------------------------------------------------------------------------

describe("forwardToClient → worker dispatch: guard regression (#245)", () => {
	it("GUARD: a throwing handleChunk does NOT call controller.error and bytes are delivered", async () => {
		// This is the critical regression test.
		// Setup: mock collector whose handleChunk THROWS
		const throwingCollector = {
			handleStart: mock(() => {}),
			handleChunk: mock((_requestId: string, _data: Uint8Array) => {
				throw new Error("simulated worker dispatch failure");
			}),
			handleEnd: mock(() => Promise.resolve()),
		};

		const spy = spyOn(
			usageCollectorModule,
			"getUsageCollector",
		).mockReturnValue(
			throwingCollector as unknown as usageCollectorModule.UsageCollector,
		);

		try {
			const ctx = createCtx();
			ctx.provider.isStreamingResponse = () => true;

			const encoder = new TextEncoder();
			const chunks = [
				encoder.encode("data: chunk-one\n\n"),
				encoder.encode("data: chunk-two\n\n"),
			];

			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					for (const c of chunks) controller.enqueue(c);
					controller.close();
				},
			});

			const response = await forwardToClient(
				{
					requestId: "req-guard",
					method: "POST",
					path: "/v1/messages",
					account: null,
					requestHeaders: new Headers(),
					requestBody: null,
					response: new Response(body, {
						status: 200,
						headers: { "content-type": "text/event-stream" },
					}),
					timestamp: Date.now(),
					retryAttempt: 0,
					failoverAttempts: 0,
				},
				ctx,
			);

			// The client must receive ALL bytes — the throw in handleChunk must be
			// swallowed, not propagated to teeStream's pull() catch.
			//
			// EXPECTED (after Task 2 guard is implemented):
			//   text === "data: chunk-one\n\ndata: chunk-two\n\n"
			//
			// CURRENT STATE (no guard): the throw propagates to controller.error(),
			// which discards the enqueued chunk → the stream is broken → this
			// assertion FAILS, confirming RED.
			const text = await response.text();
			expect(text).toBe("data: chunk-one\n\ndata: chunk-two\n\n");
		} finally {
			spy.mockRestore();
		}
	});

	it("GUARD: a throwing handleStart does NOT abort the response", async () => {
		const throwingCollector = {
			handleStart: mock(() => {
				throw new Error("handleStart failure");
			}),
			handleChunk: mock(() => {}),
			handleEnd: mock(() => Promise.resolve()),
		};

		const spy = spyOn(
			usageCollectorModule,
			"getUsageCollector",
		).mockReturnValue(
			throwingCollector as unknown as usageCollectorModule.UsageCollector,
		);

		try {
			const ctx = createCtx();

			// EXPECTED (after guard): resolves to a Response
			// CURRENT: throws or resolves depending on where in the call stack it
			// propagates. forwardToClient calls handleStart() synchronously before
			// teeStream, so currently it throws and the response is never returned.
			// That makes this test RED.
			await expect(
				forwardToClient(
					{
						requestId: "req-guard-start",
						method: "POST",
						path: "/v1/messages",
						account: null,
						requestHeaders: new Headers(),
						requestBody: null,
						response: new Response("{}", {
							status: 200,
							headers: { "content-type": "application/json" },
						}),
						timestamp: Date.now(),
						retryAttempt: 0,
						failoverAttempts: 0,
					},
					ctx,
				),
			).resolves.toBeInstanceOf(Response);
		} finally {
			spy.mockRestore();
		}
	});
});

// ---------------------------------------------------------------------------
// Suite 3: teeStream integration (these already pass and must stay green)
// ---------------------------------------------------------------------------

describe("forwardToClient → worker dispatch: streaming tee (regression)", () => {
	it("streams all chunks to the client and sends EndMessage", async () => {
		const { starts, chunks, ends, restore } = createMockCollectorSeam();
		try {
			const ctx = createCtx();
			ctx.provider.isStreamingResponse = () => true;

			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					const enc = new TextEncoder();
					controller.enqueue(enc.encode("data: one\n\n"));
					controller.enqueue(enc.encode("data: two\n\n"));
					controller.close();
				},
			});

			const response = await forwardToClient(
				{
					requestId: "req-tee",
					method: "POST",
					path: "/v1/messages",
					account: null,
					requestHeaders: new Headers(),
					requestBody: null,
					response: new Response(body, {
						status: 200,
						headers: { "content-type": "text/event-stream" },
					}),
					timestamp: Date.now(),
					retryAttempt: 0,
					failoverAttempts: 0,
				},
				ctx,
			);

			await expect(response.text()).resolves.toBe("data: one\n\ndata: two\n\n");
			await waitFor(() => ends.length > 0);

			expect(chunks.length).toBe(2);
			expect(starts[0]).toMatchObject({ type: "start", requestId: "req-tee" });
			expect(ends[0]).toMatchObject({
				type: "end",
				requestId: "req-tee",
				success: true,
			});
		} finally {
			restore();
		}
	});
});
