# Phase 6: Dashboard UI & Maintenance Hardening - Pattern Map

**Mapped:** 2026-05-21
**Files analyzed:** 7 new/modified files
**Analogs found:** 7 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/dashboard-web/src/components/accounts/AccountOpenrouterProviderPreferenceDialog.tsx` | component | request-response | `packages/dashboard-web/src/components/accounts/AccountModelMappingsDialog.tsx` | exact |
| `packages/dashboard-web/src/components/accounts/AccountListItem.tsx` | component | event-driven | `packages/dashboard-web/src/components/accounts/AccountListItem.tsx` (self — extend) | exact |
| `packages/dashboard-web/src/components/accounts/AccountList.tsx` | component | request-response | `packages/dashboard-web/src/components/accounts/AccountList.tsx` (self — extend) | exact |
| `packages/dashboard-web/src/components/AccountsTab.tsx` | component | request-response | `packages/dashboard-web/src/components/AccountsTab.tsx` (self — extend) | exact |
| `packages/dashboard-web/src/api.ts` | service | request-response | `packages/dashboard-web/src/api.ts` — `updateAccountModelMappings` / `removeAccount` (self — extend) | exact |
| `packages/dashboard-web/src/components/accounts/index.ts` | config | — | `packages/dashboard-web/src/components/accounts/index.ts` (self — extend) | exact |
| `.planning/scripts/pre-merge-check.sh` | config | — | `.planning/scripts/pre-merge-check.sh` (self — extend) | exact |

---

## Pattern Assignments

### `AccountOpenrouterProviderPreferenceDialog.tsx` (component, request-response)

**Analog:** `packages/dashboard-web/src/components/accounts/AccountModelMappingsDialog.tsx`

**Imports pattern** (lines 1–18):
```typescript
import React, { useState } from "react";
import type { Account } from "../../api";
import { Button } from "../ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
// Add for new dialog only:
import { Switch } from "../ui/switch";
```

**Props interface pattern** (lines 20–28):
```typescript
interface AccountModelMappingsDialogProps {
	isOpen: boolean;
	account: Account | null;
	onOpenChange: (open: boolean) => void;
	onUpdateModelMappings: (
		accountId: string,
		modelMappings: { [key: string]: string | string[] },
	) => Promise<void>;
}
```
For new dialog, split the single callback into two:
```typescript
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

**`useEffect` sync pattern** (lines 62–76):
```typescript
// Update form when account changes
React.useEffect(() => {
	if (account?.modelMappings) {
		setModelMappings({
			opus: formatMappingValue(account.modelMappings.opus || ""),
			sonnet: formatMappingValue(account.modelMappings.sonnet || ""),
			haiku: formatMappingValue(account.modelMappings.haiku || ""),
		});
	} else {
		setModelMappings({ opus: "", sonnet: "", haiku: "" });
	}
}, [account]);
```
For new dialog, replace with:
```typescript
React.useEffect(() => {
	if (account?.openrouterProviderPreference) {
		setProviderOrder(account.openrouterProviderPreference.order.join(", "));
		setAllowFallbacks(account.openrouterProviderPreference.allowFallbacks);
	} else {
		setProviderOrder("");
		setAllowFallbacks(true);
	}
}, [account]);
```

