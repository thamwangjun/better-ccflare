import { BUFFER_SIZES } from "@better-ccflare/core";
import { Logger } from "@better-ccflare/logger";
import type { Account } from "@better-ccflare/types";
import { AnthropicCompatibleProvider } from "../anthropic-compatible/provider";

const OPENROUTER_ANTHROPIC_DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1";

const log = new Logger("OpenRouterAnthropicProvider");

export class OpenRouterAnthropicProvider extends AnthropicCompatibleProvider {
	constructor() {
		super({
			name: "openrouter-anthropic",
			baseUrl: OPENROUTER_ANTHROPIC_DEFAULT_ENDPOINT,
			authHeader: "authorization",
			authType: "bearer",
			supportsStreaming: true,
		});
	}

	/**
	 * Build the target URL for the OpenRouter native /api/v1 endpoint.
	 * Strips the leading /v1 prefix from the pathname to avoid a
	 * double-segment (/api/v1/v1/messages → 404). The base class deduplication
	 * only fires when pathname.startsWith("/api/v1") — the CC path /v1/messages
	 * does not match that prefix, so we override here. (PROV-01 / D-00b)
	 */
	override buildUrl(
		pathname: string,
		search: string,
		account?: Account,
	): string {
		const baseUrl = (
			account?.custom_endpoint || OPENROUTER_ANTHROPIC_DEFAULT_ENDPOINT
		).replace(/\/$/, "");
		// Strip /v1 prefix since baseUrl already contains /api/v1
		const cleanPathname = pathname.startsWith("/v1")
			? pathname.slice(3)
			: pathname;
		return `${baseUrl}${cleanPathname}${search}`;
	}

	// FORK PATCH: 3 new body injections (provider preference, session_id, usage:{include:true}).
	// NO cache_control injection — native passthrough; Claude Code sends its own blocks.
	// (CACHE-01 / PROV-02 / D-00c)
	override async transformRequestBody(
		request: Request,
		account?: Account,
	): Promise<Request> {
		// 1. Model mapping from parent (upstream behaviour preserved)
		const mapped = await super.transformRequestBody(request, account);

		try {
			const body = await mapped.clone().json();
			if (body && typeof body === "object") {
				// FORK PATCH: NO cache_control injection — native passthrough;
				//   Claude Code sends its own blocks. (CACHE-01 / D-00c)

				// FORK PATCH: provider-preference injection (ROUTE-01 / D-00e)
				// Inject body.provider from account.openrouter_provider_preference only
				// when the client body does not already have a provider field.
				// Use !("provider" in body) not !body.provider — {} is a valid provider field.
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

				// FORK PATCH: session_id injection — stable per-account SHA-256 hash (ROUTE-02 / D-01, D-02)
				// Routes all turns of any CC session on this account to the same OpenRouter backend,
				// maximising prompt-cache hit rate from request 1. Deterministic + one-way (T-9-03).
				if (account?.id && !("session_id" in body)) {
					const encoder = new TextEncoder();
					const hashBuffer = await crypto.subtle.digest(
						"SHA-256",
						encoder.encode(account.id),
					);
					const hex = Array.from(new Uint8Array(hashBuffer))
						.map((b) => b.toString(16).padStart(2, "0"))
						.join("");
					body.session_id = hex.slice(0, 32);
				}

				// FORK PATCH: usage:{include:true} guarantees cost appears in OpenRouter response (D-03)
				// Inject only when the client has not already supplied a usage field.
				if (!("usage" in body)) {
					body.usage = { include: true };
				}

				return new Request(mapped.url, {
					method: mapped.method,
					headers: mapped.headers,
					body: JSON.stringify(body),
				});
			}
		} catch (error) {
			log.debug("Failed to inject request fields:", error);
		}

		return mapped;
	}

	// FORK PATCH: call super for Anthropic-native cache fields; attach OpenRouter real cost.
	// Do NOT copy OpenRouterProvider.extractUsageInfo — it reads OAI-format
	// prompt_tokens_details.cache_write_tokens / cached_tokens which are absent on the
	// native /api/v1/messages endpoint. The base class reads cache_creation_input_tokens
	// / cache_read_input_tokens (Anthropic-native) correctly. (COST-01 / D-00d)
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
			const contentType = response.headers.get("content-type");

