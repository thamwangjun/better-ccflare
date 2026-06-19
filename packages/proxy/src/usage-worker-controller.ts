import { Logger } from "@better-ccflare/logger";
import { EMBEDDED_WORKER_CODE } from "./inline-worker";
import type {
	ChunkMessage,
	OutgoingWorkerMessage,
	SummaryMessage,
	WorkerMessage,
} from "./worker-messages";

const log = new Logger("UsageWorkerController");

type WorkerState = "starting" | "ready" | "shutting_down" | "stopped";

export interface UsageWorkerHealth {
	state: WorkerState;
	pendingAcks: number;
	lastError: string | null;
	startedAt: number | null;
}

interface PendingAck {
	timer: Timer;
}

const MAX_RESTARTS = 3;
const SHUTDOWN_GRACE_MS = 2_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;

/**
 * Maximum number of ChunkMessages to buffer while the worker is starting.
 * Past this cap, further chunks are dropped (with a single log warning per
 * burst) so the main-thread buffer cannot grow without bound.
 */
const READY_BUFFER_CAP = 64;

/**
 * Resolve the worker startup timeout from `CF_WORKER_STARTUP_TIMEOUT_MS`,
 * falling back to {@link DEFAULT_STARTUP_TIMEOUT_MS}.
 *
 * The worker opens its own SQLite handle on startup; on operators with large
 * (multi-GB) databases the per-handle PRAGMA work can blow past the historical
 * 10 s timeout and silently strand request analytics. 60 s gives that path
 * headroom; ops with massive DBs or slow disks can raise it further via env.
 */
function resolveStartupTimeoutMs(): number {
	const raw = process.env.CF_WORKER_STARTUP_TIMEOUT_MS;
	if (raw === undefined || raw === "") return DEFAULT_STARTUP_TIMEOUT_MS;
	// Number() rejects trailing garbage that Number.parseInt would silently
	// accept ("100ms" → 100 was a real foot-gun); isInteger catches NaN,
	// Infinity, and fractional values in one check.
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		log.warn(
			`CF_WORKER_STARTUP_TIMEOUT_MS="${raw}" is not a positive integer — falling back to default ${DEFAULT_STARTUP_TIMEOUT_MS}ms`,
		);
		return DEFAULT_STARTUP_TIMEOUT_MS;
	}
	return parsed;
}

/**
 * UsageWorkerController manages the lifecycle of the post-processor Bun Worker.
 *
 * Key features (restored from 315440fa^ + extended with bounded ready-buffer):
 *  - start/isReady/getHealth/terminate lifecycle
 *  - States: starting | ready | shutting_down | stopped
 *  - Ack tracking for StartMessages (with per-ack timeout)
 *  - Startup timeout (CF_WORKER_STARTUP_TIMEOUT_MS, default 60s)
 *  - MAX_RESTARTS=3 auto-restart on worker error
 *  - Spawns from base64 EMBEDDED_WORKER_CODE Blob+objectURL, falls back to
 *    ./post-processor.worker.ts URL; { smol: true } + .unref()
 *  - Bounded buffer-until-ready: chunk messages arriving before "ready" are
 *    queued (up to READY_BUFFER_CAP) and flushed in order on ready.
 *    Past cap: drop + log once, never block or tear down the client stream.
 *  - postMessage for ChunkMessage passes the transfer list [msg.data]
 *  - terminate() sends shutdown, waits for shutdown-complete or grace period
 */
export class UsageWorkerController {
	private state: WorkerState = "stopped";
	private worker: Worker | null = null;
	private pendingAcks = new Map<string, PendingAck>();
	private lastError: string | null = null;
	private startedAt: number | null = null;
	private restartCount = 0;
	private startupTimer: Timer | null = null;
	private shutdownResolve: (() => void) | null = null;

	/** ChunkMessages buffered while the worker is still starting. */
	private readyBuffer: Array<{ msg: ChunkMessage; transfer: ArrayBuffer[] }> =
		[];
	/** Set to true once a drop warning has been emitted for the current startup. */
	private readyBufferCapWarned = false;

