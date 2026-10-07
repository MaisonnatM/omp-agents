/** What changed, for the changes views: a session's checkout and its own calls, or a pull request on GitHub. */

/** What happened to a file between the base and the working tree, or between a pull request's base and head. */
export type ChangeStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface ChangedEntry {
	/** Relative to the checkout's or the repository's root inside it, else absolute with the home directory as `~`; the file read names it so. */
	path: string;
	/** Git's change against the base; `null` for a file outside the checkout, or one the session changed back to the base. */
	status: ChangeStatus | null;
	/** Lines added and removed against the base; `null` for a binary file or one git does not compare. */
	added: number | null;
	removed: number | null;
	/** The session's own `edit` and `write` calls changed it. */
	session: boolean;
}

export interface SessionChanges {
	/** The checkout the session works in, `null` outside git. */
	root: string | null;
	branch: string | null;
	/** What the diff compares against: the merge base of `HEAD` with the remote's default branch, else `HEAD`, else the empty tree before the first commit. */
	base: { ref: string; sha: string } | null;
	/** Git's changes in path order, then the session's files git does not list. */
	files: ChangedEntry[];
}

/** One line of a file's diff with every line as context: `old` and `new` number it on each side, `null` on the side it is missing from. */
export interface DiffRow {
	sign: " " | "+" | "-";
	old: number | null;
	new: number | null;
	text: string;
}

/** A changed file in full: its rows, or why it has none. */
export interface ChangedFileText {
	path: string;
	/** Every line of both sides, in order; `null` with `note` when the file cannot show as text. */
	rows: DiffRow[] | null;
	note: string | null;
}

/** The most bytes of a side that the changes view reads. */
export const MAX_CHANGED_FILE_BYTES = 1024 * 1024;

/**
 * The rows of `git diff --unified=<every line>`: the header lines before the first `@@` are skipped, and so is the
 * `\ No newline at end of file` marker. A diff with no hunk, an unchanged file, has no rows.
 */
export function parseFullDiff(diff: string): DiffRow[] {
	const rows: DiffRow[] = [];
	let oldLine = 0;
	let newLine = 0;
	let inHunk = false;
	const lines = diff.split("\n");
	if (lines.at(-1) === "") lines.pop();
	for (const line of lines) {
		if (line.startsWith("@@")) {
			const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
			if (!match) continue;
			oldLine = Number(match[1]);
			newLine = Number(match[2]);
			// An empty side starts at 0 and has no lines.
			if (oldLine === 0) oldLine = 1;
			if (newLine === 0) newLine = 1;
			inHunk = true;
			continue;
		}
		if (!inHunk || line.startsWith("\\")) continue;
		const sign = line[0];
		const text = line.slice(1);
		if (sign === "+") rows.push({ sign: "+", old: null, new: newLine++, text });
		else if (sign === "-") rows.push({ sign: "-", old: oldLine++, new: null, text });
		else rows.push({ sign: " ", old: oldLine++, new: newLine++, text });
	}
	return rows;
}

const linesOf = (text: string): string[] => {
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
};

/** A file's text as rows that changed nothing, for a file with no base to compare. */
export function contextRows(text: string): DiffRow[] {
	return linesOf(text).map((line, index) => ({ sign: " ", old: index + 1, new: index + 1, text: line }));
}

/**
 * Every row of a file from GitHub's `patch` of it, whose hunks hold only a few unchanged lines around each change, and
 * `head`, its text after the change; empty for a removed file, whose patch holds every line. Lines outside the hunks are
 * the same on both sides, so each gap before, between, and after them comes from `head`, its old number moved by as
 * many lines as the hunks before it added or removed.
 */
export function patchRows(patch: string, head: string): DiffRow[] {
	const lines = linesOf(head);
	const rows: DiffRow[] = [];
	let oldNext = 1;
	let newNext = 1;
	const fillTo = (end: number): void => {
		while (newNext < end && newNext <= lines.length) rows.push({ sign: " ", old: oldNext++, new: newNext, text: lines[newNext++ - 1]! });
	};
	for (const row of parseFullDiff(patch)) {
		// A removed line names no new number; the gap before it is as long on both sides.
		fillTo(row.new ?? newNext + (row.old ?? oldNext) - oldNext);
		rows.push(row);
		if (row.old !== null) oldNext = row.old + 1;
		if (row.new !== null) newNext = row.new + 1;
	}
	fillTo(lines.length + 1);
	return rows;
}
