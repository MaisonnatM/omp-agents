/** One place a rule flags in a file: its 1-based line and what to do about it. */
export interface Finding {
	line: number;
	message: string;
}

/**
 * A lint rule this repository adds beside Biome's, for a lesson Biome has no rule for.
 * Each rule has a canary in `scripts/lint/canaries/<id>.<ext>`, a file it must flag, so a rule that stops firing fails `scripts/lint/canaries.test.ts`.
 */
export interface Rule {
	/** Kebab-case name, used in findings, the baseline, and the canary's file name. */
	id: string;
	/** The lesson the rule encodes, printed with each finding. */
	why: string;
	/** Whether the rule checks this repository-relative path. */
	appliesTo(path: string): boolean;
	check(source: string, path: string): Finding[];
}

/** The 1-based line of the character at `index` in `source`. */
export function lineAt(source: string, index: number): number {
	let line = 1;
	for (let i = source.indexOf("\n"); i !== -1 && i < index; i = source.indexOf("\n", i + 1)) line++;
	return line;
}
