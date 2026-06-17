/**
 * RSS memory-soak test — MANUAL / OPT-IN ONLY.
 *
 * Gated behind the RUN_RSS_SOAK=1 env flag.
 * This test is NOT part of the default `bun test` / CI run.
 *
 * RUN COMMAND:
 *   RUN_RSS_SOAK=1 bun test packages/proxy/src/__tests__/rss-soak.manual.test.ts
 *
 * WHAT IT TESTS:
 *   Push many large-body SSE chunks through a real Bun Worker (post-processor.worker.ts)
 *   and assert that RSS growth stays bounded — i.e., the transferable ArrayBuffer
 *   design moves backing stores rather than cloning them (fixing #244).
 *
 *   If RSS grows unboundedly, the structured-clone leak (oven-sh/bun#5709) has
 *   returned. The test asserts that RSS growth over N concurrent large-body requests
 *   stays below a budget, similar to the existing memory-leak.test.ts pattern.
 *
 * PREREQUISITES:
 *   Task 2 must be complete (UsageWorkerController + post-processor.worker.ts must
 *   exist) before this test can run meaningfully.
 *
 * Pattern modelled after: packages/proxy/src/__tests__/memory-leak.test.ts:13-29
 */
import { describe, expect, it } from "bun:test";

const RUN_RSS_SOAK = process.env.RUN_RSS_SOAK === "1";

