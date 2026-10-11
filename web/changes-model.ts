/** The changes page's pure layout: the diff's folds and the file view's gutter marks. */
import type { DiffRow } from "../src/shared/changes";

/** Unchanged lines the diff keeps on each side of a change. */
export const DIFF_CONTEXT = 3;

/** A diff row on screen, or a fold of `to - from` unchanged rows that `start` names once unfolded. */
export type DiffItem = { kind: "row"; index: number } | { kind: "fold"; from: number; to: number; start: number };

/**
 * The diff with each run of unchanged rows folded but for {@link DIFF_CONTEXT} rows next to a change; the file's own start
 * and end keep none. A fold must hide more than two rows, and `opened` holds the `start` of each run unfolded. A file
 * with no change, which only the session's calls name, shows whole.
 */
export function foldDiff(rows: readonly DiffRow[], opened: ReadonlySet<number>): DiffItem[] {
	const items: DiffItem[] = [];
	const show = (from: number, to: number) => {
		for (let index = from; index < to; index++) items.push({ kind: "row", index });
	};
	let index = 0;
	while (index < rows.length) {
		if (rows[index]!.sign !== " ") {
			items.push({ kind: "row", index: index++ });
			continue;
		}
		let end = index;
		while (end < rows.length && rows[end]!.sign === " ") end++;
		const lead = index === 0 ? 0 : DIFF_CONTEXT;
		const tail = end === rows.length ? 0 : DIFF_CONTEXT;
		const whole = index === 0 && end === rows.length;
		if (!whole && end - index - lead - tail > 2 && !opened.has(index)) {
			show(index, index + lead);
			items.push({ kind: "fold", from: index + lead, to: end - tail, start: index });
			show(end - tail, end);
		} else show(index, end);
		index = end;
	}
	return items;
}

/**
 * A line of the file as it is now, with its gutter mark: `added` in a run of added rows, `modified` in one that follows
 * removed rows. `removed` holds the removed rows just before its run, which a click anywhere on the run's gutter shows
 * above `run`, the run's first line.
 */
export interface FileLine {
	index: number;
	mark: "added" | "modified" | null;
	removed: number[];
	run: number;
}

/** The file view's lines; rows removed at the very end of the file come back apart, as `removedAtEnd`. */
export function fileLines(rows: readonly DiffRow[]): { lines: FileLine[]; removedAtEnd: number[] } {
	const lines: FileLine[] = [];
	let removed: number[] = [];
	let index = 0;
	while (index < rows.length) {
		const sign = rows[index]!.sign;
		if (sign === "-") {
			removed.push(index++);
			continue;
		}
		const mark = sign === " " ? null : removed.length > 0 ? "modified" : "added";
		const run = index;
		lines.push({ index: index++, mark, removed, run });
		while (mark && index < rows.length && rows[index]!.sign === "+") lines.push({ index: index++, mark, removed, run });
		removed = [];
	}
	return { lines, removedAtEnd: removed };
}
