/** How many findings each rule has in each file: `counts[rule][file]`. */
export type Counts = Record<string, Record<string, number>>;

/** One rule and file whose count differs between two `Counts`. */
export interface Change {
	rule: string;
	file: string;
	from: number;
	to: number;
}

export function tally(findings: { rule: string; file: string }[]): Counts {
	const counts: Counts = {};
	for (const { rule, file } of findings) {
		const byFile = (counts[rule] ??= {});
		byFile[file] = (byFile[file] ?? 0) + 1;
	}
	return sorted(counts);
}

/** `counts` with rules and files in alphabetical order, so the baseline file diffs line by line. */
export function sorted(counts: Counts): Counts {
	const out: Counts = {};
	for (const rule of Object.keys(counts).sort()) {
		const byFile = counts[rule]!;
		const files = Object.keys(byFile).sort();
		if (files.length > 0) out[rule] = Object.fromEntries(files.map(file => [file, byFile[file]!]));
	}
	return out;
}

/** Every rule and file whose count in `to` differs from `from`, split into those that grew and those that fell. */
export function compare(from: Counts, to: Counts): { grew: Change[]; fell: Change[] } {
	const grew: Change[] = [];
	const fell: Change[] = [];
	for (const rule of new Set([...Object.keys(from), ...Object.keys(to)])) {
		for (const file of new Set([...Object.keys(from[rule] ?? {}), ...Object.keys(to[rule] ?? {})])) {
			const before = from[rule]?.[file] ?? 0;
			const after = to[rule]?.[file] ?? 0;
			if (after > before) grew.push({ rule, file, from: before, to: after });
			else if (after < before) fell.push({ rule, file, from: before, to: after });
		}
	}
	return { grew, fell };
}

/** Reads a baseline file's JSON, refusing anything but rule → file → non-negative integer. */
export function parseCounts(text: string, where: string): Counts {
	const data: unknown = JSON.parse(text);
	const bad = () => new Error(`${where} is not a JSON object of rule → file → count`);
	if (typeof data !== "object" || data === null || Array.isArray(data)) throw bad();
	for (const byFile of Object.values(data)) {
		if (typeof byFile !== "object" || byFile === null || Array.isArray(byFile)) throw bad();
		for (const count of Object.values(byFile)) if (typeof count !== "number" || !Number.isInteger(count) || count < 0) throw bad();
	}
	return data as Counts;
}
