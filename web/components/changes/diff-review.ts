import { type ComponentType, createContext, useContext } from "react";
import type { ChangedEntry } from "../../../src/shared/changes";
import type { DiffSide } from "../../../src/shared/review-drafts";
import type { DiffOptions } from "../../diff-options";

/** Lines picked on one side of a file's diff, `start` to `end` inclusive. */
export interface LineRange {
	side: DiffSide;
	start: number;
	end: number;
}

export interface LineCommentSlotProps {
	path: string;
	range: LineRange;
	/** Drops the picked lines, the slot with them. */
	onClose: () => void;
}

/** How a page reads the diffs it shows, and what it adds to them; the changes dialog takes the defaults. */
export interface DiffReview {
	options: DiffOptions;
	/** Shown under the picked lines; without it, lines cannot be picked. */
	LineComment: ComponentType<LineCommentSlotProps> | null;
	/** Shown at the end of each file's header in the Diff view; it reads its own state, so a file's diff does not draw again with it. */
	FileHeader: ComponentType<{ file: ChangedEntry }> | null;
}

export const DiffReviewContext = createContext<DiffReview>({
	options: { layout: "stacked", wrap: false, ignoreWhitespace: false },
	LineComment: null,
	FileHeader: null,
});

export const useDiffReview = (): DiffReview => useContext(DiffReviewContext);
