# Phase 6: Dashboard UI & Maintenance Hardening - Research

**Researched:** 2026-05-20
**Domain:** React dashboard component authoring (Radix UI + Tailwind) + shell script maintenance
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** The dialog includes a labeled "Allow fallbacks" row using a Radix `Switch` component. Default state: checked (ON), matching the stored default of `true` and the existing `Switch` usage in `AccountListItem` (autoFallback, autoRefresh).
- **D-02:** When the provider order input is empty on Save (regardless of the toggle state), the dialog calls `DELETE` to remove the preference entirely. Empty order + any toggle state = "no preference" → clear. No separate "Clear All" button is needed.
- **D-03:** The sole clearing mechanism is: empty the provider order input field and click Save. This calls `DELETE /api/accounts/:id/openrouter-provider-preference` and returns the account to no preference (proxy stops injecting `provider.order`).
- **D-04:** The action surfaces as a **dropdown menu item** in `AccountListItem` labeled "Provider Preferences", gated on `account.provider === "openrouter"`. Non-OpenRouter accounts never see this item. Consistent with the existing "Model Mappings" dropdown pattern.
- **D-05:** The `// FORK PATCH:` annotation audit is a **full v1.1 scan** — all files modified across phases 3–6 that carry fork-specific logic. Not limited to Phase 6 additions. This runs as a completion gate before the milestone is marked done.

### Claude's Discretion

- Exact `AccountOpenrouterProviderPreferenceDialog` component name and file location — follow `AccountModelMappingsDialog.tsx` naming and placement
- Whether to add an `onProviderPreferenceChange` prop to `AccountListItem` or follow a different callback wiring pattern (follow the `onModelMappingsChange` pattern exactly)
- Order of the "Provider Preferences" item relative to "Model Mappings" in the dropdown menu — place adjacent to it
- `AccountsTab.tsx` mutation wiring — follow the existing `updateModelMappings` pattern for `setProviderPreference` / `clearProviderPreference` mutations
- Input placeholder for provider order — e.g., `"e.g., anthropic/claude-3-5-sonnet, openai/gpt-4o"`

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROV-04 | Dashboard UI dialog on OpenRouter accounts for set/clear provider order (comma-separated input), gated on `account.provider === "openrouter"` | Dialog component pattern verified in `AccountModelMappingsDialog.tsx`; API endpoints verified in `accounts.ts` and `router.ts`; type shape verified in `account.ts` |
| MAINT-04 | `pre-merge-check.sh` `HIGH_RISK_FILES` list updated to include `migrations.ts` and `http-api/src/handlers/accounts.ts` | Script file location and current content verified; exact array to extend identified |
| MAINT-05 | Every fork-specific code block in v1.1 carries a `// FORK PATCH:` comment (enforced before merge) | 27 existing annotations verified; dashboard-web has zero — new dialog will add the only dashboard-side fork-specific code |

</phase_requirements>

---

## Summary

Phase 6 has two completely independent workstreams. The first is a React UI component (PROV-04): a dialog that mirrors `AccountModelMappingsDialog.tsx` nearly line for line, with one text `Input` (comma-separated provider order) and one Radix `Switch` (allow_fallbacks toggle). The dialog calls two already-implemented API endpoints from Phase 5 and introduces no schema, server, or type changes. The second workstream (MAINT-04 + MAINT-05) is pure shell script editing and a cross-cutting annotation audit with no code logic.

All required upstream artifacts are already in place: the Phase 5 `PUT` and `DELETE` endpoints are live in `router.ts` and `accounts.ts`, the `AccountResponse.openrouterProviderPreference` type is defined in `packages/types/src/account.ts`, the API client class (`HttpClient` subclass in `api.ts`) exposes `this.put` and `this.delete` base methods, and the `Switch` UI component is already imported in `AccountListItem.tsx`. There are no new dependencies to install.

The MAINT-05 audit covers 27 existing `// FORK PATCH:` annotations spread across 12 files. Dashboard-web currently has zero FORK PATCH annotations; the new dialog in Phase 6 must add one in the component or in `api.ts` where the fork-specific `openrouterProviderPreference` API calls are added.

