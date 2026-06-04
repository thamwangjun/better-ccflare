// FORK PATCH: openrouter-anthropic add-account form test (MGMT-03)

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountAddForm } from "../AccountAddForm";

// Radix Select renders SelectItem labels through a Portal that only mounts when
// the dropdown is open and a DOM is present — neither holds under
// renderToStaticMarkup (SSR: no effects, no document). The dashboard has no
// client-DOM test harness (no happy-dom/testing-library), so the dropdown-item
// label is unobservable via render. SC#1 cares about the exact label text
// (casing + "(API Key)"), so we guard it deterministically against the source.
// Whitespace-normalized so the source-content guard survives Biome's JSX
// line-wrapping (it may split `<SelectItem>...</SelectItem>` across lines).
const ACCOUNT_ADD_FORM_SRC = readFileSync(
	join(import.meta.dir, "..", "AccountAddForm.tsx"),
	"utf8",
).replace(/\s+/g, " ");

const noopAsync = async () => {};
const noopOAuth = async () => ({ authUrl: "", sessionId: "" });

// Minimal props satisfying all required callbacks.
// `onAddOpenRouterAnthropicAccount` does not exist on the component yet —
// this prop drives Plan 02 to add the SelectItem and form block (MGMT-03 GREEN target).
const baseProps = {
	onAddAccount: noopOAuth,
	onCompleteAccount: noopAsync,
	onAddZaiAccount: noopAsync,
	onAddMinimaxAccount: noopAsync,
	onAddAnthropicCompatibleAccount: noopAsync,
	onAddNanoGPTAccount: noopAsync,
	onAddOpenAIAccount: noopAsync,
	onAddVertexAIAccount: noopAsync,
	onAddBedrockAccount: noopAsync,
	onAddAlibabaCodingPlanAccount: noopAsync,
	onAddKiloAccount: noopAsync,
	onAddOpenRouterAccount: noopAsync,
	// FORK PATCH: new prop for openrouter-anthropic (MGMT-03) — does not exist yet (RED)
	onAddOpenRouterAnthropicAccount: noopAsync,
	onAddOllamaAccount: noopAsync,
	onAddOllamaCloudAccount: noopAsync,
	onCancel: () => {},
	onSuccess: () => {},
	onError: (_: string) => {},
} as Parameters<typeof AccountAddForm>[0];

describe("AccountAddForm openrouter-anthropic (MGMT-03)", () => {
	it("mounts the Mode selector when rendered (render smoke test)", () => {
		// SSR-verifiable: the form renders without throwing and emits the Mode
		// Select trigger. Radix dropdown items are not in SSR markup (see note
		// above), so the option-label contract is asserted against source below.
		const html = renderToStaticMarkup(<AccountAddForm {...baseProps} />);
		expect(html).toContain('id="mode"');
		expect(html).toContain("Add New Account");
	});

	it("wires the openrouter-anthropic SelectItem with the exact SC#1 label", () => {
		// GREEN target (D-02): exact label string from ROADMAP SC#1. Deterministic
		// source guard against label drift (casing + "(API Key)") since Radix
		// Select items cannot be observed via renderToStaticMarkup.
		expect(ACCOUNT_ADD_FORM_SRC).toContain(
			'<SelectItem value="openrouter-anthropic"> OpenRouter Anthropic Messages (API Key) </SelectItem>',
		);
	});

	it("does NOT render the openrouter-anthropic form block by default (mode-conditional guard)", () => {
		// The form block for openrouter-anthropic mode renders only when
		// newAccount.mode === "openrouter-anthropic" (state-controlled).
		// In SSR default state (no mode selected), the block must be absent.
		// D-03 endpoint hint: "https://openrouter.ai/api/v1 (native Anthropic Messages)"
		// Plan 02 adds the form block; this test guards against accidental default render.
		const html = renderToStaticMarkup(<AccountAddForm {...baseProps} />);
		expect(html).not.toContain(
			"https://openrouter.ai/api/v1 (native Anthropic Messages)",
		);
	});
});
