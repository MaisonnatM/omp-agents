/**
 * The project memory's contract, which the `project_memory` tool, the dashboard's server, and its Memory page share:
 * kinds, limits, the tool's op, and the source an op records. It imports nothing, so the page's bundle can take it.
 */

export const MEMORY_KINDS = ["decision", "fact", "lesson"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/** A slug's most characters; a slug is lowercase letters, digits, and hyphens, starting with a letter or digit. */
export const SLUG_MAX = 48;
export const SLUG_PATTERN = new RegExp(`^[a-z0-9][a-z0-9-]{0,${SLUG_MAX - 1}}$`);
export const LINE_MAX = 120;
export const BODY_MAX = 2000;

/** One op as the `project_memory` tool's flat schema takes it; `kind`, `line`, and `body` are required for `add`. */
export interface RawOp {
	op: "add" | "update" | "delete";
	slug: string;
	kind?: MemoryKind;
	line?: string;
	body?: string;
}

/** The source a memory records for the session named `session`, which added or last updated it. */
export const sourceTag = (session: string): string => `#${session}`;