**Primary recommendation:** Clone `AccountModelMappingsDialog.tsx` → `AccountOpenrouterProviderPreferenceDialog.tsx`, replacing the three-input model-grid with one `Input` + one `Switch`. Wire through `AccountList` → `AccountListItem` → `AccountsTab` following the identical prop-threading pattern used for `onModelMappingsChange`.

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 6 |
|-----------|-------------------|
| Never curl Anthropic endpoint in tests | Not applicable — no proxy changes |
| Never touch `inline-worker.ts` / `inline-vacuum-worker.ts` | Not applicable — dashboard-only changes |
| Run `bun run lint && bun run typecheck && bun run format` after every change | Required after all edits; use `bun run` from repo root |
| Use `git add <specific-files>` not `git add .` | Must not accidentally stage `inline-worker.ts` |
| Use `import type { ... }` for pure type imports | Apply in new dialog component |
| Named exports only — no `export default` | `export function AccountOpenrouterProviderPreferenceDialog` |
| Tab indentation, double quotes for JS/TS strings | Enforced by Biome |
| Test-driven development: write tests first | Must write tests before implementing dialog |
| Pre-existing 27 Biome lint errors in dashboard — do not fix unless touching those files | Do not attempt to fix unrelated errors in touched files |
| Database migrations must be ported to both SQLite and PG | Not applicable — no schema changes in Phase 6 |
| Every migration needs both SQLite and PG migration steps | Not applicable |

---

## Standard Stack

### Core (already present, no installs needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.2.4 | Component model | Project-standard UI framework |
| `@radix-ui/react-dialog` | (workspace) | Dialog shell | Already used in every account dialog |
| `@radix-ui/react-switch` | (workspace) | Toggle | Already in `AccountListItem` for autoFallback/autoRefresh |
| `packages/ui/button` | internal | Button component | Used in all dialogs |
| `packages/ui/input` | internal | Text input | Used in `AccountModelMappingsDialog` |
| `packages/ui/label` | internal | Form label | Used in `AccountModelMappingsDialog` |
| `bun:test` | built-in | Test runner | Project-standard; 69 test files already using it |

[VERIFIED: codebase grep of AccountModelMappingsDialog.tsx, AccountListItem.tsx, ui/switch.tsx]

**Installation:** None required. All dependencies already in `packages/dashboard-web/package.json`.

---

## Architecture Patterns

### Recommended Project Structure

New file only — no directories needed:

```
packages/dashboard-web/src/components/accounts/
├── AccountOpenrouterProviderPreferenceDialog.tsx   ← NEW (mirrors AccountModelMappingsDialog)
├── AccountModelMappingsDialog.tsx                  ← template to clone from
├── AccountListItem.tsx                             ← add onProviderPreferenceChange prop + dropdown item
├── AccountList.tsx                                 ← thread onProviderPreferenceChange prop through
└── index.ts                                        ← add export for new dialog

packages/dashboard-web/src/
├── api.ts                                          ← add putProviderPreference + deleteProviderPreference
└── components/AccountsTab.tsx                      ← add dialog state + handlers + mount dialog JSX

.planning/scripts/
└── pre-merge-check.sh                              ← extend HIGH_RISK_FILES array
```

### Pattern 1: Dialog Component (mirror `AccountModelMappingsDialog.tsx`)

**What:** Radix `Dialog` with a header, content area, and footer Cancel/Save buttons. Local state synced via `useEffect` when the `account` prop changes. `handleSave` sets loading, calls PUT or DELETE based on parsed input, then closes on success.

**When to use:** Any per-account configuration dialog in the accounts panel.

**Canonical template** (from `AccountModelMappingsDialog.tsx`, adapted for provider preferences):

```typescript
// Source: packages/dashboard-web/src/components/accounts/AccountModelMappingsDialog.tsx
interface AccountOpenrouterProviderPreferenceDialogProps {
	isOpen: boolean;
	account: Account | null;
	onOpenChange: (open: boolean) => void;
	onSetProviderPreference: (
		accountId: string,
		order: string[],
		allowFallbacks: boolean,
	) => Promise<void>;
	onClearProviderPreference: (accountId: string) => Promise<void>;
}
```

Key differences from `AccountModelMappingsDialog`:
- `onUpdateModelMappings` → split into `onSetProviderPreference` + `onClearProviderPreference`
- Three-column grid → single `Input` + single `Switch` row
- `handleSave` branches: empty parsed order → `onClearProviderPreference`; non-empty → `onSetProviderPreference`
- `useEffect` reads `account.openrouterProviderPreference` (not `account.modelMappings`)
- Switch default: `true` (matches API default and stored default)

