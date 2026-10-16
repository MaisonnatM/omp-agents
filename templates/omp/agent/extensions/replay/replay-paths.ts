export function normalizeRoots(text: string, roots: readonly string[]): string {
	// Escape literal NULs so inserted normalization tags cannot alias model input.
	text = text.replaceAll("\0", "\0\0");
	for (const root of [...new Set(roots)].sort((a, b) => b.length - a.length)) {
		const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		text = text.replace(new RegExp(`(^|[^\\w/.-])${escaped}(?=$|[\\s/\\\\\"'<>:;,)}\\]])`, "g"), "$1\0<root>");
	}
	return text;
}
