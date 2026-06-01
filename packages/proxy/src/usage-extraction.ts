import type { Tiktoken } from "@dqbd/tiktoken/lite/init";

/**
 * Subset of the post-processor worker's `RequestState` that the usage-extraction
 * functions read/write. All fields are optional so the worker's `RequestState`
 * structurally satisfies this interface.
 */
export interface UsageExtractionState {
	usage: {
		model?: string;
		inputTokens?: number;
		cacheReadInputTokens?: number;
		cacheCreationInputTokens?: number;
		outputTokens?: number;
		outputTokensComputed?: number;
		totalTokens?: number;
		costUsd?: number;
		providerCostUsd?: number;
	};
	firstTokenTimestamp?: number;
	lastTokenTimestamp?: number;
	providerFinalOutputTokens?: number;
}

// Extract usage data from non-stream JSON response bodies
export function extractUsageFromJson(
	json: {
		model?: string;
		usage?: {
			input_tokens?: number;
			cache_read_input_tokens?: number;
			cache_creation_input_tokens?: number;
			output_tokens?: number;
			cost?: number; // per D-05: OpenRouter provider-returned cost
		};
	},
	state: UsageExtractionState,
): void {
	if (!json) return;

	const usageObj = json.usage;
	if (!usageObj) return;

	state.usage.model = json.model ?? state.usage.model;

	state.usage.inputTokens = usageObj.input_tokens ?? 0;
	state.usage.cacheReadInputTokens = usageObj.cache_read_input_tokens ?? 0;
	state.usage.cacheCreationInputTokens =
		usageObj.cache_creation_input_tokens ?? 0;
	state.usage.outputTokens = usageObj.output_tokens ?? 0;

	// per D-05 (COST-03): extract OpenRouter provider-returned cost with typeof guard
	if (typeof usageObj.cost === "number") {
		state.usage.providerCostUsd = usageObj.cost;
	}

	// Calculate total tokens
	const prompt =
		(state.usage.inputTokens ?? 0) +
		(state.usage.cacheReadInputTokens ?? 0) +
		(state.usage.cacheCreationInputTokens ?? 0);
	const completion = state.usage.outputTokens ?? 0;
	state.usage.totalTokens = prompt + completion;
}

export function extractUsageFromData(
	data: string,
	eventType: string,
	state: UsageExtractionState,
	tokenEncoder?: Tiktoken | null,
	log?: { debug: (message: string, data?: unknown) => void },
): void {
	try {
		const parsed = JSON.parse(data);

		// Handle message_start - check both parsed.type and eventType
		// (Some providers put type in event line, Anthropic puts it in JSON)
		const isMessageStart =
			parsed.type === "message_start" || eventType === "message_start";
		if (isMessageStart) {
			if (parsed.message?.usage) {
				const usage = parsed.message.usage;
				state.usage.inputTokens = usage.input_tokens || 0;
				state.usage.cacheReadInputTokens = usage.cache_read_input_tokens || 0;
				state.usage.cacheCreationInputTokens =
					usage.cache_creation_input_tokens || 0;
				state.usage.outputTokens = usage.output_tokens || 0;
				// WR-01: mirror the message_delta cost guard so a usage.cost delivered on
				// message_start (provider variation) is not silently dropped.
				if (typeof usage.cost === "number") {
					state.usage.providerCostUsd = usage.cost;
				}
			}
			if (parsed.message?.model) {
				state.usage.model = parsed.message.model;
			}
		}

		// Track streaming start time on first content block
		if (parsed.type === "content_block_start" && !state.firstTokenTimestamp) {
			state.firstTokenTimestamp = Date.now();
		}

		// Handle message_delta - check both parsed.type and eventType
		const isMessageDelta =
			parsed.type === "message_delta" || eventType === "message_delta";
		if (isMessageDelta) {
			state.lastTokenTimestamp = Date.now();

			if (parsed.usage) {
				// Update all token counts from message_delta (authoritative for zai)
				if (parsed.usage.output_tokens !== undefined) {
					state.providerFinalOutputTokens = parsed.usage.output_tokens;
					state.usage.outputTokens = parsed.usage.output_tokens;
				}
				if (parsed.usage.input_tokens !== undefined) {
					state.usage.inputTokens = parsed.usage.input_tokens;
				}
				if (parsed.usage.cache_read_input_tokens !== undefined) {
					state.usage.cacheReadInputTokens =
						parsed.usage.cache_read_input_tokens;
				}
				// per D-03 (COST-02): extract OpenRouter provider-returned cost with typeof guard
				if (typeof parsed.usage.cost === "number") {
					state.usage.providerCostUsd = parsed.usage.cost;
				}
				return; // No further processing needed
			}
			// Even if no usage info, we still set the timestamp for duration calculation
		}

		// Count tokens locally as fallback (but provider's count takes precedence)
		if (
			parsed.type === "content_block_delta" &&
			parsed.delta &&
			state.providerFinalOutputTokens === undefined // Avoid double counting
		) {
			let textToCount: string | undefined;

			// Extract text from different delta types
			if (parsed.delta.type === "text_delta" && parsed.delta.text) {
				textToCount = parsed.delta.text;
			} else if (
				parsed.delta.type === "thinking_delta" &&
				parsed.delta.thinking
			) {
				textToCount = parsed.delta.thinking;
			}

			if (textToCount && tokenEncoder) {
				// Count tokens using tiktoken
				try {
					const tokens = tokenEncoder.encode(textToCount);
					state.usage.outputTokensComputed =
						(state.usage.outputTokensComputed || 0) + tokens.length;
				} catch (err) {
					log?.debug("Failed to count tokens:", err);
				}
			}
		}

		// Handle any usage field in the data
		if (parsed.usage) {
			if (parsed.usage.input_tokens !== undefined) {
				state.usage.inputTokens = parsed.usage.input_tokens;
			}
			if (parsed.usage.output_tokens !== undefined) {
				state.usage.outputTokens = parsed.usage.output_tokens;
			}
			if (parsed.usage.cache_read_input_tokens !== undefined) {
				state.usage.cacheReadInputTokens = parsed.usage.cache_read_input_tokens;
			}
			if (parsed.usage.cache_creation_input_tokens !== undefined) {
				state.usage.cacheCreationInputTokens =
					parsed.usage.cache_creation_input_tokens;
			}
		}
	} catch {
		// Silent fail for non-JSON lines
	}
}
