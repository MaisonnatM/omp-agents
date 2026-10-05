import { useEffect, useState } from "react";

/** Copies text to the clipboard; `copied` stays true for 1.5 seconds after a copy lands, for a button's check mark. */
export function useCopy(): { copied: boolean; copy: (text: string) => void } {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);
	return { copied, copy: text => void navigator.clipboard.writeText(text).then(() => setCopied(true)) };
}
