import { describe, expect, it } from "bun:test";
import { extractUsageFromJson, resolveCostUsd } from "../usage-extraction";

describe("extractUsageFromJson", () => {
	// COST-03: non-streaming JSON body cost extraction (per D-05)
	it("extracts providerCostUsd when cost is present", () => {
		const state = { usage: { providerCostUsd: undefined } };
		extractUsageFromJson(
			{
				model: "test-model",
				usage: { input_tokens: 100, output_tokens: 50, cost: 0.0012 },
			},
			state,
		);
		expect(state.usage.providerCostUsd).toBe(0.0012);
	});

	it("leaves providerCostUsd undefined when cost is absent", () => {
		const state = { usage: { providerCostUsd: undefined } };
		extractUsageFromJson(
			{ model: "test-model", usage: { input_tokens: 100, output_tokens: 50 } },
			state,
		);
		expect(state.usage.providerCostUsd).toBeUndefined();
	});

	it("returns early when usage field is absent", () => {
		const state = { usage: { providerCostUsd: undefined } };
		extractUsageFromJson({ model: "test-model" }, state);
		expect(state.usage.providerCostUsd).toBeUndefined();
		expect(state.usage.totalTokens).toBeUndefined();
	});

	it("extracts providerCostUsd = 0 when cost is zero", () => {
		const state = { usage: { providerCostUsd: undefined } };
		extractUsageFromJson(
			{ model: "test-model", usage: { input_tokens: 100, cost: 0 } },
			state,
		);
		expect(state.usage.providerCostUsd).toBe(0);
	});

	// D-04: gating pattern — providerCostUsd feeds costUsd when set
	it("providerCostUsd is accessible from state.usage and feeds costUsd when set", () => {
		const state: {
			usage: { providerCostUsd?: number; costUsd?: number };
		} = { usage: { providerCostUsd: undefined } };
		extractUsageFromJson(
			{
				model: "test-model",
				usage: { input_tokens: 100, output_tokens: 50, cost: 0.0012 },
			},
			state,
		);
		expect(state.usage.providerCostUsd).toBe(0.0012);
		// Mirror handleEnd() gating (D-04): use provider cost when set
		if (state.usage.providerCostUsd !== undefined) {
			state.usage.costUsd = state.usage.providerCostUsd;
		}
		expect(state.usage.costUsd).toBe(0.0012);
	});

	// D-04: handleEnd() estimate-branch guard — estimate-$0 for an unknown model
	// maps to undefined (so the writer's `?? null` collapses it to null), while a
	// real providerCostUsd === 0 survives as 0.
	describe("handleEnd estimate 0 -> undefined guard", () => {
		// Exercises the real resolveCostUsd shared with the worker's handleEnd().
		it("estimate-$0 for unknown model -> costUsd undefined, not 0", async () => {
			const state = { usage: { providerCostUsd: undefined } };
			await resolveCostUsd(state, async () => 0);
			expect(state.usage.costUsd).toBeUndefined();
		});

		it("real providerCostUsd === 0 -> costUsd survives as 0", async () => {
			const state = { usage: { providerCostUsd: 0 } };
			await resolveCostUsd(state, async () => 999);
			expect(state.usage.costUsd).toBe(0);
		});

		it("non-OpenRouter estimate branch still runs with no real cost", async () => {
			const state = { usage: { providerCostUsd: undefined } };
			let ran = false;
			await resolveCostUsd(state, async () => {
				ran = true;
				return 0.02;
			});
			expect(ran).toBe(true);
			expect(state.usage.costUsd).toBe(0.02);
		});
	});
});
