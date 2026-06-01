import { describe, expect, it } from "bun:test";
import { extractUsageFromData } from "../usage-extraction";

describe("Worker SSE parsing", () => {
	// Import the functions inline to test them
	function parseSSELine(line: string): { event?: string; data?: string } {
		// Handle both "event: message_start" and "event:message_start" formats
		// Some providers use no space, Anthropic uses space
		if (line.startsWith("event: ") || line.startsWith("event:")) {
			const event = line.startsWith("event: ")
				? line.slice(7).trim()
				: line.slice(6).trim();
			return { event };
		}
		// Handle both "data: {...}" and "data:{...}" formats
		if (line.startsWith("data: ") || line.startsWith("data:")) {
			const data = line.startsWith("data: ")
				? line.slice(6).trim()
				: line.slice(5).trim();
			return { data };
		}
		return {};
	}

	describe("parseSSELine", () => {
		it("parses standard Anthropic format with space", () => {
			const result = parseSSELine("event: message_start");
			expect(result.event).toBe("message_start");
			expect(result.data).toBeUndefined();
		});

		it("parses provider format without space", () => {
			const result = parseSSELine("event:message_start");
			expect(result.event).toBe("message_start");
			expect(result.data).toBeUndefined();
		});

		it("parses data line with space", () => {
			const result = parseSSELine('data: {"type":"message_start"}');
			expect(result.data).toBe('{"type":"message_start"}');
			expect(result.event).toBeUndefined();
		});

		it("parses data line without space", () => {
			const result = parseSSELine('data:{"message":{"model":"glm-5"}}');
			expect(result.data).toBe('{"message":{"model":"glm-5"}}');
			expect(result.event).toBeUndefined();
		});

		it("returns empty object for non-SSE lines", () => {
			const result = parseSSELine("some random text");
			expect(result).toEqual({});
		});

		it("handles whitespace in values", () => {
			const result = parseSSELine("event:  message_delta  ");
			expect(result.event).toBe("message_delta");
		});
	});

	describe("extractUsageFromData with eventType", () => {
		it("extracts usage from Anthropic format (type in JSON)", () => {
			const state = { usage: {} };
			const data = JSON.stringify({
				type: "message_start",
				message: {
					model: "claude-3-5-sonnet",
					usage: { input_tokens: 100, output_tokens: 0 },
				},
			});
			extractUsageFromData(data, "message_start", state);
			expect(state.usage.model).toBe("claude-3-5-sonnet");
			expect(state.usage.inputTokens).toBe(100);
		});

		it("extracts usage from alternate format (type in event line)", () => {
			const state = { usage: {} };
			const data = JSON.stringify({
				message: {
					model: "glm-5",
					usage: { input_tokens: 41561, output_tokens: 0 },
				},
			});
			extractUsageFromData(data, "message_start", state);
			expect(state.usage.model).toBe("glm-5");
			expect(state.usage.inputTokens).toBe(41561);
		});

		it("extracts output tokens from message_delta", () => {
			const state = { usage: {} };
			const data = JSON.stringify({
				usage: { output_tokens: 51 },
			});
			extractUsageFromData(data, "message_delta", state);
			expect(state.usage.outputTokens).toBe(51);
		});

		it("handles both formats for message_delta", () => {
			const state = { usage: {} };
			const data1 = JSON.stringify({
				type: "message_delta",
				usage: { output_tokens: 100 },
			});
			extractUsageFromData(data1, "some_event", state);
			expect(state.usage.outputTokens).toBe(100);

			const state2 = { usage: {} };
			const data2 = JSON.stringify({
				usage: { output_tokens: 200 },
			});
			extractUsageFromData(data2, "message_delta", state2);
			expect(state2.usage.outputTokens).toBe(200);
		});

		// COST-02: OpenRouter provider-returned cost extraction (per D-03)
		it("extracts providerCostUsd from message_delta when cost is present", () => {
			const state = { usage: { providerCostUsd: undefined } };
			const data = JSON.stringify({
				usage: { output_tokens: 50, cost: 0.0012 },
			});
			extractUsageFromData(data, "message_delta", state);
			expect(state.usage.providerCostUsd).toBe(0.0012);
		});

		it("leaves providerCostUsd undefined when cost is absent", () => {
			const state = { usage: { providerCostUsd: undefined } };
			const data = JSON.stringify({
				usage: { output_tokens: 50 },
			});
			extractUsageFromData(data, "message_delta", state);
			expect(state.usage.providerCostUsd).toBeUndefined();
		});

		it("leaves providerCostUsd undefined when cost is null", () => {
			const state = { usage: { providerCostUsd: undefined } };
			const data = JSON.stringify({
				usage: { output_tokens: 50, cost: null },
			});
			extractUsageFromData(data, "message_delta", state);
			expect(state.usage.providerCostUsd).toBeUndefined();
		});
	});

	// D-04: handleEnd() cost-gating — real provider cost (possibly 0) is used
	// directly; the estimate branch maps a literal-0 estimate to undefined so
	// the writer's `?? null` collapses an estimate-$0 to null (NOT a real 0).
	describe("handleEnd cost gating (estimate 0 -> undefined)", () => {
		// Mirror packages/proxy/src/post-processor.worker.ts handleEnd() gating.
		// estimateCostUSD() returns a literal 0 for unknown models (RESEARCH
		// Finding 1), so we simulate it with a function returning 0.
		async function resolveCostUsd(
			state: {
				usage: { providerCostUsd?: number; costUsd?: number };
			},
			estimateCostUSD: () => Promise<number>,
		): Promise<void> {
			if (state.usage.providerCostUsd !== undefined) {
				state.usage.costUsd = state.usage.providerCostUsd;
			} else {
				const est = await estimateCostUSD();
				state.usage.costUsd = est === 0 ? undefined : est;
			}
		}

		it("estimate-$0 for an unknown model maps to undefined, not 0", async () => {
			const state = { usage: { providerCostUsd: undefined } };
			await resolveCostUsd(state, async () => 0);
			expect(state.usage.costUsd).toBeUndefined();
		});

		it("a real providerCostUsd === 0 survives as 0", async () => {
			const state = { usage: { providerCostUsd: 0 } };
			await resolveCostUsd(state, async () => 999);
			expect(state.usage.costUsd).toBe(0);
		});

		it("a non-zero estimate is preserved", async () => {
			const state = { usage: { providerCostUsd: undefined } };
			await resolveCostUsd(state, async () => 0.0042);
			expect(state.usage.costUsd).toBe(0.0042);
		});

		it("non-OpenRouter provider (no usage.cost) runs the estimate branch", async () => {
			// No providerCostUsd was ever set -> estimate branch runs, carries no real cost.
			const state = { usage: { providerCostUsd: undefined } };
			let estimateRan = false;
			await resolveCostUsd(state, async () => {
				estimateRan = true;
				return 0.01;
			});
			expect(estimateRan).toBe(true);
			expect(state.usage.costUsd).toBe(0.01);
		});
	});
});
