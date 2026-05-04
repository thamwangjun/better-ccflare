import { Logger } from "@better-ccflare/logger";
import type { Account } from "@better-ccflare/types";
import { AnthropicCompatibleProvider } from "../anthropic-compatible/provider";

const OPENROUTER_DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1";

const log = new Logger("OpenRouterProvider");

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

	override async transformRequestBody(
		request: Request,
		account?: Account,
	): Promise<Request> {
		// First apply model mapping from parent
		const mapped = await super.transformRequestBody(request, account);

		try {
			const body = await mapped.clone().json();
			if (body && typeof body === "object") {
				// Breakpoint 1: last tool in tools[] (most stable — invalidates everything below)
				if (Array.isArray(body.tools) && body.tools.length > 0) {
					const lastTool = body.tools[body.tools.length - 1];
					if (lastTool && typeof lastTool === "object") {
						(lastTool as any).cache_control = { type: "ephemeral" };
					}
				}

				// Breakpoint 2: last content block in system (or convert string to array)
				if (typeof body.system === "string" && body.system.length > 0) {
					body.system = [
						{
							type: "text",
							text: body.system,
							cache_control: { type: "ephemeral" },
						},
					];
				} else if (Array.isArray(body.system) && body.system.length > 0) {
					const lastBlock = body.system[body.system.length - 1];
					if (lastBlock && typeof lastBlock === "object") {
						(lastBlock as any).cache_control = { type: "ephemeral" };
					}
				}

				// Breakpoint 3: last content block of last assistant turn in messages[]
				// Enables conversation history caching for agentic/Claude Code sessions
				if (Array.isArray(body.messages)) {
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
								(lastBlock as any).cache_control = { type: "ephemeral" };
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
						}
					}
				}

				log.debug("Injected cache_control breakpoints into OpenRouter request");
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

			return {
				model: json.model,
				promptTokens,
				completionTokens,
				totalTokens,
				cacheCreationInputTokens,
				cacheReadInputTokens,
			};
		} catch {
			return null;
		}
	}
}