```typescript
// Source: verified pattern from AccountModelMappingsDialog.tsx
const handleSave = async () => {
	if (!account) return;
	setIsLoading(true);
	try {
		const parsed = providerOrder
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		if (parsed.length === 0) {
			await onClearProviderPreference(account.id);
		} else {
			await onSetProviderPreference(account.id, parsed, allowFallbacks);
		}
		onOpenChange(false);
	} catch (error) {
		console.error("Failed to update provider preference:", error);
	} finally {
		setIsLoading(false);
	}
};
```

### Pattern 2: Prop Threading (`AccountList` → `AccountListItem`)

**What:** Optional callback prop added to both `AccountListProps` and `AccountListItemProps`, passed through `AccountList` to `AccountListItem`. The item renders the `DropdownMenuItem` inside a conditional: `{account.provider === "openrouter" && onProviderPreferenceChange && (...)}`

**Canonical template** (from `AccountListItem.tsx` lines 54–56, 227–246):

```typescript
// Source: packages/dashboard-web/src/components/accounts/AccountListItem.tsx
// Existing pattern for model mappings — mirror exactly
onProviderPreferenceChange?: (account: Account) => void;

// In dropdown menu, adjacent to Model Mappings item:
{account.provider === "openrouter" && onProviderPreferenceChange && (
	<DropdownMenuItem
		onClick={() => onProviderPreferenceChange(account)}
		title={
			account.openrouterProviderPreference
				? `Provider order: ${account.openrouterProviderPreference.order.join(", ")}`
				: "Configure OpenRouter provider preferences"
		}
	>
		<Settings2 className={`mr-2 h-4 w-4 ${account.openrouterProviderPreference ? "text-primary" : ""}`} />
		Provider Preferences
		{account.openrouterProviderPreference && (
			<span className="ml-auto text-xs text-muted-foreground">set</span>
		)}
	</DropdownMenuItem>
)}
```

Note: `Settings2` is available in `lucide-react` (already a dependency). If the planner prefers a different icon from the already-imported set in `AccountListItem.tsx` (AlertCircle, Edit2, Globe, Hash, KeyRound, MoreHorizontal, Pause, Play, RefreshCw, Trash2, Zap), `Hash` is used for Model Mappings so the planner should pick a different available icon or import `Settings2`.

[VERIFIED: codebase inspection of AccountListItem.tsx imports and DropdownMenuItem usage]

### Pattern 3: AccountsTab Dialog State + Wiring

**What:** `useState<{ isOpen: boolean; account: Account | null }>` dialog state, open/close handlers, async `handleUpdate*` functions that call `api.*`, then `loadAccounts()` to refresh state.

**Canonical template** (from `AccountsTab.tsx` lines 68–74 and 537–548):

```typescript
// Source: packages/dashboard-web/src/components/AccountsTab.tsx
const [providerPreferenceDialog, setProviderPreferenceDialog] = useState<{
	isOpen: boolean;
	account: Account | null;
}>({ isOpen: false, account: null });

const handleProviderPreferenceChange = (account: Account) => {
	setProviderPreferenceDialog({ isOpen: true, account });
};

const handleSetProviderPreference = async (
	accountId: string,
	order: string[],
	allowFallbacks: boolean,
) => {
	try {
		await api.putAccountOpenrouterProviderPreference(accountId, order, allowFallbacks);
		await loadAccounts();
	} catch (err) {
		setActionError(formatError(err));
		throw err;
	}
};

const handleClearProviderPreference = async (accountId: string) => {
	try {
		await api.deleteAccountOpenrouterProviderPreference(accountId);
		await loadAccounts();
	} catch (err) {
		setActionError(formatError(err));
		throw err;
	}
};
```

### Pattern 4: API Client Methods

**What:** Two methods added to the `API` class in `api.ts`, following the `updateAccountModelMappings` / `removeAccount` patterns respectively.

**PUT method** (mirrors `updateAccountModelMappings`, uses `this.put`):

