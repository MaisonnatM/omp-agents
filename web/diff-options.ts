import type { DiffRow } from "../src/shared/changes";
import type { ReviewFinding } from "../src/shared/review-drafts";
import { changeBlocks } from "./changes-model";

export interface DiffOptions {
	layout: "stacked" | "split";
	wrap: boolean;
	ignoreWhitespace: boolean;
}

/** A comment written on the diff: a finding always on a line. */
export type LineComment = Pick<ReviewFinding, "startLine" | "side" | "body"> & { line: number };

const squeezed = (row: DiffRow): string => row.text.replace(/\s/g, "");

/** The rows with each change that only moved whitespace shown unchanged, numbered on both sides. */
export function withoutWhitespaceChanges(rows: readonly DiffRow[]): readonly DiffRow[] {
	return changeBlocks(rows).flatMap(block => {
		if (block.kind === "same") return [rows[block.start]!];
		const removed = block.removed.map(index => rows[index]!);
		const added = block.added.map(index => rows[index]!);
		if (removed.length !== added.length || removed.some((old, at) => squeezed(old) !== squeezed(added[at]!))) return [...removed, ...added];
		return added.map((row, at): DiffRow => ({ ...row, old: removed[at]!.old, sign: " " }));
	});
}
