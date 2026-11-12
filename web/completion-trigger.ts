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

/** `command` is a `/` that opens omp's commands; `skill` is a `$` at `start` that opens its skills. */
export type Trigger = { kind: "command" } | { kind: "skill"; start: number } | { kind: "mention"; token: MentionToken };

/**
 * The suggestions the caret asks for: a `/` command at the start of the prompt, where omp runs one, or a `$` skill or an
 * `@` mention at a line start or after a space, so `email@example.com` asks none; a `$` before a digit, a price such as
 * `$5`, asks none either, and neither does a path such as `/tmp/a`.
 */
export function completionTrigger(text: string, cursor: number): Trigger | null {
	const before = text.slice(0, cursor);
	const line = before.slice(before.lastIndexOf("\n") + 1);
	const mention = /(?:^|\s)@(?:([a-z]+):)?("[^"]*|[^\s]*)$/.exec(line);
	if (mention) {
		const [, prefix = null, body] = mention;
		return { kind: "mention", token: { start: cursor - body.length - (prefix === null ? 0 : prefix.length + 1) - 1, end: cursor, prefix, body } };
	}
	const skill = /(?:^|\s)\$((?:[^\s\d][^\s]*)?)$/.exec(line);
	if (skill) return { kind: "skill", start: cursor - skill[1].length - 1 };
	if (/^\s*\/[^\s/]*$/.test(before)) return { kind: "command" };
	return null;
}