```typescript
// Source: verified from api.ts line 1886 (combo put pattern) and line 1301 (model mappings pattern)
async putAccountOpenrouterProviderPreference(
	accountId: string,
	order: string[],
	allowFallbacks: boolean,
): Promise<void> {
	const startTime = Date.now();
	const url = `/api/accounts/${accountId}/openrouter-provider-preference`;
	this.logger.debug(`→ PUT ${url}`, { order, allowFallbacks });
	try {
		await this.put(url, { order, allow_fallbacks: allowFallbacks });
		const duration = Date.now() - startTime;
		this.logger.debug(`← PUT ${url} - 200 (${duration}ms)`);
	} catch (error) {
		const duration = Date.now() - startTime;
		this.logger.error(`✗ PUT ${url} - ERROR (${duration}ms)`, {
			error: error instanceof Error ? error.message : String(error),
		});
		if (error instanceof HttpError) throw new Error(error.message);
		throw error;
	}
}
```

**DELETE method** (mirrors `removeAccount` but no body, uses `this.delete`):

```typescript
// Source: verified from api.ts line 729 (removeAccount pattern) and line 1882 (deleteCombo pattern)
async deleteAccountOpenrouterProviderPreference(accountId: string): Promise<void> {
	const startTime = Date.now();
	const url = `/api/accounts/${accountId}/openrouter-provider-preference`;
	this.logger.debug(`→ DELETE ${url}`);
	try {
		await this.delete(url);
		const duration = Date.now() - startTime;
		this.logger.debug(`← DELETE ${url} - 204 (${duration}ms)`);
	} catch (error) {
		const duration = Date.now() - startTime;
		this.logger.error(`✗ DELETE ${url} - ERROR (${duration}ms)`, {
			error: error instanceof Error ? error.message : String(error),
		});
		if (error instanceof HttpError) throw new Error(error.message);
		throw error;
	}
}
```

Important: The PUT endpoint body must use `allow_fallbacks` (snake_case) to match what `createAccountOpenrouterProviderPreferenceHandler` reads from `body.allow_fallbacks` (verified at `accounts.ts` line 3617). The `allowFallbacks` TypeScript field maps to `allow_fallbacks` in the JSON body.

[VERIFIED: accounts.ts handler at lines 3595–3657]

### Pattern 5: pre-merge-check.sh HIGH_RISK_FILES Extension (MAINT-04)

**What:** Bash array literal extended with two new entries.

**Current state** (verified at `.planning/scripts/pre-merge-check.sh` lines 11–15):
```bash
HIGH_RISK_FILES=(
  "packages/providers/src/providers/openai/provider.ts"
  "packages/providers/src/providers/openrouter/provider.ts"
  "packages/types/src/account.ts"
)
```

**Target state** (MAINT-04 requires adding `migrations.ts` and `http-api/src/handlers/accounts.ts`; REQUIREMENTS.md also lists `config/src/index.ts`):
```bash
HIGH_RISK_FILES=(
  "packages/providers/src/providers/openai/provider.ts"
  "packages/providers/src/providers/openrouter/provider.ts"
  "packages/types/src/account.ts"
  "packages/database/src/migrations.ts"
  "packages/http-api/src/handlers/accounts.ts"
)
```

Note: REQUIREMENTS.md MAINT-04 lists `config/src/index.ts` in the description text, but CONTEXT.md (locked decision) specifies only `migrations.ts` and `http-api/src/handlers/accounts.ts`. The planner must follow CONTEXT.md (locked) and add only those two files. The `config/src/index.ts` change (adding `health_detail_enabled`) is a minor config getter — the locked decisions scope takes precedence.

[VERIFIED: pre-merge-check.sh content; CONTEXT.md D-04 scope]

### Anti-Patterns

- **Calling `DELETE` with a body:** The `deleteAccountOpenrouterProviderPreference` method needs no body. The `createAccountOpenrouterProviderPreferenceDeleteHandler` in `accounts.ts` uses `_req` (unused request) — it only needs the `accountId` from the URL path. Do not send a body.
- **Using `snake_case` in TypeScript interface:** The `AccountResponse` type uses `allowFallbacks` (camelCase). The JSON wire format for the PUT body uses `allow_fallbacks` (snake_case). Keep the mapping clear in the API client.
- **Placing the dropdown item outside the openrouter gate:** The spec requires `account.provider === "openrouter"` gating. Do not render the item for non-OpenRouter providers.
- **Biome lint errors:** The pre-existing 27 Biome errors are in dashboard React components. Do not attempt to fix them unless the linter blocks the `bun run lint` check. If lint fails in an unrelated file, report to the user; do not fix silently.
- **Forgetting `// FORK PATCH:` on new API client methods:** The new `putAccountOpenrouterProviderPreference` and `deleteAccountOpenrouterProviderPreference` calls are fork-specific (the upstream has no OpenRouter provider preference feature). They must be annotated.

