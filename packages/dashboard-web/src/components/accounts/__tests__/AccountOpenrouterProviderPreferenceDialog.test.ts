// FORK PATCH: TDD RED gate for provider preferences dialog (PROV-04)
import { describe, expect, it } from "bun:test";
import type { Account } from "../../../api";
import {
	parseProviderOrder,
	resolveProviderPreferenceSaveAction,
	syncProviderPreferenceState,
} from "../AccountOpenrouterProviderPreferenceDialog";

// ─────────────────────────────────────────────────────────────────────────────
// parseProviderOrder
// ─────────────────────────────────────────────────────────────────────────────

describe("parseProviderOrder", () => {
	it("splits comma-separated providers into trimmed array", () => {
		expect(parseProviderOrder("anthropic/claude, openai/gpt-4o")).toEqual([
			"anthropic/claude",
			"openai/gpt-4o",
		]);
	});

	it("trims whitespace around each provider entry", () => {
		expect(parseProviderOrder("  p1 , p2  ")).toEqual(["p1", "p2"]);
	});

	it("returns empty array for empty string", () => {
		expect(parseProviderOrder("")).toEqual([]);
	});

	it("returns empty array for whitespace-only string", () => {
		expect(parseProviderOrder("   ")).toEqual([]);
	});

	it("returns single-element array for one provider", () => {
		expect(parseProviderOrder("single")).toEqual(["single"]);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveProviderPreferenceSaveAction
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveProviderPreferenceSaveAction", () => {
	it("returns 'clear' for empty parsed array", () => {
		expect(resolveProviderPreferenceSaveAction([])).toBe("clear");
	});

	it("returns 'set' for single-element array", () => {
		expect(resolveProviderPreferenceSaveAction(["p1"])).toBe("set");
	});

	it("returns 'set' for multi-element array", () => {
		expect(resolveProviderPreferenceSaveAction(["p1", "p2"])).toBe("set");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// syncProviderPreferenceState
// ─────────────────────────────────────────────────────────────────────────────

describe("syncProviderPreferenceState", () => {
	it("returns defaults when account is null", () => {
		expect(syncProviderPreferenceState(null)).toEqual({
			providerOrder: "",
			allowFallbacks: true,
		});
	});

	it("returns defaults when openrouterProviderPreference is null", () => {
		const account = {
			openrouterProviderPreference: null,
		} as unknown as Account;
		expect(syncProviderPreferenceState(account)).toEqual({
			providerOrder: "",
			allowFallbacks: true,
		});
	});

	it("populates form state from account preference with allowFallbacks true", () => {
		const account = {
			openrouterProviderPreference: {
				order: ["p1", "p2"],
				allowFallbacks: true,
			},
		} as unknown as Account;
		expect(syncProviderPreferenceState(account)).toEqual({
			providerOrder: "p1, p2",
			allowFallbacks: true,
		});
	});

	it("populates form state from account preference with allowFallbacks false", () => {
		const account = {
			openrouterProviderPreference: {
				order: ["p1"],
				allowFallbacks: false,
			},
		} as unknown as Account;
		expect(syncProviderPreferenceState(account)).toEqual({
			providerOrder: "p1",
			allowFallbacks: false,
		});
	});
});
