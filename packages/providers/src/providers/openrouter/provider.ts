import { BUFFER_SIZES } from "@better-ccflare/core";
import { Logger } from "@better-ccflare/logger";
import type { Account } from "@better-ccflare/types";
import { AnthropicCompatibleProvider } from "../anthropic-compatible/provider";

const OPENROUTER_DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1";

const log = new Logger("OpenRouterProvider");

// FORK PATCH: pre-count existing cache_control blocks across all injection sites (D-05)
function countExistingCacheControlBlocks(body: any): number {
	let count = 0;
	if (Array.isArray(body.tools)) {
		for (const tool of body.tools) {
			if (tool && typeof tool === "object" && tool.cache_control) count++;
		}
	}
	if (Array.isArray(body.system)) {
		for (const block of body.system) {
			if (block && typeof block === "object" && block.cache_control) count++;
		}
	} else if (
		body.system &&
		typeof body.system === "object" &&
		(body.system as any).cache_control
	) {
		count++;
	}
	if (Array.isArray(body.messages)) {
		for (const msg of body.messages) {
			if (Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block && typeof block === "object" && block.cache_control)
						count++;
				}
			}
		}
	}
	return count;
}

export class OpenRouterProvider extends AnthropicCompatibleProvider {
	constructor() {
		super({
			name: "openrouter",
			baseUrl: OPENROUTER_DEFAULT_ENDPOINT,
			authHeader: "authorization",
			authType: "bearer",
			supportsStreaming: true,
		});
	}

	override getEndpoint(): string {
		return OPENROUTER_DEFAULT_ENDPOINT;
	}

	override buildUrl(
		pathname: string,
		search: string,
		account?: Account,
	): string {
		const baseUrl = (
			account?.custom_endpoint || OPENROUTER_DEFAULT_ENDPOINT
		).replace(/\/$/, "");
		// Strip /v1 prefix since baseUrl already contains /api/v1
		const cleanPathname = pathname.startsWith("/v1")
			? pathname.slice(3)
			: pathname;
		return `${baseUrl}${cleanPathname}${search}`;
	}