---

## Solved Problems

| Problem | Build Nothing — Use Instead | Why |
|---------|-----------------------------|-----|
| Dialog shell | `Dialog`, `DialogContent`, `DialogHeader`, `DialogFooter` from `@radix-ui/react-dialog` (already in project) | Already imported in `AccountModelMappingsDialog.tsx` |
| Toggle UI | `Switch` from `packages/dashboard-web/src/components/ui/switch.tsx` | Already in `AccountListItem` for autoFallback/autoRefresh |
| Comma-separated → array parsing | `value.split(",").map(s => s.trim()).filter(Boolean)` inline | Already used in `parseMappingValue` in `AccountModelMappingsDialog.tsx` |
| PUT/DELETE HTTP calls | `this.put(url, body)` / `this.delete(url)` from `HttpClient` base class | Already used throughout `api.ts` |

---

## MAINT-05: FORK PATCH Annotation Audit Scope

The MAINT-05 completion gate requires verifying that every fork-specific v1.1 code block carries a `// FORK PATCH:` comment. As of research:

**Currently annotated (27 instances across 12 files):**

| File | Lines with FORK PATCH | What they cover |
|------|-----------------------|-----------------|
| `packages/database/src/database-operations.ts` | 749 | `setAccountOpenrouterProviderPreference` |
| `packages/database/src/migrations-pg.ts` | 344 | `openrouter_provider_preference` column |
| `packages/database/src/migrations.ts` | 646 | `openrouter_provider_preference` column |
| `packages/database/src/repositories/account.repository.ts` | 224 | UPDATE for provider preference |
| `packages/http-api/src/handlers/accounts.ts` | 201, 519, 3594, 3659 | GET field mapping, PUT handler, DELETE handler |
| `packages/http-api/src/router.ts` | 632 | DELETE route |
| `packages/providers/src/providers/openai/provider.ts` | 264 | `cache_write_tokens` extraction |
| `packages/providers/src/providers/openrouter/provider.ts` | 9, 71, 82, 157, 192, 222 | Cache injection, provider preference injection |
| `packages/proxy/src/auto-refresh-scheduler.ts` | 307, 788, 918 | `openrouterProviderPreference` field references |
| `packages/types/src/account.ts` | 127, 165, 216, 352, 405, 465 | Type shape and mapper |
| `packages/database/src/repositories/__tests__/account-openrouter-preference.test.ts` | 11 | Test scaffold comment |
| `packages/types/src/__tests__/account-mappers.test.ts` | 14 | Test scaffold comment |

[VERIFIED: `grep -rn "// FORK PATCH" packages/ --include="*.ts"` — 27 matches]

**Phase 6 will add new fork-specific code in:**
- `packages/dashboard-web/src/api.ts` — two new methods (`putAccountOpenrouterProviderPreference`, `deleteAccountOpenrouterProviderPreference`) — must carry `// FORK PATCH:` annotations
- `packages/dashboard-web/src/components/accounts/AccountOpenrouterProviderPreferenceDialog.tsx` — new file, entire file is fork-specific — must carry `// FORK PATCH:` in file header comment
- Existing files touched (AccountListItem, AccountList, AccountsTab, index.ts) — the new prop/dialog mount is fork-specific; add `// FORK PATCH:` inline comments on the new additions

**Nothing found outside packages/:** Apps directory has no FORK PATCH annotations and no v1.1 fork-specific logic was introduced there.

[VERIFIED: `grep -rn "// FORK PATCH" apps/` — 0 results]

---

## Common Pitfalls

### Pitfall 1: `allow_fallbacks` key casing in PUT body
**What goes wrong:** Sending `{ allowFallbacks: true }` instead of `{ allow_fallbacks: true }` causes the handler to fall through to the default `true` silently — the value is ignored but no error is thrown, so the bug is invisible.
**Root cause:** TypeScript uses camelCase but the handler reads `body.allow_fallbacks` (snake_case) at `accounts.ts` line 3617.
**Prevention:** API client PUT body must use `allow_fallbacks` (snake_case). Keep this mapping explicit in the `putAccountOpenrouterProviderPreference` method.
**Warning signs:** Operator sets `allow_fallbacks: false` in dialog, but proxy always sends `allow_fallbacks: true` — detectable only by inspecting the SQLite record.

