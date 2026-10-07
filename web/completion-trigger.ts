/**
 * The `@` token that ends at the caret, at a line start or after a space, so `email@example.com` holds none. `body` is
 * what follows the `@`: `src/`, `ticket:login`, or a quoted `"file with space` or `ticket:"login page`.
 */
export function mentionToken(text: string, cursor: number): { start: number; body: string } | null {
	const before = text.slice(0, cursor);
	const match = /(?:^|\s)@((?:[a-z]+:)?"[^"]*|[^\s]*)$/.exec(before.slice(before.lastIndexOf("\n") + 1));
	return match ? { start: cursor - match[1].length - 1, body: match[1] } : null;
}

export function completionTrigger(text: string, cursor: number): "slash" | "mention" | null {
	if (mentionToken(text, cursor)) return "mention";
	const before = text.slice(0, cursor);
	const line = before.slice(before.lastIndexOf("\n") + 1);
	if (/(?:^|\s)\/[^\s]*$/.test(line)) return "slash";
	return null;
}
