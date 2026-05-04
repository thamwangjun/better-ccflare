import { describe, expect, it } from "bun:test";
import type { Account } from "@better-ccflare/types";
import type { ProxyContext } from "../proxy-types";
import { getValidAccessToken } from "../token-manager";

// ctx is never accessed for API key provider early-return paths
const unusedCtx = {} as ProxyContext;

function makeAccount(overrides: Partial<Account>): Account {
	return {
		id: "test-id",
		name: "test-account",
		provider: "claude-console-api",
		api_key: null,
		refresh_token: null,
		access_token: null,
		expires_at: null,
		custom_endpoint: null,
		rate_limited_until: null,
		rate_limit_status: null,
		rate_limit_reset: null,
		rate_limit_remaining: null,
		created_at: Date.now(),
		last_used: null,
		request_count: 0,
		total_requests: 0,
		session_start: null,
		session_request_count: 0,
		paused: false,
		priority: 0,
		auto_fallback_enabled: false,
		auto_refresh_enabled: false,
		...overrides,
	};
}

describe("getValidAccessToken", () => {
	describe("claude-console-api accounts", () => {
		it("returns empty string (not the api_key) so prepareHeaders uses x-api-key header", async () => {
			const account = makeAccount({ api_key: "sk-ant-api03-test-key" });
			const token = await getValidAccessToken(account, unusedCtx);
			// Must be "" so AnthropicProvider.prepareHeaders routes to x-api-key branch,
			// not Authorization: Bearer (which Anthropic rejects for API keys)
			expect(token).toBe("");
			expect(token).not.toBe("sk-ant-api03-test-key");
		});

		it("throws when api_key is missing", async () => {
			const account = makeAccount({ api_key: null });
			await expect(getValidAccessToken(account, unusedCtx)).rejects.toThrow(
				"No API key available",
			);
		});
	});

	describe("other API key providers also return empty string", () => {
		for (const provider of [
			"openai-compatible",
			"zai",
			"anthropic-compatible",
			"minimax",
		] as const) {
			it(`${provider} returns ""`, async () => {
				const account = makeAccount({
					provider,
					api_key: "test-key",
				});
				const token = await getValidAccessToken(account, unusedCtx);
				expect(token).toBe("");
			});
		}
	});
});
