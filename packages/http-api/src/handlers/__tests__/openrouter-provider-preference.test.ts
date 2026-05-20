import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import type { DatabaseOperations } from "@better-ccflare/database";
import { DatabaseFactory } from "@better-ccflare/database";
import {
	createAccountOpenrouterProviderPreferenceDeleteHandler,
	createAccountOpenrouterProviderPreferenceHandler,
} from "../accounts";

const TEST_DB_PATH = "/tmp/test-openrouter-provider-preference.db";

/** Insert a minimal account row and return its generated id. */
async function insertAccount(
	dbOps: DatabaseOperations,
	name: string,
): Promise<string> {
	const db = dbOps.getAdapter();
	const id = crypto.randomUUID();
	await db.run(
		`INSERT INTO accounts (id, name, provider, refresh_token, created_at, priority)
     VALUES (?, ?, ?, ?, ?, ?)`,
		[id, name, "openrouter", "tok", Date.now(), 0],
	);
	return id;
}

/** Read the parsed openrouter_provider_preference object for an account, or null. */
async function readPreference(
	dbOps: DatabaseOperations,
	id: string,
): Promise<{ order: string[]; allow_fallbacks: boolean } | null> {
	const db = dbOps.getAdapter();
	const row = await db.get<{ openrouter_provider_preference: string | null }>(
		"SELECT openrouter_provider_preference FROM accounts WHERE id = ?",
		[id],
	);
	if (!row || row.openrouter_provider_preference === null) return null;
	return JSON.parse(row.openrouter_provider_preference);
}

/** Build a PUT Request for the preference endpoint. */
function makePutRequest(body: unknown): Request {
	return new Request(
		"http://localhost/api/accounts/x/openrouter-provider-preference",
		{
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		},
	);
}

/** Build a DELETE Request for the preference endpoint. */
function makeDeleteRequest(): Request {
	return new Request(
		"http://localhost/api/accounts/x/openrouter-provider-preference",
		{
			method: "DELETE",
		},
	);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("OpenRouter provider preference — PUT + DELETE handlers", () => {
	let dbOps: DatabaseOperations;
	let putHandler: (req: Request, accountId: string) => Promise<Response>;
	let deleteHandler: (req: Request, accountId: string) => Promise<Response>;

	beforeAll(() => {
		if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
		DatabaseFactory.initialize(TEST_DB_PATH);
		dbOps = DatabaseFactory.getInstance();
		putHandler = createAccountOpenrouterProviderPreferenceHandler(dbOps);
		deleteHandler = createAccountOpenrouterProviderPreferenceDeleteHandler(dbOps);
	});

	afterAll(() => {
		DatabaseFactory.reset();
		try {
			if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
		} catch {
			// ignore
		}
	});

	beforeEach(async () => {
		// Wipe all accounts between tests for isolation.
		await dbOps.getAdapter().run("DELETE FROM accounts", []);
	});

	// ─── PUT tests ───────────────────────────────────────────────────────────

	// T-01: PUT with valid order → 204
	it("T-01: PUT with valid order returns 204", async () => {
		const id = await insertAccount(dbOps, "acc1");
		const response = await putHandler(
			makePutRequest({ order: ["openai", "anthropic"] }),
			id,
		);
		expect(response.status).toBe(204);
	});

	// T-02: PUT with valid order → preference persisted correctly
	it("T-02: PUT with valid order persists order to DB", async () => {
		const id = await insertAccount(dbOps, "acc2");
		await putHandler(
			makePutRequest({ order: ["openai", "anthropic"] }),
			id,
		);
		const pref = await readPreference(dbOps, id);
		expect(pref?.order).toEqual(["openai", "anthropic"]);
	});

	// T-05: PUT with empty order array → 400
	it("T-05: PUT with empty order array returns 400", async () => {
		const id = await insertAccount(dbOps, "acc3");
		const response = await putHandler(makePutRequest({ order: [] }), id);
		expect(response.status).toBe(400);
	});

	// T-06: PUT with missing order field → 400
	it("T-06: PUT with missing order field returns 400", async () => {
		const id = await insertAccount(dbOps, "acc4");
		const response = await putHandler(makePutRequest({}), id);
		expect(response.status).toBe(400);
	});

	// T-07: PUT with non-string items in order → 400
	it("T-07: PUT with non-string items in order returns 400", async () => {
		const id = await insertAccount(dbOps, "acc5");
		const response = await putHandler(makePutRequest({ order: [123] }), id);
		expect(response.status).toBe(400);
	});

	// T-08: PUT on non-existent account → 404
	it("T-08: PUT on non-existent account returns 404", async () => {
		const response = await putHandler(
			makePutRequest({ order: ["openai"] }),
			"nonexistent-id",
		);
		expect(response.status).toBe(404);
	});

	// T-10: PUT without allow_fallbacks → defaults to true
	it("T-10: PUT without allow_fallbacks defaults to true", async () => {
		const id = await insertAccount(dbOps, "acc6");
		await putHandler(makePutRequest({ order: ["openai"] }), id);
		const pref = await readPreference(dbOps, id);
		expect(pref?.allow_fallbacks).toBe(true);
	});

	// T-11: PUT with allow_fallbacks: false → persisted as false
	it("T-11: PUT with allow_fallbacks: false persists as false", async () => {
		const id = await insertAccount(dbOps, "acc7");
		await putHandler(
			makePutRequest({ order: ["openai"], allow_fallbacks: false }),
			id,
		);
		const pref = await readPreference(dbOps, id);
		expect(pref?.allow_fallbacks).toBe(false);
	});

	// ─── DELETE tests ─────────────────────────────────────────────────────────

	// T-03: DELETE on account with existing preference → 204
	it("T-03: DELETE on account with existing preference returns 204", async () => {
		const id = await insertAccount(dbOps, "acc8");
		// Set a preference first
		await putHandler(makePutRequest({ order: ["openai"] }), id);
		const response = await deleteHandler(makeDeleteRequest(), id);
		expect(response.status).toBe(204);
	});

	// T-04: DELETE on account with existing preference → preference is null after
	it("T-04: DELETE clears preference (null after call)", async () => {
		const id = await insertAccount(dbOps, "acc9");
		// Set a preference first
		await putHandler(makePutRequest({ order: ["openai", "anthropic"] }), id);
		await deleteHandler(makeDeleteRequest(), id);
		const pref = await readPreference(dbOps, id);
		expect(pref).toBeNull();
	});

	// T-09: DELETE on non-existent account → 404
	it("T-09: DELETE on non-existent account returns 404", async () => {
		const response = await deleteHandler(makeDeleteRequest(), "nonexistent-id");
		expect(response.status).toBe(404);
	});
});