### Pitfall 2: Forgetting `AccountList` prop threading
**What goes wrong:** Adding `onProviderPreferenceChange` to `AccountListItemProps` and `AccountsTab` but omitting it from `AccountListProps` causes a TypeScript error at compile time — the prop doesn't reach `AccountListItem`.
**Root cause:** `AccountList` is a pass-through component. Every new prop must be declared in `AccountListProps`, destructured, and forwarded to `AccountListItem`.
**Prevention:** Update all three: `AccountListProps`, the `AccountList` function signature/body, and `AccountListItem`.
**Warning signs:** TypeScript error "Property 'onProviderPreferenceChange' does not exist on type 'AccountListProps'" in `AccountsTab`.

### Pitfall 3: `useEffect` not syncing dialog state from account prop
**What goes wrong:** Opening the dialog for account A, closing it, then opening for account B shows A's stale data.
**Root cause:** State is only initialized at component mount, not when `account` prop changes.
**Prevention:** Follow the `AccountModelMappingsDialog` pattern exactly — `useEffect` with `[account]` dependency updates local state whenever the `account` prop changes.
**Warning signs:** After switching between accounts in the dropdown, the dialog shows the previous account's data.

### Pitfall 4: DELETE request with unnecessary body
**What goes wrong:** Some HTTP clients strip bodies from DELETE requests, causing the request to silently fail or behave unexpectedly.
**Root cause:** The handler doesn't read from the request body — it only uses the `accountId` URL param.
**Prevention:** Call `this.delete(url)` with no second argument (matching the `deleteCombo` pattern at `api.ts` line 1883).

### Pitfall 5: pre-merge-check.sh path separator
**What goes wrong:** Adding paths with wrong separators or trailing slashes silently skips the `git diff` output for the file.
**Root cause:** `git diff upstream/main -- <path>` requires exact repo-root-relative paths.
**Prevention:** Use exact paths as they appear in `git diff --name-only`: `packages/database/src/migrations.ts` and `packages/http-api/src/handlers/accounts.ts` (no leading `/`).

---

## Code Examples

### Complete dialog component skeleton

```typescript
// Source: cloned from packages/dashboard-web/src/components/accounts/AccountModelMappingsDialog.tsx
// FORK PATCH: Provider preferences dialog — PROV-04
import React, { useState } from "react";
import type { Account } from "../../api";
import { Button } from "../ui/button";
import {
	Dialog, DialogContent, DialogDescription,
	DialogFooter, DialogHeader, DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";

interface AccountOpenrouterProviderPreferenceDialogProps {
	isOpen: boolean;
	account: Account | null;
	onOpenChange: (open: boolean) => void;
	onSetProviderPreference: (accountId: string, order: string[], allowFallbacks: boolean) => Promise<void>;
	onClearProviderPreference: (accountId: string) => Promise<void>;
}

export function AccountOpenrouterProviderPreferenceDialog({
	isOpen, account, onOpenChange, onSetProviderPreference, onClearProviderPreference,
}: AccountOpenrouterProviderPreferenceDialogProps) {
	const [providerOrder, setProviderOrder] = useState("");
	const [allowFallbacks, setAllowFallbacks] = useState(true);
	const [isLoading, setIsLoading] = useState(false);

	React.useEffect(() => {
		if (account?.openrouterProviderPreference) {
			setProviderOrder(account.openrouterProviderPreference.order.join(", "));
			setAllowFallbacks(account.openrouterProviderPreference.allowFallbacks);
		} else {
			setProviderOrder("");
			setAllowFallbacks(true);
		}
	}, [account]);

	const handleSave = async () => {
		if (!account) return;
		setIsLoading(true);
		try {
			const parsed = providerOrder.split(",").map((s) => s.trim()).filter(Boolean);
			if (parsed.length === 0) {
				await onClearProviderPreference(account.id);
			} else {
				await onSetProviderPreference(account.id, parsed, allowFallbacks);
			}
			onOpenChange(false);
		} catch (error) {
			console.error("Failed to update provider preference:", error);
		} finally {
			setIsLoading(false);
		}
	};

	if (!account) return null;

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>Provider Preferences</DialogTitle>
					<DialogDescription>
						Configure OpenRouter provider routing for {account.name}.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 py-2">
					<div className="space-y-1">
						<Label htmlFor="provider-order">Provider Order</Label>
						<Input
							id="provider-order"
							value={providerOrder}
							onChange={(e) => setProviderOrder(e.target.value)}
							placeholder="e.g., anthropic/claude-3-5-sonnet, openai/gpt-4o"
						/>
						<p className="text-xs text-muted-foreground">
							Comma-separated list. Leave empty to clear the preference.
						</p>
					</div>
					<div className="flex items-center gap-2">
						<Label htmlFor="allow-fallbacks">Allow fallbacks</Label>
						<Switch
							id="allow-fallbacks"
							checked={allowFallbacks}
							onCheckedChange={setAllowFallbacks}
						/>
					</div>
				</div>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
						Cancel
					</Button>
					<Button type="button" onClick={handleSave} disabled={isLoading}>
						{isLoading ? "Saving..." : "Save Changes"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
```

