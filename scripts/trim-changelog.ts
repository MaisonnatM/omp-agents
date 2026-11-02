/**
 * Keeps `CHANGELOG.md` under the size every doc stays under (`src/docs.test.ts`) by dropping its oldest `## YYYY-MM-DD`
 * days, whole, until it fits. What's new then lists fewer old days; git history keeps them. The newest day always stays.
 * The pre-commit hook runs it, so a commit that grows the file past the limit trims it. A merge commit skips it, since git
 * ignores a merge hook's index edits: run `bun scripts/trim-changelog.ts` and commit the result.
 */

export const CHANGELOG_MAX_BYTES = 32 * 1024;

const DAY = /^## \d{4}-\d{2}-\d{2}\s*$/m;

/** `text` without its oldest days until it is at most `maxBytes` long, or unchanged when it already fits. */
export function trimChangelog(text: string, maxBytes = CHANGELOG_MAX_BYTES): string {
	if (Buffer.byteLength(text) <= maxBytes) return text;
	const first = text.search(DAY);
	if (first < 0) return text;
	const head = text.slice(0, first);
	const days = text.slice(first).split(/(?=^## \d{4}-\d{2}-\d{2}\s*$)/m);
	while (days.length > 1 && Buffer.byteLength(head + days.join("")) > maxBytes) days.pop();
	return `${head}${days.join("").trimEnd()}\n`;
}

if (import.meta.main) {
	const path = process.argv[2] ?? "CHANGELOG.md";
	const file = Bun.file(path);
	if (await file.exists()) {
		const text = await file.text();
		const trimmed = trimChangelog(text);
		if (trimmed !== text) {
			await Bun.write(path, trimmed);
			console.error(`Trimmed ${path} to ${Buffer.byteLength(trimmed)} bytes by dropping its oldest days.`);
		}
	}
}
