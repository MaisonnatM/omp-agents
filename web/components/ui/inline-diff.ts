/** affectUI's inline diff, cut to its word diff: which runs of words two texts share and which one replaces in the other. */

export type DiffSegment = { type: "equal"; text: string } | { type: "change"; remove: string; insert: string };

// Identifiers and numbers, runs of whitespace, and single punctuation marks
const TOKEN = /[\p{L}\p{N}_$]+|\s+|[^\p{L}\p{N}_$\s]/gu;

/** Word-level diff: equal runs and changes, where each change pairs the removed words with the ones that replace them */
export function diffWords(original: string, suggested: string): DiffSegment[] {
	const a = original.match(TOKEN) ?? [];
	const b = suggested.match(TOKEN) ?? [];
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}

	// Longest common subsequence of the middle, filled from the end so the walk below can go forwards
	const rows = endA - start;
	const cols = endB - start;
	const width = cols + 1;
	const lcs = new Uint32Array((rows + 1) * width);
	for (let i = rows - 1; i >= 0; i--) {
		for (let j = cols - 1; j >= 0; j--) {
			lcs[i * width + j] = a[start + i] === b[start + j] ? lcs[(i + 1) * width + j + 1]! + 1 : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
		}
	}

	const out: DiffSegment[] = [];
	const equal = (text: string) => {
		const last = out.at(-1);
		if (last?.type === "equal") last.text += text;
		else out.push({ type: "equal", text });
	};
	const change = (remove: string, insert: string) => {
		const last = out.at(-1);
		if (last?.type === "change") {
			last.remove += remove;
			last.insert += insert;
		} else out.push({ type: "change", remove, insert });
	};

	a.slice(0, start).forEach(equal);
	let i = 0;
	let j = 0;
	while (i < rows || j < cols) {
		if (i < rows && j < cols && a[start + i] === b[start + j]) {
			equal(a[start + i]!);
			i++;
			j++;
		} else if (i < rows && (j === cols || lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)) {
			// Removals first on a tie, so a change reads old words, then new ones
			change(a[start + i]!, "");
			i++;
		} else {
			change("", b[start + j]!);
			j++;
		}
	}
	a.slice(endA).forEach(equal);

	return tidy(out);
}

/** Joins changes split by a lone space and moves whitespace both sides share out of the change */
function tidy(segments: DiffSegment[]): DiffSegment[] {
	const merged: DiffSegment[] = [];
	for (let s = 0; s < segments.length; s++) {
		const segment = segments[s]!;
		const prev = merged.at(-1);
		const next = segments[s + 1];
		if (segment.type === "equal" && /^\s+$/.test(segment.text) && prev?.type === "change" && next?.type === "change") {
			prev.remove += segment.text + next.remove;
			prev.insert += segment.text + next.insert;
			s++;
		} else merged.push({ ...segment });
	}

	const out: DiffSegment[] = [];
	const equal = (text: string) => {
		if (!text) return;
		const last = out.at(-1);
		if (last?.type === "equal") last.text += text;
		else out.push({ type: "equal", text });
	};
	for (const segment of merged) {
		if (segment.type === "equal") {
			equal(segment.text);
			continue;
		}
		let { remove, insert } = segment;
		let lead = "";
		let trail = "";
		if (remove && insert) {
			lead = sharedEdge(remove.match(/^\s*/)![0], insert.match(/^\s*/)![0], true);
			trail = sharedEdge(remove.match(/\s*$/)![0], insert.match(/\s*$/)![0], false);
			remove = remove.slice(lead.length, remove.length - trail.length);
			insert = insert.slice(lead.length, insert.length - trail.length);
		}
		equal(lead);
		if (remove || insert) out.push({ type: "change", remove, insert });
		equal(trail);
	}
	return out;
}

function sharedEdge(x: string, y: string, fromStart: boolean) {
	let n = 0;
	const max = Math.min(x.length, y.length);
	while (n < max && (fromStart ? x[n] === y[n] : x[x.length - 1 - n] === y[y.length - 1 - n])) n++;
	return fromStart ? x.slice(0, n) : x.slice(x.length - n);
}
