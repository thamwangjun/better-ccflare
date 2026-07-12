/**
 * Post-processor Bun Worker — hosts usage-collector logic off the main thread.
 *
 * This worker owns its own DatabaseOperations + AsyncDbWriter + initPayloadEncryption
 * (Bun workers have isolated module scope; main-thread init does NOT propagate).
 *
 * Protocol (main → worker):
 *   start        — StartMessage (envelope; worker acks with AckMessage)
 *   chunk        — ChunkMessage (transferable ArrayBuffer; see TRANSFER CONTRACT below)
 *   end          — EndMessage
 *   config-update — ConfigUpdateMessage (storePayloads boolean)
 *   shutdown     — ControlMessage (worker drains then replies shutdown-complete)
 *
 * Protocol (worker → main):
 *   ready           — worker initialized and accepting messages
 *   ack             — acknowledgement for a StartMessage envelope
 *   summary         — SummaryMessage (RequestResponse) after handleEnd completes
 *   shutdown-complete — worker fully drained; safe to terminate
 *
 * TRANSFER CONTRACT for ChunkMessage:
 *   The producer (response-handler.ts) calls value.slice() to get a standalone copy,
 *   then sends { type: "chunk", requestId, data: copy.buffer } with [copy.buffer] in
 *   the transfer list. The buffer is moved (zero-copy) to this worker; the original
 *   client buffer is never detached. Here we reconstruct via new Uint8Array(msg.data).
 *
 * NO tiktoken: this worker does not import @dqbd/tiktoken. Token counts come from the
 * provider's authoritative SSE/JSON usage fields only.
 *
 * Post-#245 hardening preserved:
 *   61f4007a — reset currentEvent after SSE buffer truncation (processStreamChunk)
 *   eb9817a6 — then/catch (not finally) for pendingHandleEnds cleanup
 *   921062eb — log handleEnd rejections instead of swallowing
 *   16748635 — flush AsyncDbWriter in drain()
 *   ba89fe28 — Promise.allSettled in drain() (no abandoned writes on shutdown)
 *   be598d89 — providerCostUsd field on RequestState (fork merge)
 *   #245 body — cacheCreationInputTokens → SummaryMessage.summary field
 */

declare var self: Worker;

import {
	BUFFER_SIZES,
	estimateCostUSD,
	TIME_CONSTANTS,
} from "@better-ccflare/core";
import {
	AsyncDbWriter,
	DatabaseOperations,
	initPayloadEncryption,
} from "@better-ccflare/database";
import { Logger } from "@better-ccflare/logger";
import { NO_ACCOUNT_ID, type RequestResponse } from "@better-ccflare/types";
import { formatCost } from "@better-ccflare/ui-common";
import { combineChunks } from "./stream-tee";
import {
	extractUsageFromData,
	extractUsageFromJson,
	parseSSELine,
	resolveCostUsd,
} from "./usage-extraction";
import type {
	AckMessage,
	ChunkMessage,
	ConfigUpdateMessage,
	EndMessage,
	ReadyMessage,
	ShutdownCompleteMessage,
	StartMessage,
	SummaryMessage,
	WorkerMessage,
} from "./worker-messages";
import { isModelRewrite } from "./worker-messages";

const log = new Logger("PostProcessor");

// ===== Worker-owned singletons =====
// Each Bun Worker runs in its own isolated scope. Do NOT import from
// usage-collector.ts — that module's singleton state is not shared with the
// main thread. This worker owns its own DB handle + writer.

await initPayloadEncryption();

const dbOps = new DatabaseOperations();
dbOps.initializeAsync().catch((err: unknown) => {
	log.error("Failed to initialize database async connection:", err);
});

const asyncWriter = new AsyncDbWriter();

// ===== Request state map =====

