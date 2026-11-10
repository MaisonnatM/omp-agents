/** Where a find match starts and ends: a segment's index and an offset in its text. */
export type FindPoint = readonly [segment: number, offset: number];

export interface FindMatch {
	start: FindPoint;
	end: FindPoint;
}

/**
 * Every case-insensitive, non-overlapping occurrence of `query` in the text that `segments` spell end to end, such as a
 * transcript's text nodes in document order, so a match may span segments, as a code block's highlighted tokens do.
 * A blank query matches nothing.
 */
export function findMatches(segments: readonly string[], query: string): FindMatch[] {
	const needle = query.toLowerCase();
	if (needle.trim() === "") return [];
	const starts: number[] = [];
	let text = "";
	for (const segment of segments) {
		starts.push(text.length);
		// A few characters change length when lowercased; that segment keeps its case so every offset stays its own.
		const lower = segment.toLowerCase();
		text += lower.length === segment.length ? lower : segment;
	}
	const ends = segments.map((segment, index) => starts[index]! + segment.length);
	let segment = 0;
	// Matches come in order, so one cursor walks the segments once. A start sits in the segment that holds its
	// character; an end may sit at its segment's last offset.
	const locate = (offset: number, end: boolean): FindPoint => {
		while (segment < segments.length - 1 && (end ? ends[segment]! < offset : ends[segment]! <= offset)) segment++;
		return [segment, offset - starts[segment]!];
	};
	const matches: FindMatch[] = [];
	for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
		matches.push({ start: locate(at, false), end: locate(at + needle.length, true) });
	}
	return matches;
}
