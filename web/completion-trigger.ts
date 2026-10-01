export function completionTrigger(text: string, cursor: number): "slash" | "mention" | null {
	const before = text.slice(0, cursor);
	const line = before.slice(before.lastIndexOf("\n") + 1);
	if (/(?:^|\s)@(?:"[^"]*|[^\s]*)$/.test(line)) return "mention";
	if (/(?:^|\s)\/[^\s]*$/.test(line)) return "slash";
	return null;
}
