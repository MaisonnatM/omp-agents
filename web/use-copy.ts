import { useEffect, useState } from "react";
import { type Action, useAction } from "./use-action";

/** Copies text to the clipboard, resolving once it lands; `copied` stays true for 1.5 seconds after a copy lands, for a button's check mark. */
export function useCopy(): { copied: boolean; copy: (text: string) => Promise<void> } {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);
	return { copied, copy: text => navigator.clipboard.writeText(text).then(() => setCopied(true)) };
}

/** Copies text to the clipboard through `run`, with a toast when the copy fails, for a menu item or a shortcut that shows no check mark. */
export function useClipboard(): Action<[text: string]> {
	return useAction(async (text: string) => { await navigator.clipboard.writeText(text); }, "Could not copy");
}
