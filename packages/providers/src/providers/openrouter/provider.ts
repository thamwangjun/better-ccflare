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
			authHeader: "Authorization",
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
		return `${baseUrl}${pathname}${search}`;
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
				body.cache_control = { type: "ephemeral" };
				log.debug("Injected cache_control into OpenRouter request");
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
}
