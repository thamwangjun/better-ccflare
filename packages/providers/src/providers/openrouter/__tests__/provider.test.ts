import { describe, expect, it } from "bun:test";
import { OpenRouterProvider } from "../provider";

describe("OpenRouterProvider.transformRequestBody", () => {
	it("injects cache_control into the request body", async () => {
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

		expect(result.cache_control).toEqual({ type: "ephemeral" });
	});

	it("preserves existing body fields", async () => {
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
		expect(result.cache_control).toEqual({ type: "ephemeral" });
	});
});
