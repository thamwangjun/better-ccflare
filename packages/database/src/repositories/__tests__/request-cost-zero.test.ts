import { describe, expect, it } from "bun:test";
import "@better-ccflare/core";
import { RequestRepository } from "../request.repository";

// Capture every adapter.run() call so we can assert on the positional params
// the writer binds for the cost_usd column.
const createRepoCapturingRun = () => {
	const calls: Array<{ sql: string; params: unknown[] }> = [];
	const adapter = {
		run: async (sql: string, params: unknown[]) => {
			calls.push({ sql, params });
		},
		query: async () => [],
	};
	return { repo: new RequestRepository(adapter as any), calls };
};

const makeRequestData = (costUsd: number | undefined) => ({
	id: "req-1",
	method: "POST",
	path: "/v1/messages",
	accountUsed: "acc-1",
	statusCode: 200,
	success: true,
	errorMessage: null,
	responseTime: 100,
	failoverAttempts: 0,
	usage: {
		model: "z-ai/glm-4.5-air:free",
		promptTokens: 100,
		completionTokens: 50,
		totalTokens: 150,
		costUsd,
	},
});

describe("RequestRepository zero-cost persistence (D-03)", () => {
	// save(): cost_usd is the 15th positional param.
	it("save() persists a real costUsd: 0 as 0, not null", async () => {
		const { repo, calls } = createRepoCapturingRun();
		await repo.save(makeRequestData(0) as any);
		expect(calls.length).toBe(1);
		expect(calls[0].params[14]).toBe(0);
	});

	it("save() collapses costUsd: undefined to null", async () => {
		const { repo, calls } = createRepoCapturingRun();
		await repo.save(makeRequestData(undefined) as any);
		expect(calls.length).toBe(1);
		expect(calls[0].params[14]).toBe(null);
	});

	// updateUsage(): cost_usd is the 5th positional param.
	it("updateUsage() persists a real costUsd: 0 as 0, not null", async () => {
		const { repo, calls } = createRepoCapturingRun();
		await repo.updateUsage("req-1", {
			model: "z-ai/glm-4.5-air:free",
			costUsd: 0,
		});
		expect(calls.length).toBe(1);
		expect(calls[0].params[4]).toBe(0);
	});

	it("updateUsage() collapses costUsd: undefined to null", async () => {
		const { repo, calls } = createRepoCapturingRun();
		await repo.updateUsage("req-1", {
			model: "z-ai/glm-4.5-air:free",
			costUsd: undefined,
		});
		expect(calls.length).toBe(1);
		expect(calls[0].params[4]).toBe(null);
	});
});
