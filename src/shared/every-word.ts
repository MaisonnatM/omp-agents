/** The words of a search, lowercased, each once; quotes and extra spaces drop out, and a blank search has none. */
export function searchWords(query: string): string[] {
	return [...new Set(query.toLowerCase().replace(/["“”]/g, " ").split(/\s+/).filter(Boolean))];
}

/** A test of whether a text holds every word of `query`, in any order and any case; a blank query matches any text. */
export function everyWord(query: string): (text: string) => boolean {
	const words = searchWords(query);
	return text => {
		const haystack = text.toLowerCase();
		return words.every(word => haystack.includes(word));
	};
}

/** `text` on one line, cut to at most `max` characters that start on a word about `lead` characters before the first word of `query`, with `…` where it was cut. */
export function snippetOf(text: string, query: string, max = 160, lead = 16): string {
	const flat = text.replace(/\s+/g, " ").trim();
	const at = Math.max(0, flat.toLowerCase().indexOf(searchWords(query)[0] ?? ""));
	let start = Math.max(0, at - lead);
	if (start > 0 && flat[start - 1] !== " ") start = Math.min(at, flat.indexOf(" ", start) + 1);
	const end = Math.min(flat.length, start + max);
	return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}
