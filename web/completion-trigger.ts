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

/** `command` is a `$` that opens omp's commands and skills, at `start`. */
export type Trigger = { kind: "command"; start: number } | { kind: "mention"; token: MentionToken };

/**
 * The suggestions the caret asks for: a `$` command or skill, or an `@` mention, each at a line start or after a space,
 * so `email@example.com` asks none; a `$` before a digit, a price such as `$5`, asks none either.
 */
export function completionTrigger(text: string, cursor: number): Trigger | null {
	const before = text.slice(0, cursor);
	const line = before.slice(before.lastIndexOf("\n") + 1);
	const mention = /(?:^|\s)@(?:([a-z]+):)?("[^"]*|[^\s]*)$/.exec(line);
	if (mention) {
		const [, prefix = null, body] = mention;
		return { kind: "mention", token: { start: cursor - body.length - (prefix === null ? 0 : prefix.length + 1) - 1, end: cursor, prefix, body } };
	}
	const command = /(?:^|\s)\$((?:[^\s\d][^\s]*)?)$/.exec(line);
	if (command) return { kind: "command", start: cursor - command[1].length - 1 };
	return null;
}