interface RequestState {
	startMessage: StartMessage;
	buffer: string;
	streamDecoder: TextDecoder;
	chunks: Uint8Array[];
	chunksBytes: number;
	chunksTruncated: boolean;
	usage: {
		model?: string;
		inputTokens?: number;
		cacheReadInputTokens?: number;
		cacheCreationInputTokens?: number;
		outputTokens?: number;
		outputTokensComputed?: number;
		totalTokens?: number;
		costUsd?: number;
		providerCostUsd?: number; // provider-returned cost (OpenRouter) distinct from estimate
		tokensPerSecond?: number;
	};
	lastActivity: number;
	createdAt: number;
	agentUsed?: string;
	project?: string | null;
	billingType?: string;
	firstTokenTimestamp?: number;
	lastTokenTimestamp?: number;
	providerFinalOutputTokens?: number;
	shouldSkipLogging?: boolean;
	currentEvent?: string; // Track SSE event type across chunks (reset on truncation)
}

const requests = new Map<string, RequestState>();
const pendingHandleEnds = new Set<Promise<void>>();

// ===== Config (mutated on config-update message) =====
let storePayloads = true;

// ===== Constants =====
const MAX_REQUESTS_MAP_SIZE = 10000;
const REQUEST_TTL_MS = 2 * 60 * 1000; // 2 minutes
const MAX_RESPONSE_BODY_BYTES = 256 * 1024; // 256 KB
const MAX_REQUEST_BODY_BYTES = 4 * 1024 * 1024; // 4 MB

const maxBufferSize =
	Number(
		process.env.CF_STREAM_USAGE_BUFFER_KB ||
			BUFFER_SIZES.STREAM_USAGE_BUFFER_KB,
	) * 1024;

const timeoutMs = Number(
	process.env.CF_STREAM_TIMEOUT_MS || TIME_CONSTANTS.STREAM_TIMEOUT_DEFAULT,
);

// ===== Helpers =====

function shouldLogRequest(path: string, status: number): boolean {
	if (path.startsWith("/.well-known/") && status === 404) return false;
	return true;
}

const PROJECT_NAME_MAX_LEN = 64;

function sanitizeProjectName(raw: string | undefined | null): string | null {
	if (!raw) return null;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
	const cleaned = raw.replace(/[\x00-\x1F\x7F]/g, "").trim();
	if (!cleaned) return null;
	return cleaned.length > PROJECT_NAME_MAX_LEN
		? cleaned.slice(0, PROJECT_NAME_MAX_LEN)
		: cleaned;
}

function extractSystemPrompt(requestBody: string | null): string | null {
	if (!requestBody) return null;
	try {
		const decodedBody = Buffer.from(requestBody, "base64").toString("utf-8");
		const parsed = JSON.parse(decodedBody);
		if (parsed.system) {
			if (typeof parsed.system === "string") return parsed.system;
			if (Array.isArray(parsed.system)) {
				return parsed.system
					.filter(
						(item: { type?: string; text?: string }) =>
							item.type === "text" && item.text,
					)
					.map((item: { type?: string; text?: string }) => item.text)
					.join("\n");
			}
		}
	} catch {
		// ignore
	}
	return null;
}