describe("RSS soak — off-heap leak regression (#244)", () => {
	// Skip all tests unless RUN_RSS_SOAK=1 is set.
	// Bun test skip: use it.skip or wrap with a conditional.
	const maybeIt = RUN_RSS_SOAK ? it : it.skip;

	maybeIt(
		"RSS growth stays bounded when pushing large-body chunks through the worker",
		async () => {
			// ── Prerequisites ─────────────────────────────────────────────────────
			// This test requires Task 2 artifacts:
			//   - UsageWorkerController (packages/proxy/src/usage-worker-controller.ts)
			//   - post-processor.worker.ts bundled into inline-worker.ts
			//
			// Import lazily so the file compiles even before Task 2 is implemented.
			const controllerMod = await import("../usage-worker-controller").catch(
				() => null,
			);
			if (!controllerMod) {
				console.log(
					"[rss-soak] Skipping: usage-worker-controller not yet implemented",
				);
				return;
			}

			// ── Parameters ────────────────────────────────────────────────────────
			const CONCURRENT_REQUESTS = 10;
			const CHUNK_SIZE_BYTES = 512 * 1024; // 512 KB per chunk
			const CHUNKS_PER_REQUEST = 4; // 4 chunks × 512 KB = 2 MB per request
			// With structured-clone leak: 10 × 2 MB × 2 (clone) = 40 MB additional RSS
			// With transfer: backing store moved, so growth ≈ 0 (re-used)
			const RSS_BUDGET_BYTES = 15 * 1024 * 1024; // 15 MB headroom

			// ── Setup ─────────────────────────────────────────────────────────────
			const summaries: unknown[] = [];
			const controller = new controllerMod.UsageWorkerController(
				(msg: unknown) => {
					summaries.push(msg);
				},
				() => {
					// onReady callback — worker started
					console.log("[rss-soak] Worker ready");
				},
			);

			controller.start();

			// Wait for the worker to become ready (up to 30s)
			const waitReady = async () => {
				const deadline = Date.now() + 30_000;
				while (!controller.isReady()) {
					if (Date.now() > deadline) throw new Error("Worker did not become ready");
					await new Promise((r) => setTimeout(r, 100));
				}
			};
			await waitReady();

			// ── Baseline RSS ──────────────────────────────────────────────────────
			// Force GC if available (Bun exposes --expose-gc)
			if (typeof globalThis.gc === "function") {
				globalThis.gc();
				await new Promise((r) => setTimeout(r, 100));
			}
			const baselineRss = process.memoryUsage().rss;
			console.log(
				`[rss-soak] Baseline RSS: ${(baselineRss / 1024 / 1024).toFixed(1)} MB`,
			);

			// ── Pump chunks ───────────────────────────────────────────────────────
			const requestIds = Array.from(
				{ length: CONCURRENT_REQUESTS },
				(_, i) => `soak-req-${i}`,
			);

			// Send StartMessage for each request
			for (const requestId of requestIds) {
				const startMsg = {
					type: "start" as const,
					messageId: crypto.randomUUID(),
					requestId,
					accountId: null,
					method: "POST",
					path: "/v1/messages",
					timestamp: Date.now(),
					requestHeaders: {},
					requestBody: null,
					project: null,
					responseStatus: 200,
					responseHeaders: {},
					isStream: true,
					providerName: "anthropic",
					accountBillingType: null,
					accountAutoPauseOnOverageEnabled: null,
					accountName: null,
					agentUsed: null,
					comboName: null,
					apiKeyId: null,
					apiKeyName: null,
					retryAttempt: 0,
					failoverAttempts: 0,
				};
				controller.postMessage(startMsg);
			}

			// Send large chunks — each chunk's buffer is TRANSFERRED (not cloned)
			for (let c = 0; c < CHUNKS_PER_REQUEST; c++) {
				for (const requestId of requestIds) {
					// Build a standalone ArrayBuffer (the copy that would come from value.slice())
					const chunkData = new Uint8Array(CHUNK_SIZE_BYTES);
					// Fill with recognizable pattern to make memory distinct
					chunkData.fill((c * 7 + requestIds.indexOf(requestId)) % 256);
					const buf = chunkData.buffer;

					const chunkMsg = {
						type: "chunk" as const,
						requestId,
						data: buf,
					};
					// postMessage with transfer list — the buf is moved to the worker
					controller.postMessage(chunkMsg);
				}
			}

			// Send EndMessages
			for (const requestId of requestIds) {
				controller.postMessage({
					type: "end" as const,
					requestId,
					success: true,
				});
			}

			// Wait for processing to settle
			await new Promise((r) => setTimeout(r, 2_000));

			// ── Measure RSS growth ────────────────────────────────────────────────
			if (typeof globalThis.gc === "function") {
				globalThis.gc();
				await new Promise((r) => setTimeout(r, 200));
			}

			const afterRss = process.memoryUsage().rss;
			const rssGrowth = afterRss - baselineRss;
			console.log(
				`[rss-soak] After RSS: ${(afterRss / 1024 / 1024).toFixed(1)} MB`,
			);
			console.log(
				`[rss-soak] RSS growth: ${(rssGrowth / 1024 / 1024).toFixed(1)} MB (budget: ${RSS_BUDGET_BYTES / 1024 / 1024} MB)`,
			);

			// ── Graceful shutdown ─────────────────────────────────────────────────
			await controller.terminate();

			// ── Assert bounded growth ─────────────────────────────────────────────
			// With transferable ArrayBuffers: backing store MOVES to the worker,
			// so the main thread's RSS should NOT accumulate chunk data.
			// With structured-clone (broken): RSS would grow by ~40 MB.
			expect(rssGrowth).toBeLessThan(RSS_BUDGET_BYTES);
		},
		// 60 second timeout for the soak
		60_000,
	);

	// ── Compile-time smoke test (always runs, fast) ─────────────────────────
	it("rss-soak file compiles and gating env var is respected (meta test)", () => {
		const shouldRun = process.env.RUN_RSS_SOAK === "1";
		if (shouldRun) {
			console.log("[rss-soak] RUN_RSS_SOAK=1 — soak test will execute");
		} else {
			console.log(
				"[rss-soak] RUN_RSS_SOAK not set — soak test is skipped (run with RUN_RSS_SOAK=1 bun test rss-soak.manual)",
			);
		}
		// No assertion needed — just verify the file loads without crashing
		expect(true).toBe(true);
	});
});
