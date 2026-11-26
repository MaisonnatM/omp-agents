import type { Rule } from "../rule";

/**
 * Agents read docs through tools that cut a line at 768 characters and end it with `…`.
 * A longer line hides its tail, and an edit that copies the cut line back writes the `…` into the file.
 * The docs keep one sentence per line, so no line comes near the cut.
 */
export const MAX_LINE = 700;

/** Root Markdown, and Markdown under `docs/`, `templates/omp/`, and `.agents/`, nested agent instructions and skills included. */
const DOCS = /^(?:[^/]+|(?:docs|templates\/omp|\.agents)\/.+)\.md$/;

export const docLines: Rule = {
	id: "doc-lines",
	why: `Keep each line of a doc under ${MAX_LINE} characters, one sentence per line, so a tool that reads it never cuts a line.`,
	appliesTo: path => DOCS.test(path),
	check(source) {
		return source.split("\n").flatMap((line, i) => {
			if (line.length > MAX_LINE) return [{ line: i + 1, message: `${line.length} characters; put one sentence on each line` }];
			if (line.trimEnd().endsWith("…")) return [{ line: i + 1, message: `ends in a tool's truncation mark "…"; restore the cut text` }];
			return [];
		});
	},
};