	// FORK PATCH: 4-breakpoint cache_control injection with count guard (tools, system, last assistant turn, last user message)
	override async transformRequestBody(
		request: Request,
		account?: Account,
	): Promise<Request> {
		// First apply model mapping from parent
		const mapped = await super.transformRequestBody(request, account);

		try {
			const body = await mapped.clone().json();
			if (body && typeof body === "object") {
				// FORK PATCH: pre-count existing cache_control blocks (D-05)
				let remaining = Math.max(0, 4 - countExistingCacheControlBlocks(body));

				// Breakpoint 1: last tool in tools[] (most stable — invalidates everything below)
				if (
					remaining > 0 &&
					Array.isArray(body.tools) &&
					body.tools.length > 0
				) {
					const lastTool = body.tools[body.tools.length - 1];
					if (lastTool && typeof lastTool === "object") {
						if (!(lastTool as any).cache_control) {
							(lastTool as any).cache_control = { type: "ephemeral" };
							remaining--;
						}
					}
				}

				// Breakpoint 2: last content block in system (or convert string to array)
				if (remaining > 0) {
					if (typeof body.system === "string" && body.system.length > 0) {
						body.system = [
							{
								type: "text",
								text: body.system,
								cache_control: { type: "ephemeral" },
							},
						];
						remaining--;
					} else if (Array.isArray(body.system) && body.system.length > 0) {
						const lastBlock = body.system[body.system.length - 1];
						if (lastBlock && typeof lastBlock === "object") {
							if (!(lastBlock as any).cache_control) {
								(lastBlock as any).cache_control = { type: "ephemeral" };
								remaining--;
							}
						}
					}
				}

				// Breakpoint 3: last content block of last assistant turn in messages[]
				// Enables conversation history caching for agentic/Claude Code sessions
				if (remaining > 0 && Array.isArray(body.messages)) {
					const lastAssistant = [...body.messages]
						.reverse()
						.find((m: any) => m.role === "assistant");
					if (lastAssistant) {
						if (
							Array.isArray(lastAssistant.content) &&
							lastAssistant.content.length > 0
						) {
							const lastBlock =
								lastAssistant.content[lastAssistant.content.length - 1];
							if (lastBlock && typeof lastBlock === "object") {
								if (!(lastBlock as any).cache_control) {
									(lastBlock as any).cache_control = { type: "ephemeral" };
									remaining--;
								}
							}
						} else if (
							typeof lastAssistant.content === "string" &&
							lastAssistant.content.length > 0
						) {
							lastAssistant.content = [
								{
									type: "text",
									text: lastAssistant.content,
									cache_control: { type: "ephemeral" },
								},
							];
							remaining--;
						}
					}
				}

				// FORK PATCH: Breakpoint 4 — last user message (D-03, D-04)
				if (remaining > 0 && Array.isArray(body.messages)) {
					const lastUser = [...body.messages]
						.reverse()
						.find((m: any) => m.role === "user");
					if (lastUser) {
						if (
							Array.isArray(lastUser.content) &&
							lastUser.content.length > 0
						) {
							const lastBlock = lastUser.content[lastUser.content.length - 1];
							if (lastBlock && typeof lastBlock === "object") {
								if (!(lastBlock as any).cache_control) {
									(lastBlock as any).cache_control = { type: "ephemeral" };
									remaining--;
								}
							}
						} else if (
							typeof lastUser.content === "string" &&
							lastUser.content.length > 0
						) {
							lastUser.content = [
								{
									type: "text",
									text: lastUser.content,
									cache_control: { type: "ephemeral" },
								},
							];
							remaining--;
						}
					}
				}

				log.debug("Injected cache_control breakpoints into OpenRouter request");

				// FORK PATCH: inject provider preference from account settings (PROV-01)
				if (account?.openrouter_provider_preference && !("provider" in body)) {
					try {
						const pref = JSON.parse(account.openrouter_provider_preference);
						if (Array.isArray(pref.order) && pref.order.length > 0) {
							body.provider = {
								order: pref.order,
								allow_fallbacks: pref.allow_fallbacks ?? true,
							};
						}
					} catch {
						log.warn(
							"Failed to parse openrouter_provider_preference; skipping provider injection",
						);
					}
				}

				return new Request(mapped.url, {
					method: mapped.method,
					headers: mapped.headers,
					body: JSON.stringify(body),
				});
			}
		} catch (error) {
			log.debug("Failed to inject cache_control:", error);
		}

		return mapped;
	}

	// FORK PATCH: extractUsageInfo reads OpenRouter prompt_tokens_details format (CACHE-01)
	// CACHE-01: Override extractUsageInfo to read OpenRouter's prompt_tokens_details format.
	// BaseAnthropicCompatibleProvider.extractUsageInfo() reads cache_creation_input_tokens
	// (Anthropic-native field), which OpenRouter does not return. OpenRouter non-streaming
	// responses use usage.prompt_tokens_details.cache_write_tokens instead.
	override async extractUsageInfo(response: Response): Promise<{
		model?: string;
		promptTokens?: number;
		completionTokens?: number;
		totalTokens?: number;
		costUsd?: number;
		inputTokens?: number;
		cacheReadInputTokens?: number;
		cacheCreationInputTokens?: number;
		outputTokens?: number;
	} | null> {
		try {
			const clone = response.clone();
			const contentType = response.headers.get("content-type");

			// Delegate streaming path to parent (streaming usage extraction is unchanged)
			if (
				this.config.supportsStreaming &&
				contentType?.includes("text/event-stream")
			) {
				return super.extractUsageInfo(response);
			}

			// Non-streaming: parse OpenRouter response format
			const json = await clone.json();

			if (!json.usage) return null;

			const promptTokensDetails = json.usage.prompt_tokens_details as
				| {
						cache_write_tokens?: number;
						cached_tokens?: number;
				  }
				| undefined;

			const cacheCreationInputTokens =
				promptTokensDetails?.cache_write_tokens || 0;
			const cacheReadInputTokens = promptTokensDetails?.cached_tokens || 0;

			const promptTokens = json.usage.prompt_tokens || 0;
			const completionTokens = json.usage.completion_tokens || 0;
			const totalTokens =
				json.usage.total_tokens || promptTokens + completionTokens;

			// COST-01: OpenRouter returns actual USD cost in usage.cost (Optional + Nullable).
			// typeof guard rejects string/non-numeric values (T-7-01 tampering mitigation).
			const costUsd =
				typeof json.usage.cost === "number" ? json.usage.cost : undefined;

			return {
				model: json.model,
				promptTokens,
				completionTokens,
				totalTokens,
				cacheCreationInputTokens,
				cacheReadInputTokens,
				costUsd, // per D-01: provider-returned cost from OpenRouter
			};
		} catch {
			return null;
		}
	}

