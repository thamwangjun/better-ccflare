// FORK PATCH: openrouter-anthropic add-account form test (MGMT-03)
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountAddForm } from "../AccountAddForm";

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
	it("renders the OpenRouter Anthropic Messages SelectItem label", () => {
		const html = renderToStaticMarkup(<AccountAddForm {...baseProps} />);
		// GREEN target (D-02): exact label string from ROADMAP SC#1
		// If Radix Select hides options in SSR, this assertion drives Plan 02
		// to ensure the value appears in static markup.
		expect(html).toContain("OpenRouter Anthropic Messages (API Key)");
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
