/** The words of a search, lowercased; none for a blank one. */
export function searchWords(query: string): string[] {
	return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** A test of whether a text holds every word of `query`, in any order and any case; a blank query matches any text. */
export function everyWord(query: string): (text: string) => boolean {
	const words = searchWords(query);
	return text => {
		const haystack = text.toLowerCase();
		return words.every(word => haystack.includes(word));
	};
}
