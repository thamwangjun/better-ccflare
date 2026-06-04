// FORK PATCH: openrouter-anthropic provider-preference gate test (MGMT-04)
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Account } from "../../../api";
import { AccountListItem } from "../AccountListItem";

function makeAccount(provider: string): Account {
	return {
		id: "test-id",
		name: "test-account",
		provider,
		requestCount: 0,
		totalRequests: 0,
		lastUsed: null,
		created: new Date().toISOString(),
		paused: false,
		tokenStatus: "valid",
		tokenExpiresAt: null,
		rateLimitStatus: "ok",
		rateLimitReset: null,
		rateLimitRemaining: null,
		rateLimitedUntil: null,
		rateLimitedReason: null,
		rateLimitedAt: null,
		sessionInfo: "",
		priority: 0,
		autoFallbackEnabled: false,
		autoRefreshEnabled: false,
		customEndpoint: null,
		modelMappings: null,
		usageUtilization: null,
		usageWindow: null,
		usageData: null,
		usageRateLimitedUntil: null,
		usageThrottledUntil: null,
		usageThrottledWindows: [],
		hasRefreshToken: false,
		openrouterProviderPreference: null,
	};
}

const noop = () => {};
const noopAsync = async () => {};

const baseProps = {
	isPrimary: false,
	onPauseToggle: noop,
	onForceResetRateLimit: noop,
	onRefreshUsage: noopAsync,
	onRemove: noop,
	onRename: noop,
	onPriorityChange: noop,
	onAutoFallbackToggle: noop,
	onAutoRefreshToggle: noop,
	onBillingTypeToggle: noop,
};

describe("AccountListItem provider-preference gate (MGMT-04)", () => {
	it("renders provider-preference button for openrouter-anthropic account", () => {
		const html = renderToStaticMarkup(
			<AccountListItem
				{...baseProps}
				account={makeAccount("openrouter-anthropic")}
				onProviderPreferenceChange={() => noop}
			/>,
		);
		// The button title for unconfigured preference
		expect(html).toContain("Configure OpenRouter provider preferences");
	});

	it("renders provider-preference button for openrouter account (regression guard)", () => {
		const html = renderToStaticMarkup(
			<AccountListItem
				{...baseProps}
				account={makeAccount("openrouter")}
				onProviderPreferenceChange={() => noop}
			/>,
		);
		expect(html).toContain("Configure OpenRouter provider preferences");
	});

	it("does NOT render provider-preference button for anthropic account", () => {
		const html = renderToStaticMarkup(
			<AccountListItem
				{...baseProps}
				account={makeAccount("anthropic")}
				onProviderPreferenceChange={() => noop}
			/>,
		);
		expect(html).not.toContain("Configure OpenRouter provider preferences");
	});
});