			// Streaming: base delegates to extractStreamingUsage (our override below)
			if (
				this.config.supportsStreaming &&
				contentType?.includes("text/event-stream")
			) {
				return super.extractUsageInfo(response);
			}

			// Non-streaming: super reads Anthropic-native cache field names correctly.
			const base = await super.extractUsageInfo(response.clone());
			if (!base) return null;

			// Attach real cost — read usage.cost from a fresh clone.
			const json = await response.clone().json();
			// FORK PATCH: typeof guard rejects non-numeric cost (T-9-01); undefined drops
			// the base estimate (D-00d) — OpenRouter real cost is authoritative for this provider.
			const costUsd =
				json?.usage && typeof json.usage.cost === "number"
					? json.usage.cost
					: undefined;

			return { ...base, costUsd };
		} catch {
			return null;
		}
	}

	/**
	 * Public parseUsage routes the streaming branch to real-cost extraction.
	 * Delegates streaming to extractStreamingUsage (which reads usage.cost from
	 * the final SSE message_delta) and non-streaming to extractUsageInfo.
	 * (COST-02 / D-00d)
	 */
	async parseUsage(response: Response): Promise<{
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
		const contentType = response.headers.get("content-type");

		// Streaming path: delegate to extractStreamingUsage for the real usage.cost.
		// Pass a clone since extractStreamingUsage consumes the body reader.
		if (
			this.config.supportsStreaming &&
			contentType?.includes("text/event-stream")
		) {
			return this.extractStreamingUsage(response.clone(), response.headers);
		}

		// Non-streaming path: delegate to extractUsageInfo unchanged.
		return this.extractUsageInfo(response);
	}

	// FORK PATCH: streaming override reads usage.cost from final SSE message_delta (COST-02 / D-00d)
	// Ported from OpenRouterProvider.extractStreamingUsage — NOT inherited (extending
	// OpenRouterProvider would drag in the 4-breakpoint cache_control injector and the
	// OAI-format extractUsageInfo override).
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
		// Clone BEFORE delegating: super consumes the body reader (single-use body). (Pitfall 3)
		const costClone = clone.clone();

		const base = await super.extractStreamingUsage(clone, originalHeaders);
		if (!base) return base;

		try {
			const realCost = await this.readFinalSseCost(costClone);
			// typeof guard rejects string/non-numeric values (T-9-01 tampering mitigation).
			// A real $0 from a :free model is a valid number and overwrites the estimate.
			if (typeof realCost === "number") {
				return { ...base, costUsd: realCost };
			}
			// No real provider cost: OpenRouter cost is authoritative for this provider;
			// do not surface the base estimate as costUsd (COST-02 / D-00d: no estimate fallback).
			log.warn(
				`Streaming OpenRouter-Anthropic response yielded no usage.cost; recording no provider cost (model=${base.model ?? "unknown"})`,
			);
			return { ...base, costUsd: undefined };
		} catch {
			// On parse/read failure, fall back to the base result unchanged.
			return base;
		}
	}

	// Read usage.cost from the final SSE message_delta event. Returns the raw value
	// (caller applies the typeof guard) or undefined when absent.
	// Ported verbatim from OpenRouterProvider.readFinalSseCost. (COST-02 / D-00d)
	private async readFinalSseCost(clone: Response): Promise<unknown> {
		const reader = clone.body?.getReader();
		if (!reader) return undefined;

		const maxBytes = BUFFER_SIZES.ANTHROPIC_STREAM_CAP_BYTES;
		const decoder = new TextDecoder();
		let buffered = "";
		let lastCost: unknown;

		try {
			// CR-01: OpenRouter's usage.cost arrives in the FINAL message_delta at the
			// END of the stream. Capping reads at maxBytes from the START would drop the
			// cost for any stream >32KB (routine for agentic sessions). Instead, read the
			// whole body but retain only a sliding TAIL window so the final event is never
			// lost while still bounding memory.
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffered += decoder.decode(value, { stream: true });
				if (buffered.length > maxBytes) {
					buffered = buffered.slice(-maxBytes);
				}
			}
			// WR-03: flush any buffered multi-byte UTF-8 sequence so a final chunk that
			// ends mid-character (e.g. inside usage.cost) is not truncated.
			buffered += decoder.decode();
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