function extractProjectFromRequest(startMessage: StartMessage): string | null {
	const messageProject = sanitizeProjectName(startMessage.project);
	if (messageProject) return messageProject;

	if (startMessage.requestHeaders) {
		const headerProject = Object.entries(startMessage.requestHeaders).find(
			([k]) => k.toLowerCase() === "x-project",
		)?.[1];
		const sanitizedHeader = sanitizeProjectName(headerProject);
		if (sanitizedHeader) return sanitizedHeader;
	}

	const systemPrompt = extractSystemPrompt(startMessage.requestBody);
	if (!systemPrompt) return null;

	const pathMatch = systemPrompt.match(
		/\/(?:Users|home)\/[^/]+\/(?:Desktop|projects|repos|src)\/([^/]+)\//,
	);
	const sanitizedPath = sanitizeProjectName(pathMatch?.[1]);
	if (sanitizedPath) return sanitizedPath;

	const headingMatch = systemPrompt.match(/^#\s+([^\n\r]{1,100})/m);
	if (headingMatch) {
		const heading = sanitizeProjectName(headingMatch[1]);
		if (heading && !heading.toLowerCase().startsWith("claude")) {
			return heading;
		}
	}

	return null;
}

function shouldParseSSEData(data: string, eventType: string): boolean {
	if (!data.startsWith("{")) return false;
	switch (eventType) {
		case "message_start":
		case "message_delta":
		case "content_block_start":
		case "content_block_delta":
			return true;
		default:
			return (
				data.includes("usage") ||
				data.includes("message") ||
				data.includes("model")
			);
	}
}

function processSSELine(line: string, state: RequestState): void {
	const trimmed = line.trim();
	if (!trimmed) return;

	const parsed = parseSSELine(trimmed);
	if (parsed.event) {
		state.currentEvent = parsed.event;
	} else if (
		parsed.data &&
		state.currentEvent &&
		shouldParseSSEData(parsed.data, state.currentEvent)
	) {
		extractUsageFromData(parsed.data, state.currentEvent, state);
	}
}

function processStreamChunk(chunk: Uint8Array, state: RequestState): void {
	const text = state.streamDecoder.decode(chunk, { stream: true });
	state.buffer += text;
	state.lastActivity = Date.now();

	if (state.buffer.length > maxBufferSize) {
		const excess = state.buffer.length - maxBufferSize;
		const firstNewlineAfterCut = state.buffer.indexOf("\n", excess);
		if (firstNewlineAfterCut !== -1) {
			state.buffer = state.buffer.slice(firstNewlineAfterCut + 1);
		} else {
			state.buffer = state.buffer.slice(-maxBufferSize);
		}
		// 61f4007a: reset currentEvent after truncation so a stale event: line
		// doesn't corrupt the next data: parse.
		state.currentEvent = undefined;
	}

	let lineStart = 0;
	for (;;) {
		const lineEnd = state.buffer.indexOf("\n", lineStart);
		if (lineEnd === -1) break;
		processSSELine(state.buffer.slice(lineStart, lineEnd), state);
		lineStart = lineEnd + 1;
	}

	if (lineStart > 0) {
		state.buffer = state.buffer.slice(lineStart);
	}
}

function freeRequestState(state: RequestState): void {
	state.chunks.length = 0;
	state.chunksBytes = 0;
	state.buffer = "";
	state.startMessage.requestBody = null;
	state.startMessage.requestHeaders = {};
	state.startMessage.responseHeaders = {};
}

// ===== Message handlers =====

async function handleStart(msg: StartMessage): Promise<void> {
	const shouldSkip = !shouldLogRequest(msg.path, msg.responseStatus);

	if (requests.size >= MAX_REQUESTS_MAP_SIZE) {
		log.error(
			`Requests map at capacity (${MAX_REQUESTS_MAP_SIZE})! Running emergency cleanup...`,
		);
		cleanupStaleRequests();
		if (requests.size >= MAX_REQUESTS_MAP_SIZE) {
			const toRemove = Math.floor(MAX_REQUESTS_MAP_SIZE * 0.1);
			const sortedByAge = Array.from(requests.entries()).sort(
				(a, b) => a[1].createdAt - b[1].createdAt,
			);
			log.error(
				`Emergency cleanup insufficient, force evicting ${toRemove} oldest entries...`,
			);
			for (let i = 0; i < toRemove; i++) {
				const [id] = sortedByAge[i];
				requests.delete(id);
			}
		}
	}

	const now = Date.now();
	const state: RequestState = {
		startMessage: msg,
		buffer: "",
		streamDecoder: new TextDecoder(),
		chunks: [],
		chunksBytes: 0,
		chunksTruncated: false,
		usage: {},
		lastActivity: now,
		createdAt: now,
		shouldSkipLogging: shouldSkip,
	};

	if (msg.agentUsed) {
		state.agentUsed = msg.agentUsed;
		log.debug(`Agent '${msg.agentUsed}' used for request ${msg.requestId}`);
	}

	state.project = extractProjectFromRequest(msg);
	if (state.project) {
		log.debug(
			`Project '${state.project}' extracted for request ${msg.requestId}`,
		);
	}

	const overageInUse =
		msg.responseHeaders["anthropic-ratelimit-unified-overage-in-use"];
	const overageStatus =
		msg.responseHeaders["anthropic-ratelimit-unified-overage-status"];
	if (overageInUse === "true") {
		state.billingType = "overage";
		if (msg.accountAutoPauseOnOverageEnabled === 1 && msg.accountId) {
			const accountId = msg.accountId;
			const accountName = msg.accountName || "unknown";
			log.info(
				`Auto-pausing account '${accountName}' (${accountId}) due to overage detection`,
			);
			asyncWriter.enqueue(async () => {
				await dbOps.pauseAccount(accountId, "overage");
			});
		}
	} else if (
		overageStatus === "rejected" ||
		overageStatus === "org_level_disabled"
	) {
		state.billingType = "plan";
	} else if (msg.accountBillingType) {
		state.billingType = msg.accountBillingType;
	} else {
		const planProviders = new Set([
			"anthropic",
			"zai",
			"alibaba-coding-plan",
			"ollama",
			"ollama-cloud",
			"qwen",
			"codex",
		]);
		state.billingType = planProviders.has(msg.providerName) ? "plan" : "api";
	}

	requests.set(msg.requestId, state);

	if (shouldSkip) {
		log.debug(`Skipping logging for ${msg.path} (${msg.responseStatus})`);
		const ack: AckMessage = { type: "ack", messageId: msg.messageId };
		self.postMessage(ack);
		return;
	}

	if (msg.accountId && msg.accountId !== NO_ACCOUNT_ID) {
		const accountId = msg.accountId;
		asyncWriter.enqueue(async () => dbOps.updateAccountUsage(accountId));
	}

	const ack: AckMessage = { type: "ack", messageId: msg.messageId };
	self.postMessage(ack);
}

function handleChunk(msg: ChunkMessage): void {
	const state = requests.get(msg.requestId);
	if (!state) {
		log.warn(`No state found for request ${msg.requestId}`);
		return;
	}

	// Reconstruct a Uint8Array over the received transferable ArrayBuffer
	const data = new Uint8Array(msg.data);

	if (storePayloads && !state.chunksTruncated) {
		if (state.chunksBytes + data.byteLength <= MAX_RESPONSE_BODY_BYTES) {
			state.chunks.push(data);
			state.chunksBytes += data.byteLength;
		} else {
			const remaining = MAX_RESPONSE_BODY_BYTES - state.chunksBytes;
			if (remaining > 0) {
				state.chunks.push(data.slice(0, remaining));
				state.chunksBytes += remaining;
			}
			state.chunksTruncated = true;
		}
	}

	processStreamChunk(data, state);
}

async function handleEndInternal(msg: EndMessage): Promise<void> {
	const state = requests.get(msg.requestId);
	if (!state) {
		log.warn(`No state found for request ${msg.requestId}`);
		return;
	}

	const { startMessage } = state;
	const responseTime = Date.now() - startMessage.timestamp;

	if (state.shouldSkipLogging) {
		requests.delete(msg.requestId);
		return;
	}

	const trailing = state.streamDecoder.decode();
	if (trailing) {
		state.buffer += trailing;
		const lines = state.buffer.split("\n");
		state.buffer = lines.pop() ?? "";
		for (const line of lines) {
			processSSELine(line, state);
		}
	}

	if (!state.usage.model && msg.responseBody) {
		try {
			const decoded = Buffer.from(msg.responseBody, "base64").toString("utf-8");
			const json = JSON.parse(decoded);
			extractUsageFromJson(json, state);
		} catch {
			// Ignore parse errors
		}
	}

	if (state.usage.model) {
		const finalOutputTokens =
			state.providerFinalOutputTokens ??
			state.usage.outputTokens ??
			state.usage.outputTokensComputed ??
			0;

		state.usage.outputTokens = finalOutputTokens;
		state.usage.outputTokensComputed = undefined;

		state.usage.totalTokens =
			(state.usage.inputTokens || 0) +
			finalOutputTokens +
			(state.usage.cacheReadInputTokens || 0) +
			(state.usage.cacheCreationInputTokens || 0);

		const model = state.usage.model;
		await resolveCostUsd(state, () =>
			estimateCostUSD(model, {
				inputTokens: state.usage.inputTokens,
				outputTokens: finalOutputTokens,
				cacheReadInputTokens: state.usage.cacheReadInputTokens,
				cacheCreationInputTokens: state.usage.cacheCreationInputTokens,
			}),
		);

		if (finalOutputTokens > 0) {
			const totalDurationSec = responseTime / 1000;

			if (totalDurationSec > 0) {
				const isZaiModel = state.usage.model?.startsWith("glm-");

				if (isZaiModel) {
					state.usage.tokensPerSecond = finalOutputTokens / totalDurationSec;
				} else if (state.firstTokenTimestamp && state.lastTokenTimestamp) {
					const streamingDurationMs =
						state.lastTokenTimestamp - state.firstTokenTimestamp;
					const streamingDurationSec = streamingDurationMs / 1000;
					if (streamingDurationMs > 0) {
						state.usage.tokensPerSecond =
							finalOutputTokens / streamingDurationSec;
					} else {
						state.usage.tokensPerSecond = finalOutputTokens / totalDurationSec;
					}
				} else {
					state.usage.tokensPerSecond = finalOutputTokens / totalDurationSec;
				}
			} else {
				state.usage.tokensPerSecond = finalOutputTokens / 0.001;
			}
		}
	}

	const projectAtEnd = state.project ?? null;
	const modelRewritten = isModelRewrite(
		startMessage.originalModel,
		startMessage.appliedModel,
	);
	// Only persist when an actual rewrite occurred — leaves both
	// columns null for the (overwhelmingly common) unchanged case
	// instead of duplicating the `model` column's value.
	asyncWriter.enqueue(async () => {
		try {
			await dbOps.saveRequest(
				startMessage.requestId,
				startMessage.method,
				startMessage.path,
				startMessage.accountId,
				startMessage.responseStatus,
				msg.success,
				msg.error || null,
				responseTime,
				startMessage.failoverAttempts,
				state.usage.model
					? {
							model: state.usage.model,
							promptTokens:
								(state.usage.inputTokens || 0) +
								(state.usage.cacheReadInputTokens || 0) +
								(state.usage.cacheCreationInputTokens || 0),
							completionTokens: state.usage.outputTokens,
							totalTokens: state.usage.totalTokens,
							costUsd: state.usage.costUsd,
							inputTokens: state.usage.inputTokens,
							outputTokens: state.usage.outputTokens,
							cacheReadInputTokens: state.usage.cacheReadInputTokens,
							cacheCreationInputTokens: state.usage.cacheCreationInputTokens,
							tokensPerSecond: state.usage.tokensPerSecond,
						}
					: undefined,
				state.agentUsed,
				startMessage.apiKeyId || undefined,
				startMessage.apiKeyName || undefined,
				projectAtEnd,
				state.billingType,
				startMessage.comboName || null,
				modelRewritten ? startMessage.originalModel : null,
				modelRewritten ? startMessage.appliedModel : null,
			);
		} catch (error) {
			log.error(`Failed to save request for ${startMessage.requestId}:`, error);
		}
	});

	const requestId = startMessage.requestId;
	if (storePayloads) {
		const estimatedRequestBytes = startMessage.requestBody?.length ?? 0;
		const estimatedResponseBytes =
			msg.responseBody?.length ?? state.chunksBytes ?? 0;
		const estimatedPayloadBytes =
			estimatedRequestBytes + estimatedResponseBytes + 2048;

		if (!asyncWriter.canAcceptPayload(estimatedPayloadBytes)) {
			asyncWriter.recordPayloadDrop(estimatedPayloadBytes);
			log.warn(
				`Backpressure: skipping payload persistence for ${requestId} (estimated_bytes=${estimatedPayloadBytes})`,
			);
		} else {
			let responseBody: string | null = null;
			if (msg.responseBody) {
				responseBody = msg.responseBody;
			} else if (state.chunks.length > 0) {
				const combined = combineChunks(state.chunks);
				if (combined.length > 0) {
					responseBody = combined.toString("base64");
				}
			}

			let requestBody = startMessage.requestBody;
			if (requestBody) {
				const rawBytes = Buffer.byteLength(requestBody, "base64");
				if (rawBytes > MAX_REQUEST_BODY_BYTES) {
					requestBody = Buffer.from(requestBody, "base64")
						.subarray(0, MAX_REQUEST_BODY_BYTES)
						.toString("base64");
				}
			}

			const payloadJson = JSON.stringify({
				request: {
					headers: startMessage.requestHeaders,
					body: requestBody,
				},
				response: {
					status: startMessage.responseStatus,
					headers: startMessage.responseHeaders,
					body: responseBody,
				},
				meta: {
					accountId: startMessage.accountId || NO_ACCOUNT_ID,
					timestamp: startMessage.timestamp,
					success: msg.success,
					isStream: startMessage.isStream,
					retry: startMessage.retryAttempt,
					project: state.project ?? undefined,
				},
			});

			responseBody = null;

			const payloadBytes = Buffer.byteLength(payloadJson);
			const accepted = asyncWriter.enqueuePayload(
				requestId,
				payloadBytes,
				async () => {
					try {
						await dbOps.saveRequestPayloadRaw(requestId, payloadJson);
					} catch (error) {
						log.error(`Failed to save payload for ${requestId}:`, error);
					}
				},
			);
			if (!accepted) {
				log.warn(
					`Payload write rejected post-serialization for ${requestId} (bytes=${payloadBytes})`,
				);
			}
		}
	}

	freeRequestState(state);

	if (state.usage.model && startMessage.accountId !== NO_ACCOUNT_ID) {
		log.debug(
			`Usage for request ${startMessage.requestId}: Model: ${state.usage.model}, ` +
				`Tokens: ${state.usage.totalTokens || 0}, Cost: ${formatCost(state.usage.costUsd)}`,
		);
	}

	// Build summary for real-time updates
	const summary: RequestResponse = {
		id: startMessage.requestId,
		timestamp: new Date(startMessage.timestamp).toISOString(),
		method: startMessage.method,
		path: startMessage.path,
		accountUsed: startMessage.accountId,
		statusCode: startMessage.responseStatus,
		success: msg.success,
		errorMessage: msg.error || null,
		responseTimeMs: responseTime,
		failoverAttempts: startMessage.failoverAttempts,
		model: state.usage.model,
		promptTokens: state.usage.inputTokens,
		completionTokens: state.usage.outputTokens,
		totalTokens: state.usage.totalTokens,
		inputTokens: state.usage.inputTokens,
		cacheReadInputTokens: state.usage.cacheReadInputTokens,
		cacheCreationInputTokens: state.usage.cacheCreationInputTokens,
		outputTokens: state.usage.outputTokens,
		costUsd: state.usage.costUsd,
		agentUsed: state.agentUsed,
		tokensPerSecond: state.usage.tokensPerSecond,
		apiKeyId: startMessage.apiKeyId || undefined,
		apiKeyName: startMessage.apiKeyName || undefined,
		project: state.project ?? undefined,
		billingType: state.billingType,
		originalModel: startMessage.originalModel || undefined,
		appliedModel: startMessage.appliedModel || undefined,
		comboName: startMessage.comboName || undefined,
	};

	// Send summary back to main thread (plain JSON, no transferable)
	// cacheBodyStore.onSummary is called on the MAIN thread via the SummaryMessage.
	const summaryMsg: SummaryMessage = { type: "summary", summary };
	self.postMessage(summaryMsg);

	requests.delete(msg.requestId);
}

async function handleEnd(msg: EndMessage): Promise<void> {
	// eb9817a6: then/catch (not finally) for pendingHandleEnds cleanup
	const promise = handleEndInternal(msg);
	pendingHandleEnds.add(promise);
	const cleanup = () => pendingHandleEnds.delete(promise);
	promise.then(cleanup, cleanup);
	return promise;
}

async function handleShutdown(): Promise<void> {
	// ba89fe28: Promise.allSettled — no abandoned writes on shutdown
	await Promise.allSettled([...pendingHandleEnds]);
	// 16748635: flush AsyncDbWriter before exit
	await asyncWriter.dispose();

	const shutdownComplete: ShutdownCompleteMessage = {
		type: "shutdown-complete",
	};
	self.postMessage(shutdownComplete);
}

// ===== Stale-request cleanup =====

function cleanupStaleRequests(): void {
	const now = Date.now();
	let removedCount = 0;

	for (const [id, state] of requests) {
		const age = now - state.createdAt;
		if (age > REQUEST_TTL_MS) {
			log.warn(
				`Request ${id} exceeded TTL (age: ${Math.round(age / 1000)}s, limit: ${REQUEST_TTL_MS / 1000}s), removing...`,
			);
			freeRequestState(state);
			requests.delete(id);
			removedCount++;
		}
	}

	for (const [id, state] of requests) {
		const inactivity = now - state.lastActivity;
		if (inactivity > timeoutMs) {
			log.warn(
				`Request ${id} appears orphaned (no activity for ${Math.round(inactivity / 1000)}s), removing...`,
			);
			freeRequestState(state);
			requests.delete(id);
			removedCount++;
		}
	}

	if (requests.size > MAX_REQUESTS_MAP_SIZE) {
		const excess = requests.size - MAX_REQUESTS_MAP_SIZE;
		const sortedByAge = Array.from(requests.entries()).sort(
			(a, b) => a[1].createdAt - b[1].createdAt,
		);
		log.warn(
			`Requests map size (${requests.size}) exceeds limit (${MAX_REQUESTS_MAP_SIZE}), evicting ${excess} oldest entries...`,
		);
		for (let i = 0; i < excess; i++) {
			const [id, state] = sortedByAge[i];
			freeRequestState(state);
			requests.delete(id);
			removedCount++;
		}
	}

	if (removedCount > 0 || requests.size > 0) {
		log.info(
			`requests.size=${requests.size} after cleanup (removed=${removedCount})`,
		);
	}
}

// Run cleanup every 30 seconds
const cleanupInterval = setInterval(cleanupStaleRequests, 30_000);
if (
	"unref" in cleanupInterval &&
	typeof (cleanupInterval as { unref?: () => void }).unref === "function"
) {
	(cleanupInterval as { unref: () => void }).unref();
}

// ===== Main message dispatcher =====

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
	const msg = event.data;

	switch (msg.type) {
		case "start":
			await handleStart(msg as StartMessage);
			break;
		case "chunk":
			handleChunk(msg as ChunkMessage);
			break;
		case "end":
			await handleEnd(msg as EndMessage);
			break;
		case "shutdown":
			await handleShutdown();
			break;
		case "config-update":
			storePayloads = (msg as ConfigUpdateMessage).storePayloads;
			break;
		default:
			log.warn(`Unknown message type: ${(msg as { type: string }).type}`);
	}
};

// Signal ready after initialization
const readyMsg: ReadyMessage = { type: "ready" };
self.postMessage(readyMsg);
