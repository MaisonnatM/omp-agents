/** A test of whether a text holds every word of `query`, in any order and any case; a blank query matches any text. */
export function everyWord(query: string): (text: string) => boolean {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return text => {
		const haystack = text.toLowerCase();
		return words.every(word => haystack.includes(word));
	};
}
