import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export const ETRANSFER_EMAIL = "kevingeng33@gmail.com";

// Builds the copy-paste reminder sent to a player who owes money.
// `runLines` are pre-formatted bullet lines, one per unpaid run — pass an empty
// array where the per-run breakdown isn't available and the total stands alone.
export function buildOwedReminder(balance: number, runLines: string[]): string {
	const owed = `$${Math.abs(balance).toFixed(2)}`;
	const signoff = "if this is incorrect lmk tyty";

	if (runLines.length === 0) {
		return `Hey, you owe me ${owed}. ${signoff}`;
	}

	return [`Hey, you owe me ${owed} from:`, "", ...runLines, "", signoff].join(
		"\n",
	);
}