	// COST-04 (D-01): override the streaming usage path so the live response-processor
	// returns OpenRouter's real usage.cost (from the final SSE message_delta) instead of
	// the base class's estimate. The base's local SSE types omit `cost`, so we read it
	// from an independent clone here.
	protected override async extractStreamingUsage(
		clone: Response,
		originalHeaders: Headers,
	): Promise<{
		model?: string;
		promptTokens?: number;
		completionTokens?: number;
		totalTokens?: number;
		costUsd?: number;
		inputTokens?: number;
		cacheReadInputTokens?: number;
		cacheCreationInputTokens?: number;
		outputTokens?: number;
	} | null> {
		// Clone BEFORE delegating: super consumes the body reader (single-use body).
		const costClone = clone.clone();

		const base = await super.extractStreamingUsage(clone, originalHeaders);
		if (!base) return base;

		try {
			const realCost = await this.readFinalSseCost(costClone);
			// typeof guard rejects string/non-numeric values (T-7-01 tampering mitigation).
			// A real $0 from a :free model is a valid number and overwrites the estimate.
			if (typeof realCost === "number") {
				return { ...base, costUsd: realCost };
			}
			// No real provider cost present: OpenRouter cost is authoritative for this
			// provider, so do not surface the base estimate as costUsd (leave undefined).
			return { ...base, costUsd: undefined };
		} catch {
			// On parse/read failure, fall back to the base result unchanged.
			return base;
		}
	}

	// Read usage.cost from the final SSE message_delta event. Returns the raw value
	// (caller applies the typeof guard) or undefined when absent.
	private async readFinalSseCost(clone: Response): Promise<unknown> {
		const reader = clone.body?.getReader();
		if (!reader) return undefined;

		const maxBytes = BUFFER_SIZES.ANTHROPIC_STREAM_CAP_BYTES;
		const decoder = new TextDecoder();
		let buffered = "";
		let lastCost: unknown;

		try {
			while (buffered.length < maxBytes) {
				const { value, done } = await reader.read();
				if (done) break;
				buffered += decoder.decode(value, { stream: true });
			}
		} finally {
			reader.cancel().catch(() => {});
		}

		const lines = buffered.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			if (
				line.startsWith("event: message_delta") ||
				line.startsWith("event:message_delta")
			) {
				for (let j = i + 1; j < lines.length; j++) {
					const nextLine = lines[j].trim();
					if (nextLine.startsWith("data:")) {
						const jsonStr = nextLine.startsWith("data: ")
							? nextLine.slice(6)
							: nextLine.slice(5);
						try {
							const data = JSON.parse(jsonStr) as {
								usage?: { cost?: unknown };
							};
							if (data.usage && "cost" in data.usage) {
								lastCost = data.usage.cost;
							}
						} catch {
							// Ignore parse errors for this event.
						}
						break;
					} else if (nextLine && !nextLine.startsWith("event:")) {
						break;
					}
				}
			}
		}

		return lastCost;
	}
}
