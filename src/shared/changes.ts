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

/** `path` shown as `rows`, or with none and the `note` saying why. */
export const fileText = (path: string, rows: ChangedFileText["rows"], note: string | null = null): ChangedFileText => ({ path, rows, note });

/** The most bytes of a side that the changes view reads. */
export const MAX_CHANGED_FILE_BYTES = 1024 * 1024;

/** A hunk header's first line number on each side, `null` for an `@@` line without numbers. An empty side starts at 0 and has no lines, so it counts from 1. */
const hunkStart = (line: string): { old: number; new: number } | null => {
	const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
	return match ? { old: Math.max(1, Number(match[1])), new: Math.max(1, Number(match[2])) } : null;
};

/**
 * The rows of `git diff --unified=<every line>`: the header lines before the first `@@` are skipped, and so is the
 * `\ No newline at end of file` marker. A diff with no hunk, an unchanged file, has no rows.
 */
export function parseFullDiff(diff: string): DiffRow[] {
	const rows: DiffRow[] = [];
	let oldLine = 0;
	let newLine = 0;
	let inHunk = false;
	for (const line of linesOf(diff)) {
		if (line.startsWith("@@")) {
			const start = hunkStart(line);
			if (!start) continue;
			({ old: oldLine, new: newLine } = start);
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

/** One file of a Markdown `diff` fence: the path its header names, and its hunks. */
export interface FenceFile {
	path: string | null;
	/** `false` when no hunk header numbers its rows, which then count from 1 only so that they highlight. */
	numbered: boolean;
	hunks: DiffRow[][];
}

/** The lines git writes between `diff --git` and a file's first hunk, other than `---` and `+++`. */
const GIT_HEADER = /^(?:index |old mode |new mode |new file mode |deleted file mode |similarity index |dissimilarity index |rename (?:from|to) |copy (?:from|to) |Binary files )/;

/** The path of a `---` or `+++` line, without git's `a/` or `b/` and `diff -u`'s tab and time. */
const headerPath = (line: string): string => line.slice(4).split("\t")[0]!.replace(/^[ab]\//, "");

/**
 * A Markdown `diff` or `patch` fence, one entry per file: `diff --git` or a `---` line followed by `+++` starts one.
 * Authors often write a fence with no `@@` header, so the lines before a file's first `@@` are a hunk of their own.
 * Inside a hunk a line without a sign, or an empty one, is unchanged. Files with no rows drop out.
 */
export function diffFence(text: string): FenceFile[] {
	const files: FenceFile[] = [];
	const newFile = (path: string | null): FenceFile => {
		const file: FenceFile = { path, numbered: true, hunks: [] };
		files.push(file);
		return file;
	};
	let oldLine = 1;
	let newLine = 1;
	const lines = linesOf(text);
	for (let at = 0; at < lines.length; at++) {
		const line = lines[at]!;
		if (line.startsWith("diff --git ")) {
			newFile(/ b\/(.+)$/.exec(line)?.[1] ?? null);
			continue;
		}
		const last = files.at(-1);
		if (line.startsWith("--- ") && lines[at + 1]?.startsWith("+++ ")) {
			const target = headerPath(lines[++at]!);
			const path = target === "/dev/null" ? headerPath(line) : target;
			if (last?.hunks.length === 0) last.path = path;
			else newFile(path);
			continue;
		}
		if (last?.hunks.length === 0 && GIT_HEADER.test(line)) continue;
		const file = last ?? newFile(null);
		if (line.startsWith("@@")) {
			const start = hunkStart(line);
			if (start) ({ old: oldLine, new: newLine } = start);
			else file.numbered = false;
			file.hunks.push([]);
			continue;
		}
		if (line.startsWith("\\")) continue;
		if (file.hunks.length === 0) {
			file.numbered = false;
			oldLine = 1;
			newLine = 1;
			file.hunks.push([]);
		}
		const hunk = file.hunks.at(-1)!;
		const sign = line[0];
		if (sign === "+") hunk.push({ sign: "+", old: null, new: newLine++, text: line.slice(1) });
		else if (sign === "-") hunk.push({ sign: "-", old: oldLine++, new: null, text: line.slice(1) });
		else hunk.push({ sign: " ", old: oldLine++, new: newLine++, text: sign === " " ? line.slice(1) : line });
	}
	return files.flatMap(file => {
		const hunks = file.hunks.filter(hunk => hunk.length > 0);
		return hunks.length > 0 ? [{ ...file, hunks }] : [];
	});
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