	constructor(
		private readonly onSummary: (msg: SummaryMessage) => void,
		private readonly onReady?: () => void,
		private readonly startupTimeoutMs = resolveStartupTimeoutMs(),
		private readonly ackTimeoutMs = 30_000,
	) {}

	start(): void {
		// Idempotent guard — don't double-start
		if (this.state === "starting" || this.state === "ready") return;

		this.state = "starting";
		this.readyBuffer = [];
		this.readyBufferCapWarned = false;
		this.worker = this.createWorker();

		this.worker.onmessage = (ev: MessageEvent) => {
			this.handleMessage(ev.data as OutgoingWorkerMessage);
		};

		this.worker.onerror = (error: ErrorEvent) => {
			const msg = error.message ?? "unknown worker error";
			log.error("Worker error", {
				message: msg,
				filename: error.filename,
				lineno: error.lineno,
			});
			this.lastError = msg;

			// WR-01: restart on error in ANY non-terminal state (starting OR ready),
			// not only "ready" — startup crashes must not wait 60s for the timer.
			if (this.state === "starting" || this.state === "ready") {
				this.attemptRestart();
			}
		};

		this.startupTimer = setTimeout(() => {
			log.error(
				`Worker did not become ready within ${this.startupTimeoutMs}ms`,
			);
			this.lastError = "startup timeout";
			this.attemptRestart();
		}, this.startupTimeoutMs);
	}

	/**
	 * Post a message to the worker.
	 *
	 * For ChunkMessages the caller MUST supply the transfer list via the msg.data
	 * ArrayBuffer — this method passes [msg.data] automatically as the transfer
	 * list so the backing store is moved zero-copy to the worker.
	 *
	 * Throws if state is not "ready" (for non-chunk messages) or if state is
	 * "stopped" / "shutting_down". Chunk messages arriving in "starting" state
	 * are queued in the bounded ready-buffer and flushed on "ready".
	 */
	postMessage(msg: WorkerMessage): void;
	postMessage(msg: WorkerMessage, transfer?: Transferable[]): void;
	postMessage(msg: WorkerMessage, transfer?: Transferable[]): void {
		if (msg.type === "chunk") {
			// Chunk messages: buffer while starting, dispatch once ready.
			if (this.state === "starting") {
				if (this.readyBuffer.length >= READY_BUFFER_CAP) {
					if (!this.readyBufferCapWarned) {
						log.warn(
							`Ready buffer cap (${READY_BUFFER_CAP}) reached — dropping further chunks until worker is ready`,
						);
						this.readyBufferCapWarned = true;
					}
					return; // Drop silently (warning already emitted)
				}
				const buf = (msg as ChunkMessage).data;
				this.readyBuffer.push({ msg: msg as ChunkMessage, transfer: [buf] });
				return;
			}

			// WR-02: shutting_down / stopped — drop silently rather than throw.
			// The guard in the caller (safeHandleChunk) would swallow a throw anyway,
			// but we make the contract clean: terminal states drop without raising.
			if (this.state === "shutting_down" || this.state === "stopped") {
				log.warn(
					`Chunk dropped: worker is in "${this.state}" state, cannot dispatch`,
				);
				return;
			}

			const chunkBuf = (msg as ChunkMessage).data;
			this.worker?.postMessage(msg, [chunkBuf]);
			return;
		}

		// All other messages require "ready" state
		if (this.state !== "ready") {
			throw new Error(
				`Cannot post message: worker state is "${this.state}", expected "ready"`,
			);
		}

		if (msg.type === "start") {
			const { messageId } = msg;
			const timer = setTimeout(() => {
				if (this.pendingAcks.has(messageId)) {
					log.warn(`Ack timeout for messageId=${messageId}`);
					this.pendingAcks.delete(messageId);
				}
			}, this.ackTimeoutMs);

			this.pendingAcks.set(messageId, { timer });
		}

		if (transfer && transfer.length > 0) {
			this.worker?.postMessage(msg, transfer);
		} else {
			this.worker?.postMessage(msg);
		}
	}

