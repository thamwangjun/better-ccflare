// FORK PATCH: Provider preferences dialog — PROV-04
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
import { Switch } from "../ui/switch";

export function parseProviderOrder(input: string): string[] {
	return input
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

export function resolveProviderPreferenceSaveAction(
	parsed: string[],
): "set" | "clear" {
	return parsed.length === 0 ? "clear" : "set";
}

export function syncProviderPreferenceState(account: Account | null): {
	providerOrder: string;
	allowFallbacks: boolean;
} {
	if (!account || !account.openrouterProviderPreference) {
		return { providerOrder: "", allowFallbacks: true };
	}
	return {
		providerOrder: account.openrouterProviderPreference.order.join(", "),
		allowFallbacks: account.openrouterProviderPreference.allowFallbacks,
	};
}

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

export function AccountOpenrouterProviderPreferenceDialog({
	isOpen,
	account,
	onOpenChange,
	onSetProviderPreference,
	onClearProviderPreference,
}: AccountOpenrouterProviderPreferenceDialogProps) {
	const [providerOrder, setProviderOrder] = useState("");
	const [allowFallbacks, setAllowFallbacks] = useState(true);
	const [isLoading, setIsLoading] = useState(false);

	React.useEffect(() => {
		const state = syncProviderPreferenceState(account);
		setProviderOrder(state.providerOrder);
		setAllowFallbacks(state.allowFallbacks);
	}, [account]);

	const handleSave = async () => {
		if (!account) return;

		setIsLoading(true);
		try {
			const parsed = parseProviderOrder(providerOrder);
			const action = resolveProviderPreferenceSaveAction(parsed);
			if (action === "clear") {
				await onClearProviderPreference(account.id);
			} else {
				await onSetProviderPreference(account.id, parsed, allowFallbacks);
			}
			onOpenChange(false);
		} catch (error) {
			console.error("Failed to save provider preference:", error);
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
				<DialogFooter className="mt-2 shrink-0">
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={isLoading}
					>
						Discard Changes
					</Button>
					<Button type="button" onClick={handleSave} disabled={isLoading}>
						{isLoading ? "Saving..." : "Save Changes"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
