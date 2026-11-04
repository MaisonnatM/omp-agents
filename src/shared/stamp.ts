/**
 * A message the dashboard sends as a prompt and must tell from the user's: its body, a blank line, then one stamp line,
 * a fixed `#` prefix and JSON. The stamp trails the text: omp expands `/skill:` only at the start, and `#` keeps a `!`
 * prompt's shell valid.
 */
import { parseJson } from "../json";

/** `body` stamped with `stamp` and `json`, which {@link readStamped} reads back. */
export const stampedText = (body: string, stamp: string, json: unknown): string => `${body}\n\n${stamp}${JSON.stringify(json)}`;

/**
 * What `decode` makes of the last `stamp` in `text` it accepts, or `null`. A stamp counts at the start of a line or
 * after whitespace, with JSON that runs to the end: omp re-joins a bare `/skill:x` with its trimmed arguments as
 * `/skill:x # omp-agents …`, so the stamp can follow a space mid-line, with no blank line before it.
 */
export function readStamped<T>(text: string, stamp: string, decode: (body: string, json: unknown) => T | null): T | null {
	const trimmed = text.trimEnd();
	for (let at = trimmed.lastIndexOf(stamp); at >= 0; at = at === 0 ? -1 : trimmed.lastIndexOf(stamp, at - 1)) {
		if (at > 0 && !/\s/.test(trimmed[at - 1]!)) continue;
		const before = trimmed.slice(0, at);
		const decoded = decode(before.endsWith("\n\n") ? before.slice(0, -2) : before.trimEnd(), parseJson(trimmed.slice(at + stamp.length)));
		if (decoded) return decoded;
	}
	return null;
}