	terminate(): Promise<void> {
		if (this.state === "stopped") return Promise.resolve();

		this.state = "shutting_down";

		// Discard buffered chunks — we're shutting down
		this.readyBuffer = [];

		const promise = new Promise<void>((resolve) => {
			this.shutdownResolve = resolve;

			// Fallback: terminate after grace period regardless of shutdown-complete
			setTimeout(() => {
				resolve();
			}, SHUTDOWN_GRACE_MS);
		});

		try {
			this.worker?.postMessage({ type: "shutdown" });
		} catch {
			// Worker already gone
		}

		return promise.then(() => {
			this.destroyWorker();
			this.state = "stopped";
		});
	}

	getHealth(): UsageWorkerHealth {
		return {
			state: this.state,
			pendingAcks: this.pendingAcks.size,
			lastError: this.lastError,
			startedAt: this.startedAt,
		};
	}

	isReady(): boolean {
		return this.state === "ready";
	}

	// ===== Internal =====

	private handleMessage(data: OutgoingWorkerMessage): void {
		switch (data.type) {
			case "ready":
				clearTimeout(this.startupTimer!);
				this.startupTimer = null;
				this.state = "ready";
				this.startedAt = Date.now();
				this.flushReadyBuffer();
				this.onReady?.();
				break;

			case "ack": {
				const pending = this.pendingAcks.get(data.messageId);
				if (pending) {
					clearTimeout(pending.timer);
					this.pendingAcks.delete(data.messageId);
				}
				break;
			}

			case "shutdown-complete":
				if (this.state === "shutting_down" && this.shutdownResolve) {
					this.shutdownResolve();
					this.shutdownResolve = null;
				}
				break;

			case "summary":
				this.onSummary(data);
				break;
		}
	}

	/**
	 * Flush the bounded ready-buffer in insertion order once the worker signals
	 * ready. Each buffered ChunkMessage is posted with its transfer list.
	 */
	private flushReadyBuffer(): void {
		const toFlush = this.readyBuffer;
		this.readyBuffer = [];
		this.readyBufferCapWarned = false;

		for (const { msg, transfer } of toFlush) {
			try {
				this.worker?.postMessage(msg, transfer);
			} catch (err) {
				log.warn("Failed to flush buffered chunk to worker:", err);
			}
		}
	}

	private attemptRestart(): void {
		this.destroyWorker();

		if (this.restartCount >= MAX_RESTARTS) {
			log.error(`Worker failed after ${MAX_RESTARTS} restarts — giving up`);
			this.state = "stopped";
			return;
		}

		this.restartCount++;
		log.warn(
			`Restarting worker (attempt ${this.restartCount}/${MAX_RESTARTS})`,
		);

		// Reset to stopped so start() accepts the call
		this.state = "stopped";
		this.start();
	}

	private destroyWorker(): void {
		if (this.startupTimer !== null) {
			clearTimeout(this.startupTimer);
			this.startupTimer = null;
		}

		for (const { timer } of this.pendingAcks.values()) {
			clearTimeout(timer);
		}
		this.pendingAcks.clear();

		try {
			this.worker?.terminate();
		} catch {
			// Ignore
		}
		this.worker = null;
	}

	private createWorker(): Worker {
		let w: Worker;

		if (EMBEDDED_WORKER_CODE) {
			const workerCode = Buffer.from(EMBEDDED_WORKER_CODE, "base64").toString(
				"utf8",
			);
			const blob = new Blob([workerCode], { type: "text/javascript" });
			const workerUrl = URL.createObjectURL(blob);
			w = new Worker(workerUrl, { smol: true });
			// WR-03: revoke the object URL on next microtask so the Worker has time
			// to load the script before the URL is revoked. Without this, every
			// restart leaks a Blob + URL (max 4 leaks with MAX_RESTARTS=3).
			Promise.resolve().then(() => URL.revokeObjectURL(workerUrl));
		} else {
			const workerPath = new URL("./post-processor.worker.ts", import.meta.url)
				.href;
			w = new Worker(workerPath, { smol: true });
		}

		// Bun extension — don't keep the process alive for the worker alone
		if (
			"unref" in w &&
			typeof (w as { unref?: () => void }).unref === "function"
		) {
			(w as { unref: () => void }).unref();
		}

		return w;
	}
}
