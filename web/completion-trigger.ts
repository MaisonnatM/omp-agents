/** The `@` token that ends at the caret: `@src/`, `@ticket:login`, or a quoted `@"file with space` or `@ticket:"login page`. */
export interface MentionToken {
	/** Where the `@` is. */
	start: number;
	/** The caret, where the token ends. */
	end: number;
	/** The word before a colon, `ticket` in `@ticket:login`; `null` without one. */
	prefix: string | null;
	/** What follows the `@` and any prefix, quote kept. */
	body: string;
}

export type Trigger = { kind: "slash" } | { kind: "mention"; token: MentionToken };

/** The suggestions the caret asks for: a `/` command, an `@` mention at a line start or after a space, so `email@example.com` asks none, or nothing. */
export function completionTrigger(text: string, cursor: number): Trigger | null {
	const before = text.slice(0, cursor);
	const line = before.slice(before.lastIndexOf("\n") + 1);
	const mention = /(?:^|\s)@(?:([a-z]+):)?("[^"]*|[^\s]*)$/.exec(line);
	if (mention) {
		const [, prefix = null, body] = mention;
		return { kind: "mention", token: { start: cursor - body.length - (prefix === null ? 0 : prefix.length + 1) - 1, end: cursor, prefix, body } };
	}
	if (/(?:^|\s)\/[^\s]*$/.test(line)) return { kind: "slash" };
	return null;
}
