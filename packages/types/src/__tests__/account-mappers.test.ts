/**
 * Tests for toAccount() and toAccountResponse() — openrouter_provider_preference mapping (PROV-02).
 *
 * Verifies that:
 *  - toAccount() maps openrouter_provider_preference JSON string from AccountRow to Account
 *  - toAccount() maps undefined (old row without column) to null
 *  - toAccountResponse() parses a valid JSON array string to string[]
 *  - toAccountResponse() returns null when openrouter_provider_preference is null
 *  - toAccountResponse() returns null on invalid JSON (try/catch guard)
 *
 * These tests go RED before Plan 02 adds openrouter_provider_preference to AccountRow,
 * Account, and AccountResponse types — and before toAccount()/toAccountResponse()
 * include the mapping logic.
 * // FORK PATCH: PROV-02 — toAccount/toAccountResponse type mapper test scaffold
 */
import { describe, expect, it } from "bun:test";
// Force @better-ccflare/core to initialise before @better-ccflare/types resolves its
// circular dependency (types/agent.ts → core → core/strategy.ts → types/StrategyName).
import "@better-ccflare/core";
import {
	type Account,
	type AccountRow,
	toAccount,
	toAccountResponse,
} from "../account";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<AccountRow> = {}): AccountRow {
	return {
		id: "test-id",
		name: "test",
		provider: "openrouter",
		api_key: null,
		refresh_token: "",
		access_token: null,
		expires_at: null,
		created_at: Date.now(),
		last_used: null,
		request_count: 0,
		total_requests: 0,
		...overrides,
	} as AccountRow;
}

function makeAccount(overrides: Partial<Account> = {}): Account {
	return {
		id: "test-id",
		name: "test",
		provider: "openrouter",
		api_key: null,
		refresh_token: "",
		access_token: null,
		expires_at: null,
		created_at: Date.now(),
		last_used: null,
		request_count: 0,
		total_requests: 0,
		rate_limited_until: null,
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
		openrouter_provider_preference: null, // will be typed as string | null after Plan 02
		...overrides,
	} as Account;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("toAccount() — openrouter_provider_preference mapping", () => {
	it("maps the JSON string from AccountRow to Account", () => {
		const row = makeRow({
			openrouter_provider_preference: '["openai","anthropic"]',
		});
		const account = toAccount(row);
		expect(account.openrouter_provider_preference).toBe(
			'["openai","anthropic"]',
		);
	});

	it("maps undefined (old row) to null", () => {
		const row = makeRow({ openrouter_provider_preference: undefined });
		const account = toAccount(row);
		expect(account.openrouter_provider_preference).toBeNull();
	});
});

describe("toAccountResponse() — openrouterProviderPreference parsing", () => {
	it("parses a valid structured JSON object { order, allow_fallbacks } to { order, allowFallbacks }", () => {
		const account = makeAccount({
			openrouter_provider_preference:
				'{"order":["openai","anthropic"],"allow_fallbacks":true}',
		});
		const response = toAccountResponse(account);
		expect(response.openrouterProviderPreference).toEqual({
			order: ["openai", "anthropic"],
			allowFallbacks: true,
		});
	});

	it("defaults allowFallbacks to true when allow_fallbacks is absent", () => {
		const account = makeAccount({
			openrouter_provider_preference: '{"order":["openai"]}',
		});
		const response = toAccountResponse(account);
		expect(response.openrouterProviderPreference).toEqual({
			order: ["openai"],
			allowFallbacks: true,
		});
	});

	it("returns null for a bare JSON array (old format without .order property)", () => {
		const account = makeAccount({
			openrouter_provider_preference: '["openai","anthropic"]',
		});
		const response = toAccountResponse(account);
		expect(response.openrouterProviderPreference).toBeNull();
	});

	it("returns null when openrouter_provider_preference is null", () => {
		const account = makeAccount({ openrouter_provider_preference: null });
		const response = toAccountResponse(account);
		expect(response.openrouterProviderPreference).toBeNull();
	});

	it("returns null when the JSON string is invalid (try/catch guard)", () => {
		const account = makeAccount({
			openrouter_provider_preference: "not-valid-json{",
		});
		const response = toAccountResponse(account);
		expect(response.openrouterProviderPreference).toBeNull();
	});
});
