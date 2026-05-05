/**
 * Tests for AccountRepository openrouter_provider_preference SELECT/UPDATE (PROV-02).
 *
 * Verifies that:
 *  - setOpenrouterProviderPreference(id, value)  persists the JSON string to the DB column
 *  - setOpenrouterProviderPreference(id, null)   stores NULL in the DB column
 *  - findById(id) returns openrouter_provider_preference (not undefined)
 *  - findAll() returns openrouter_provider_preference in all results (not undefined)
 *
 * These tests go RED before Plan 02 adds the column, method, and SELECT list entries.
 * // FORK PATCH: PROV-02 — openrouter_provider_preference test scaffold
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
// Force @better-ccflare/core to initialise before @better-ccflare/types resolves its
// circular dependency (types/agent.ts → core → core/strategy.ts → types/StrategyName).
// Without this the enum is undefined when strategy.ts runs. Same pattern as stats-session-cost.test.ts.
import "@better-ccflare/core";
import { BunSqlAdapter } from "../../adapters/bun-sql-adapter";
import { AccountRepository } from "../account.repository";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): { db: Database; repo: AccountRepository } {
	const db = new Database(":memory:");

	// Minimal schema — only the columns AccountRepository touches.
	// Includes openrouter_provider_preference as the new column added by PROV-02.
	db.run(`
		CREATE TABLE accounts (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			provider TEXT DEFAULT 'anthropic',
			api_key TEXT,
			refresh_token TEXT DEFAULT '',
			access_token TEXT,
			expires_at INTEGER,
			created_at INTEGER NOT NULL,
			last_used INTEGER,
			request_count INTEGER DEFAULT 0,
			total_requests INTEGER DEFAULT 0,
			rate_limited_until INTEGER,
			session_start INTEGER,
			session_request_count INTEGER DEFAULT 0,
			paused INTEGER DEFAULT 0,
			rate_limit_reset INTEGER,
			rate_limit_status TEXT,
			rate_limit_remaining INTEGER,
			priority INTEGER DEFAULT 0,
			auto_fallback_enabled INTEGER DEFAULT 0,
			auto_refresh_enabled INTEGER DEFAULT 0,
			auto_pause_on_overage_enabled INTEGER DEFAULT 0,
			custom_endpoint TEXT,
			model_mappings TEXT,
			cross_region_mode TEXT,
			model_fallbacks TEXT,
			billing_type TEXT,
			pause_reason TEXT,
			refresh_token_issued_at INTEGER,
			openrouter_provider_preference TEXT
		)
	`);

	const adapter = new BunSqlAdapter(db);
	const repo = new AccountRepository(adapter);
	return { db, repo };
}

function insertAccount(db: Database, id: string): void {
	db.run(
		`INSERT INTO accounts (id, name, created_at) VALUES (?, ?, ?)`,
		[id, id, Date.now()],
	);
}

interface RawPreference {
	openrouter_provider_preference: string | null;
}

function getPreference(db: Database, id: string): RawPreference {
	return db
		.query<RawPreference, [string]>(
			"SELECT openrouter_provider_preference FROM accounts WHERE id = ?",
		)
		.get(id) as RawPreference;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AccountRepository — openrouter provider preference", () => {
	let db: Database;
	let repo: AccountRepository;

	beforeEach(() => {
		({ db, repo } = makeDb());
	});

	afterEach(() => {
		db.close();
	});

	describe("setOpenrouterProviderPreference(id, value)", () => {
		it("persists the JSON string to the DB column", async () => {
			insertAccount(db, "acc-1");
			await repo.setOpenrouterProviderPreference("acc-1", '["openai","anthropic"]');
			const row = getPreference(db, "acc-1");
			expect(row.openrouter_provider_preference).toBe('["openai","anthropic"]');
		});
	});

	describe("setOpenrouterProviderPreference(id, null)", () => {
		it("stores NULL in the DB column", async () => {
			insertAccount(db, "acc-2");
			db.run("UPDATE accounts SET openrouter_provider_preference = 'old' WHERE id = 'acc-2'");
			await repo.setOpenrouterProviderPreference("acc-2", null);
			const row = getPreference(db, "acc-2");
			expect(row.openrouter_provider_preference).toBeNull();
		});
	});

	describe("findById — SELECT includes openrouter_provider_preference", () => {
		it("returns openrouter_provider_preference from the account (not undefined)", async () => {
			insertAccount(db, "acc-3");
			db.run("UPDATE accounts SET openrouter_provider_preference = '[\"openai\"]' WHERE id = 'acc-3'");
			const account = await repo.findById("acc-3");
			expect(account).not.toBeNull();
			expect(account!.openrouter_provider_preference).toBe('["openai"]');
		});
	});

	describe("findAll — SELECT includes openrouter_provider_preference", () => {
		it("returns openrouter_provider_preference in list results (not undefined)", async () => {
			insertAccount(db, "acc-4");
			db.run("UPDATE accounts SET openrouter_provider_preference = null WHERE id = 'acc-4'");
			const accounts = await repo.findAll();
			const acc = accounts.find((a) => a.id === "acc-4");
			expect(acc).toBeDefined();
			// openrouter_provider_preference must be null (not undefined) — proves the SELECT list includes it
			expect(acc!.openrouter_provider_preference).toBeNull();
		});
	});
});
