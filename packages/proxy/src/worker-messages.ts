/**
 * Unified message protocol for main thread <-> worker communication
 * Handles both streaming and non-streaming responses
 */

// ===== MAIN THREAD → WORKER =====

export interface StartMessage {
	type: "start";
	messageId: string; // envelope ID for ack tracking
	requestId: string;
	accountId: string | null;
	method: string;
	path: string;
	timestamp: number;

	// Request details
	requestHeaders: Record<string, string>;
	requestBody: string | null; // base64 encoded
	project: string | null;

	// Response details
	responseStatus: number;
	responseHeaders: Record<string, string>;
	isStream: boolean;

	// Provider info for rate limit parsing
	providerName: string;

	// Account billing type override (null = use provider heuristic)
	accountBillingType: string | null;

	// Account auto-pause-on-overage flag (1 = enabled, 0 = disabled, null = not set)
	accountAutoPauseOnOverageEnabled: number | null;

	// Account name for logging
	accountName: string | null;

	// Agent info
	agentUsed: string | null;

	// Model rewrite observability: the model the client originally requested
	// and the model actually forwarded upstream. Both null unless an
	// agent-preference rewrite (agent-interceptor.ts) changed the model —
	// gate every write through isModelRewrite() so "agent detected but
	// nothing rewritten" never records a pair of equal values.
	originalModel: string | null;
	appliedModel: string | null;

	// Combo info
	comboName: string | null;

	// API key info
	apiKeyId: string | null;
	apiKeyName: string | null;

	// Retry info
	retryAttempt: number;
	failoverAttempts: number;
}

/**
 * True only when an agent-preference rewrite actually swapped the model:
 * both values present and different. The single source of truth for every
 * consumer that persists or surfaces the originalModel/appliedModel pair
 * (StartMessage construction, request-row persistence, response header) —
 * keeping them in agreement so a no-rewrite request never looks like one.
 */
export function isModelRewrite(
	originalModel: string | null | undefined,
	appliedModel: string | null | undefined,
): boolean {
	return !!originalModel && !!appliedModel && originalModel !== appliedModel;
}

/**
 * ChunkMessage carries a transferable ArrayBuffer.
 *
 * TRANSFER CONTRACT: the producer calls
 *   const copy = value.slice();
 *   postMessage({ type: "chunk", requestId, data: copy.buffer }, [copy.buffer]);
 *
 * The copy is a fresh ArrayBuffer (byteOffset === 0, own backing store) produced
 * from the client-enqueued Uint8Array via value.slice(). The COPY's buffer is
 * transferred (moved, zero-copy); the client's original `value` is never touched.
 * After transfer, copy.buffer.byteLength === 0 (detached).
 *
 * Rationale: in stream-tee.ts the SAME value is enqueued to the client (line 39)
 * and then passed to onChunk (line 56). Transferring value.buffer would detach
 * the client's bytes. Always slice first, then transfer the slice's buffer.
 */
export interface ChunkMessage {
	type: "chunk";
	requestId: string;
	data: ArrayBuffer;
}

export interface EndMessage {
	type: "end";
	requestId: string;
	responseBody?: string | null; // base64 encoded, for non-streaming
	success: boolean;
	error?: string;
}

export interface ControlMessage {
	type: "shutdown";
}

export interface ConfigUpdateMessage {
	type: "config-update";
	storePayloads: boolean;
}

export type WorkerMessage =
	| StartMessage
	| ChunkMessage
	| EndMessage
	| ControlMessage
	| ConfigUpdateMessage;

// ===== WORKER → MAIN THREAD =====

/** Worker is initialized and ready to accept messages */
export interface ReadyMessage {
	type: "ready";
}

/** Worker acknowledges a StartMessage envelope */
export interface AckMessage {
	type: "ack";
	messageId: string;
}

/** Worker has flushed all pending work and is safe to terminate */
export interface ShutdownCompleteMessage {
	type: "shutdown-complete";
}

export interface SummaryMessage {
	type: "summary";
	summary: import("@better-ccflare/types").RequestResponse;
}

export type OutgoingWorkerMessage =
	| ReadyMessage
	| AckMessage
	| ShutdownCompleteMessage
	| SummaryMessage;
