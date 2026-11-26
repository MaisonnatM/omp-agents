import type { Rule } from "../rule";

export const BUDGET = 800;
/** One finding per started block of this many lines past the budget, so an oversized file in the baseline still cannot grow by a block. */
export const STEP = 100;

export const fileSize: Rule = {
	id: "file-size",
	why: `Keep a source file under ${BUDGET} lines: split it by concern, so a reader and an agent can hold one file whole.`,
	appliesTo: path => /\.(ts|tsx)$/.test(path),
	check(source) {
		const lines = source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
		const blocks = Math.ceil((lines - BUDGET) / STEP);
		return Array.from({ length: Math.max(0, blocks) }, (_, i) => ({
			line: BUDGET + i * STEP + 1,
			message: `${lines} lines, ${BUDGET} allowed${i === 0 ? "" : ` (block ${i + 1})`}`,
		}));
	},
};