**`handleSave` pattern with empty→DELETE branch** (lines 78–99):
```typescript
const handleSave = async () => {
	if (!account) return;
	setIsLoading(true);
	try {
		const mappingsToSend: { [key: string]: string | string[] } = {};
		// ... parse inputs ...
		await onUpdateModelMappings(account.id, mappingsToSend);
		onOpenChange(false);
	} catch (error) {
		console.error("Failed to update model mappings:", error);
	} finally {
		setIsLoading(false);
	}
};
```
For new dialog, branch on empty parsed order:
```typescript
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

**Early-return guard pattern** (line 111):
```typescript
if (!account) return null;
```

**Dialog JSX shell pattern** (lines 113–189):
```typescript
return (
	<Dialog open={isOpen} onOpenChange={onOpenChange}>
		<DialogContent className="sm:max-w-[600px] flex flex-col max-h-[85vh]">
			<DialogHeader>
				<DialogTitle>Edit Model Configuration</DialogTitle>
				<DialogDescription>...</DialogDescription>
			</DialogHeader>
			<div className="space-y-4 py-2 overflow-y-auto flex-1">
				{/* inputs */}
			</div>
			<DialogFooter className="mt-2 shrink-0">
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
```
New dialog uses `sm:max-w-[500px]` (smaller — two controls only). Replace the 3-column grid with:
```typescript
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
```

**FORK PATCH annotation:** Add `// FORK PATCH: Provider preferences dialog (PROV-04)` as a comment at the top of the file, below the imports block.

---

### `AccountListItem.tsx` (component, event-driven) — modify existing

**Analog:** `packages/dashboard-web/src/components/accounts/AccountListItem.tsx` (self)

**Existing optional prop pattern** (lines 55–59):
```typescript
onCustomEndpointChange?: (account: Account) => void;
onModelMappingsChange?: (account: Account) => void;
onReauth?: (account: Account) => void;
```
Add after `onModelMappingsChange`:
```typescript
onProviderPreferenceChange?: (account: Account) => void;
```

**Existing destructure pattern** (lines 76–80):
```typescript
onCustomEndpointChange,
onModelMappingsChange,
onReauth,
onAnthropicReauth,
onCodexReauth,
```
Add `onProviderPreferenceChange` to this destructure list.

**Existing separator gate pattern** (lines 204–206):
```typescript
{(onCustomEndpointChange || onModelMappingsChange) && (
	<DropdownMenuSeparator />
)}
```
Extend to include new prop:
```typescript
{(onCustomEndpointChange || onModelMappingsChange || onProviderPreferenceChange) && (
	<DropdownMenuSeparator />
)}
```

**Existing `onModelMappingsChange` dropdown item pattern** (lines 227–246):
```typescript
{onModelMappingsChange && (
	<DropdownMenuItem
		onClick={() => onModelMappingsChange(account)}
		title={
			account.modelMappings
				? `Model mappings configured (${Object.keys(account.modelMappings).length} mappings)`
				: "Configure model mappings"
		}
	>
		<Hash
			className={`mr-2 h-4 w-4 ${account.modelMappings ? "text-primary" : ""}`}
		/>
		Model Mappings
		{account.modelMappings && (
			<span className="ml-auto text-xs text-muted-foreground">
				{Object.keys(account.modelMappings).length}
			</span>
		)}
	</DropdownMenuItem>
)}
```
Add immediately after this block:
```typescript
{/* FORK PATCH: Provider preferences dropdown item (PROV-04) */}
{account.provider === "openrouter" && onProviderPreferenceChange && (
	<DropdownMenuItem
		onClick={() => onProviderPreferenceChange(account)}
		title={
			account.openrouterProviderPreference
				? `Provider order: ${account.openrouterProviderPreference.order.join(", ")}`
				: "Configure OpenRouter provider preferences"
		}
	>
		<Settings2
			className={`mr-2 h-4 w-4 ${account.openrouterProviderPreference ? "text-primary" : ""}`}
		/>
		Provider Preferences
		{account.openrouterProviderPreference && (
			<span className="ml-auto text-xs text-muted-foreground">set</span>
		)}
	</DropdownMenuItem>
)}
```
Add `Settings2` to the lucide-react import at line 2–14.

---

### `AccountList.tsx` (component, request-response) — modify existing

**Analog:** `packages/dashboard-web/src/components/accounts/AccountList.tsx` (self)

**Existing optional prop declaration pattern** (lines 17–18):
```typescript
onCustomEndpointChange?: (account: Account) => void;
onModelMappingsChange?: (account: Account) => void;
```
Add after `onModelMappingsChange`:
```typescript
onProviderPreferenceChange?: (account: Account) => void;
```

**Existing destructure + forward pattern** (lines 37–38, 82–83):
```typescript
// destructure
onCustomEndpointChange,
onModelMappingsChange,

// forward to AccountListItem
onCustomEndpointChange={onCustomEndpointChange}
onModelMappingsChange={onModelMappingsChange}
```
Add `onProviderPreferenceChange` in both places.

---

### `AccountsTab.tsx` (component, request-response) — modify existing

**Analog:** `packages/dashboard-web/src/components/AccountsTab.tsx` (self)

**Existing dialog state pattern** (lines 68–74):
```typescript
const [modelMappingsDialog, setModelMappingsDialog] = useState<{
	isOpen: boolean;
	account: Account | null;
}>({
	isOpen: false,
	account: null,
});
```
Copy this shape exactly for the new dialog state:
```typescript
// FORK PATCH: Provider preferences dialog state (PROV-04)
const [providerPreferenceDialog, setProviderPreferenceDialog] = useState<{
	isOpen: boolean;
	account: Account | null;
}>({
	isOpen: false,
	account: null,
});
```

**Existing open handler pattern** (lines 496–498):
```typescript
const handleModelMappingsChange = (account: Account) => {
	setModelMappingsDialog({ isOpen: true, account });
};
```
Mirror:
```typescript
// FORK PATCH: (PROV-04)
const handleProviderPreferenceChange = (account: Account) => {
	setProviderPreferenceDialog({ isOpen: true, account });
};
```

**Existing async handler with loadAccounts + setActionError pattern** (lines 537–548):
```typescript
const handleUpdateModelMappings = async (
	accountId: string,
	modelMappings: { [key: string]: string | string[] },
) => {
	try {
		await api.updateAccountModelMappings(accountId, modelMappings);
		await loadAccounts();
	} catch (err) {
		setActionError(formatError(err));
		throw err;
	}
};
```
Mirror for PUT and DELETE:
```typescript
// FORK PATCH: (PROV-04)
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

**Existing AccountList prop pass pattern** (line 634):
```typescript
onModelMappingsChange={handleModelMappingsChange}
```
Add alongside:
```typescript
onProviderPreferenceChange={handleProviderPreferenceChange}
```

**Existing dialog mount pattern** (lines 701–712):
```typescript
{modelMappingsDialog.isOpen && modelMappingsDialog.account && (
	<AccountModelMappingsDialog
		isOpen={modelMappingsDialog.isOpen}
		account={modelMappingsDialog.account}
		onOpenChange={(open) =>
			setModelMappingsDialog({
				isOpen: open,
				account: open ? modelMappingsDialog.account : null,
			})
		}
		onUpdateModelMappings={handleUpdateModelMappings}
	/>
)}
```
Mirror for new dialog:
```typescript
{/* FORK PATCH: (PROV-04) */}
{providerPreferenceDialog.isOpen && providerPreferenceDialog.account && (
	<AccountOpenrouterProviderPreferenceDialog
		isOpen={providerPreferenceDialog.isOpen}
		account={providerPreferenceDialog.account}
		onOpenChange={(open) =>
			setProviderPreferenceDialog({
				isOpen: open,
				account: open ? providerPreferenceDialog.account : null,
			})
		}
		onSetProviderPreference={handleSetProviderPreference}
		onClearProviderPreference={handleClearProviderPreference}
	/>
)}
```
Also add `AccountOpenrouterProviderPreferenceDialog` to the import from `"./accounts"` (line 10 area).

---

### `packages/dashboard-web/src/api.ts` — modify existing

**Analog:** `packages/dashboard-web/src/api.ts` — `updateAccountModelMappings` (lines 1301–1327) and `removeAccount` (lines 729–752)

**PUT method — copy `updateAccountModelMappings` pattern** (lines 1301–1327):
```typescript
async updateAccountModelMappings(
	accountId: string,
	modelMappings: { [key: string]: string | string[] },
): Promise<void> {
	const startTime = Date.now();
	const url = `/api/accounts/${accountId}/model-mappings`;
	this.logger.debug(`→ POST ${url}`, { modelMappings });
	try {
		await this.post(url, { modelMappings });
		const duration = Date.now() - startTime;
		this.logger.debug(`← POST ${url} - 200 (${duration}ms)`);
	} catch (error) {
		const duration = Date.now() - startTime;
		this.logger.error(`✗ POST ${url} - ERROR (${duration}ms)`, {
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});
		if (error instanceof HttpError) {
			throw new Error(error.message);
		}
		throw error;
	}
}
```
New PUT method differs: uses `this.put` instead of `this.post`, different URL, different body shape. Note `allow_fallbacks` (snake_case) in the JSON body:
```typescript
// FORK PATCH: OpenRouter provider preference API methods (PROV-04)
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
			stack: error instanceof Error ? error.stack : undefined,
		});
		if (error instanceof HttpError) throw new Error(error.message);
		throw error;
	}
}
```

**DELETE method — copy `removeAccount` pattern without body** (lines 729–752 minus body):
The `deleteCombo` at line 1882 shows the no-body DELETE form: `await this.delete(url)`. Full method:
```typescript
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
			stack: error instanceof Error ? error.stack : undefined,
		});
		if (error instanceof HttpError) throw new Error(error.message);
		throw error;
	}
}
```

---

### `packages/dashboard-web/src/components/accounts/index.ts` — modify existing

**Analog:** `packages/dashboard-web/src/components/accounts/index.ts` (self, lines 1–12)

**Existing export pattern** (line 5):
```typescript
export { AccountModelMappingsDialog } from "./AccountModelMappingsDialog";
```
Add alongside:
```typescript
export { AccountOpenrouterProviderPreferenceDialog } from "./AccountOpenrouterProviderPreferenceDialog";
```

---

### `.planning/scripts/pre-merge-check.sh` — modify existing

**Analog:** `.planning/scripts/pre-merge-check.sh` (self, lines 11–15)

**Current state** (lines 11–15):
```bash
HIGH_RISK_FILES=(
  "packages/providers/src/providers/openai/provider.ts"
  "packages/providers/src/providers/openrouter/provider.ts"
  "packages/types/src/account.ts"
)
```
**Target state** (add two entries per MAINT-04 / CONTEXT.md D-04):
```bash
HIGH_RISK_FILES=(
  "packages/providers/src/providers/openai/provider.ts"
  "packages/providers/src/providers/openrouter/provider.ts"
  "packages/types/src/account.ts"
  "packages/database/src/migrations.ts"
  "packages/http-api/src/handlers/accounts.ts"
)
```
No other lines in the script change. Paths must be exact repo-root-relative (no leading `/`).

---

## Shared Patterns

### Dialog State Shape
**Source:** `packages/dashboard-web/src/components/AccountsTab.tsx` lines 68–74
**Apply to:** `AccountsTab.tsx` new dialog state
```typescript
useState<{ isOpen: boolean; account: Account | null }>({ isOpen: false, account: null })
```

### Async Handler with Error Propagation
**Source:** `packages/dashboard-web/src/components/AccountsTab.tsx` lines 537–548
**Apply to:** `handleSetProviderPreference`, `handleClearProviderPreference`
```typescript
try {
	await api.<method>(...);
	await loadAccounts();
} catch (err) {
	setActionError(formatError(err));
	throw err;  // re-throw so dialog can catch it and keep isLoading false
}
```

### API Method Logging Template
**Source:** `packages/dashboard-web/src/api.ts` lines 1273–1298
**Apply to:** Both new api.ts methods
```typescript
const startTime = Date.now();
this.logger.debug(`→ VERB ${url}`, { ...params });
try {
	await this.verb(url, body);
	this.logger.debug(`← VERB ${url} - STATUS (${Date.now() - startTime}ms)`);
} catch (error) {
	this.logger.error(`✗ VERB ${url} - ERROR (${Date.now() - startTime}ms)`, {
		error: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined,
	});
	if (error instanceof HttpError) throw new Error(error.message);
	throw error;
}
```

### FORK PATCH Annotation
**Source:** `packages/dashboard-web/src/api.ts` (to be added), `packages/http-api/src/handlers/accounts.ts` line 3594 (existing example)
**Apply to:** All new fork-specific code blocks in Phase 6
```typescript
// FORK PATCH: <feature description> (<requirement ID>)
```
Required locations: new dialog file header, new dropdown item in `AccountListItem`, new dialog state/handlers in `AccountsTab`, new API methods in `api.ts`.

### Named Export, No Default
**Source:** `packages/dashboard-web/src/components/accounts/AccountModelMappingsDialog.tsx` line 44
**Apply to:** New dialog component
```typescript
export function AccountOpenrouterProviderPreferenceDialog(...) { ... }
// NOT: export default function ...
```

### `import type` for Pure Type Imports
**Source:** `packages/dashboard-web/src/components/accounts/AccountModelMappingsDialog.tsx` line 7
**Apply to:** New dialog component
```typescript
import type { Account } from "../../api";
```

---

## No Analog Found

None — all files have exact analogs in the codebase.

---

## Test Analog

**Existing test to reference for structure:**
`packages/dashboard-web/src/components/accounts/RateLimitProgress.test.tsx` — pure logic assertions (no DOM rendering), `bun:test` built-in runner, co-located with source.

New test file: `packages/dashboard-web/src/components/accounts/__tests__/AccountOpenrouterProviderPreferenceDialog.test.tsx`
- Test the `parseMappingValue`-equivalent parse logic (split/trim/filter)
- Test `handleSave` branching: empty order → DELETE path, non-empty → PUT path
- No DOM rendering needed — logic-only assertions

---

## Metadata

**Analog search scope:** `packages/dashboard-web/src/components/accounts/`, `packages/dashboard-web/src/components/AccountsTab.tsx`, `packages/dashboard-web/src/api.ts`, `.planning/scripts/`
**Files read:** 7 analog files
**Pattern extraction date:** 2026-05-21
