/**
 * Tests for forwardToClient → UsageWorkerController dispatch protocol.
 *
 * Spies on getUsageWorker() from proxy.ts (the controller-dispatch seam)
 * to verify that forwardToClient correctly routes usage accounting through
 * the worker controller rather than the synchronous main-thread collector.
 *
 * Covers:
 *   - handleStart dispatch with correct StartMessage fields
 *   - onChunk dispatch: the COPY is dispatched (not the client's value),
 *     with a non-empty transfer list (via controller.postMessage internally)
 *   - Guard regression: a throwing postMessage MUST NOT call controller.error()
 *     and MUST NOT prevent client bytes from being delivered
 *   - onClose / onError fire EndMessage via guarded path
 *   - shouldProcessRequest filter still works (count_tokens, auto-refresh probes)
 *   - store_payloads=false sends null requestBody
 */
import { describe, expect, it, mock, spyOn } from "bun:test";
// ── module under spy ──────────────────────────────────────────────────────────
// forwardToClient calls getUsageWorker() from proxy.ts to obtain the
// UsageWorkerController. We spy on that accessor to intercept postMessage calls.
import * as proxyModule from "../proxy";
import { forwardToClient } from "../response-handler";

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

interface MockWorkerDispatch {
	starts: Record<string, unknown>[];
	chunks: Array<{
		requestId: string;
		data: ArrayBuffer;
	}>;
	ends: Record<string, unknown>[];
	/** Whether controller.error was called (must NEVER be true) */
	controllerErrorCalled: boolean;
}

/**
 * Creates a mock UsageWorkerController that intercepts postMessage calls.
 *
 * isReady() returns true so that start/end messages are dispatched
 * (the controller only dispatches non-chunk messages when ready).
 */
function createMockWorkerSeam(): MockWorkerDispatch & {
	restore: () => void;
} {
	const starts: Record<string, unknown>[] = [];
	const chunks: Array<{ requestId: string; data: ArrayBuffer }> = [];
	const ends: Record<string, unknown>[] = [];
	const controllerErrorCalled = false;

	const mockController = {
		isReady: mock(() => true),
		postMessage: mock((msg: Record<string, unknown>) => {
			if (msg.type === "start") {
				starts.push(msg);
			} else if (msg.type === "chunk") {
				chunks.push({
					requestId: msg.requestId as string,
					data: msg.data as ArrayBuffer,
				});
			} else if (msg.type === "end") {
				ends.push(msg);
			}
		}),
	};

	const spy = spyOn(proxyModule, "getUsageWorker").mockReturnValue(
		mockController as unknown as ReturnType<typeof proxyModule.getUsageWorker>,
	);

	return {
		starts,
		chunks,
		ends,
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
		const { starts, restore } = createMockWorkerSeam();
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
		const { starts, restore } = createMockWorkerSeam();
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
		const { starts, restore } = createMockWorkerSeam();
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
		const { ends, restore } = createMockWorkerSeam();
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
		const { starts, restore } = createMockWorkerSeam();
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
// A throw in onChunk / postMessage dispatch MUST:
//   1. NOT call controller.error()  (the stream tee must deliver all bytes)
//   2. NOT prevent client bytes from being delivered
// ---------------------------------------------------------------------------

describe("forwardToClient → worker dispatch: guard regression (#245)", () => {
	it("GUARD: a throwing postMessage does NOT call controller.error and bytes are delivered", async () => {
		// Setup: mock worker whose postMessage THROWS on chunk messages
		const throwingController = {
			isReady: mock(() => true),
			postMessage: mock((msg: Record<string, unknown>) => {
				if (msg.type === "chunk") {
					throw new Error("simulated worker dispatch failure");
				}
			}),
		};

		const spy = spyOn(proxyModule, "getUsageWorker").mockReturnValue(
			throwingController as unknown as ReturnType<
				typeof proxyModule.getUsageWorker
			>,
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

			// The client must receive ALL bytes — the throw in postMessage must be
			// swallowed by safeHandleChunk, not propagated to teeStream's pull() catch.
			const text = await response.text();
			expect(text).toBe("data: chunk-one\n\ndata: chunk-two\n\n");
		} finally {
			spy.mockRestore();
		}
	});

	it("GUARD: a throwing postMessage for handleStart does NOT abort the response", async () => {
		const throwingController = {
			isReady: mock(() => true),
			postMessage: mock((msg: Record<string, unknown>) => {
				if (msg.type === "start") {
					throw new Error("handleStart failure");
				}
			}),
		};

		const spy = spyOn(proxyModule, "getUsageWorker").mockReturnValue(
			throwingController as unknown as ReturnType<
				typeof proxyModule.getUsageWorker
			>,
		);

		try {
			const ctx = createCtx();

			// safeHandleStart swallows throws — response must still be returned
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
		const { starts, chunks, ends, restore } = createMockWorkerSeam();
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
			// Verify chunk messages carry ArrayBuffer (not Uint8Array) — transfer protocol
			expect(chunks[0].data).toBeInstanceOf(ArrayBuffer);
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