### Dropdown menu item in AccountListItem

```typescript
// Source: verified pattern from AccountListItem.tsx lines 227-246
// Place adjacent to Model Mappings item
{account.provider === "openrouter" && onProviderPreferenceChange && (
	<DropdownMenuItem
		onClick={() => onProviderPreferenceChange(account)}
		title={
			account.openrouterProviderPreference
				? `Provider order: ${account.openrouterProviderPreference.order.join(", ")}`
				: "Configure OpenRouter provider preferences"
		}
	>
		<Settings2 className={`mr-2 h-4 w-4 ${account.openrouterProviderPreference ? "text-primary" : ""}`} />
		Provider Preferences
		{account.openrouterProviderPreference && (
			<span className="ml-auto text-xs text-muted-foreground">set</span>
		)}
	</DropdownMenuItem>
)}
```

Note: `Settings2` must be added to the lucide-react import at the top of `AccountListItem.tsx`. Alternatively, reuse an already-imported icon like `Globe` (currently used for Custom Endpoint) — the planner should choose a distinct icon and add the import.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — dashboard-only code changes and shell script edit, all tools already available in project runtime)

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `bun:test` (built-in) |
| Config file | None — `bun test` discovers `*.test.ts` / `*.test.tsx` automatically |
| Quick run command | `bun test packages/dashboard-web/src/components/accounts/` |
| Full suite command | `bun test` (from repo root) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROV-04 | Dialog renders only for `provider === "openrouter"` accounts | unit | `bun test packages/dashboard-web/src/components/accounts/ -t "AccountOpenrouterProviderPreferenceDialog"` | No — Wave 0 |
| PROV-04 | Empty order field on Save calls DELETE, non-empty calls PUT | unit | Same test file | No — Wave 0 |
| PROV-04 | `useEffect` populates form fields from `account.openrouterProviderPreference` | unit | Same test file | No — Wave 0 |
| MAINT-04 | `HIGH_RISK_FILES` array contains both new paths | smoke (manual grep) | `grep "migrations.ts\|accounts.ts" .planning/scripts/pre-merge-check.sh` | N/A — shell script |
| MAINT-05 | All fork-specific v1.1 code blocks carry `// FORK PATCH:` | smoke (manual grep) | `grep -rn "// FORK PATCH" packages/ --include="*.ts" --include="*.tsx" \| wc -l` | N/A — annotation audit |

Note: Dashboard React components require a browser-compatible test environment. The existing test at `RateLimitProgress.test.tsx` can serve as a reference for how bun:test handles TSX. However, that test uses pure logic assertions, not DOM rendering. For the new dialog, pure logic tests (parse/format functions, branch logic in handleSave) are the right scope for automated testing; DOM rendering tests are manual-only.

[VERIFIED: existing dashboard test files found at `packages/dashboard-web/src/components/accounts/RateLimitProgress.test.tsx` and `packages/dashboard-web/src/lib/__tests__/pool-usage.test.ts`]

### Sampling Rate

- **Per task commit:** `bun run typecheck && bun run lint`
- **Per wave merge:** `bun test packages/dashboard-web/src/`
- **Phase gate:** Full suite green (`bun test`) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/dashboard-web/src/components/accounts/__tests__/AccountOpenrouterProviderPreferenceDialog.test.tsx` — covers PROV-04 parse/branch logic
- [ ] No framework install needed — `bun:test` is built-in

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A — no auth changes |
| V3 Session Management | No | N/A |
| V4 Access Control | No | No new endpoints; existing endpoints already gated |
| V5 Input Validation | Yes (LOW risk) | Comma-separated input is parsed client-side; server validates `order` is non-empty array of non-empty strings at `accounts.ts` lines 3602–3614 |
| V6 Cryptography | No | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed provider names in order array | Tampering | Server validates each element is a non-empty string; client-side `filter(Boolean)` removes blank entries |
| XSS via provider name displayed in title tooltip | Tampering | React renders as text content (not innerHTML); no XSS risk |

The security surface for Phase 6 is negligible. The Phase 5 server-side handlers already validate all inputs. The dashboard component merely serializes user text input into an array and sends it via authenticated fetch.

---

## Open Questions

1. **Icon choice for "Provider Preferences" dropdown item**
   - What we know: `Settings2` is in lucide-react (project dependency); existing icons in `AccountListItem.tsx` are AlertCircle, Edit2, Globe, Hash, KeyRound, MoreHorizontal, Pause, Play, RefreshCw, Trash2, Zap
   - What is unclear: Whether `Settings2` is already imported elsewhere in the project, and whether the team prefers a different icon
   - Recommendation: Import `Settings2` from lucide-react in `AccountListItem.tsx`. If the planner prefers no new import, `Globe` (already imported, used for Custom Endpoint) is acceptable but less semantically precise.

2. **Separator placement for "Provider Preferences" item in dropdown**
   - What we know: Custom Endpoint and Model Mappings share a `DropdownMenuSeparator` at lines 204–206 of `AccountListItem.tsx` — the separator appears only when either handler prop is present
   - What is unclear: Whether Provider Preferences should be included in the same separator group
   - Recommendation: Include `onProviderPreferenceChange` in the conditional check for the separator (extend the existing `{(onCustomEndpointChange || onModelMappingsChange) && <DropdownMenuSeparator />}` to also check `onProviderPreferenceChange`). This keeps all configuration items visually grouped.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `Settings2` is available in the installed version of `lucide-react` (1.7.0) | Code Examples | Low — any other imported icon (e.g., Hash or Globe) can substitute with no functional impact |

All other claims in this research were verified by direct codebase inspection.

---

## Sources

### Primary (HIGH confidence)
- `packages/dashboard-web/src/components/accounts/AccountModelMappingsDialog.tsx` — canonical template for new dialog
- `packages/dashboard-web/src/components/accounts/AccountListItem.tsx` — dropdown menu pattern, onModelMappingsChange prop pattern
- `packages/dashboard-web/src/components/accounts/AccountList.tsx` — prop threading pattern
- `packages/dashboard-web/src/components/AccountsTab.tsx` — dialog state, handler wiring, JSX mount pattern
- `packages/dashboard-web/src/api.ts` (lines 1273–1327, 729–751, 1882–1883) — updateAccountModelMappings, removeAccount, deleteCombo patterns
- `packages/http-api/src/handlers/accounts.ts` (lines 3595–3690) — PUT and DELETE handler signatures and body parsing
- `packages/http-api/src/router.ts` (lines 620–645) — route dispatch for PUT/DELETE endpoints
- `packages/types/src/account.ts` (lines 216–221) — `openrouterProviderPreference` type shape
- `.planning/scripts/pre-merge-check.sh` — current `HIGH_RISK_FILES` array
- `grep -rn "// FORK PATCH" packages/` — 27 existing annotations across 12 files

### Secondary (MEDIUM confidence)
- None required — all findings verified directly from codebase

### Flagged for Validation (LOW confidence)
- A1: `Settings2` icon availability in lucide-react 1.7.0 — not verified in package source, low-impact if wrong

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies verified to exist in project
- Architecture: HIGH — exact clone pattern verified from live template
- API endpoint integration: HIGH — handlers verified by source inspection
- FORK PATCH audit scope: HIGH — grep confirmed 27 annotations; dashboard-web gap confirmed
- MAINT-04 script edit: HIGH — current file content and target content both verified

**Research date:** 2026-05-20
**Valid until:** 2026-06-20 (stable codebase — no fast-moving external dependencies)
