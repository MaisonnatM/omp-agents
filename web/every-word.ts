/** Whether `text` holds every word of `query`, in any order and any case; a blank query matches any text. */
export function hasEveryWord(text: string, query: string): boolean {
	const haystack = text.toLowerCase();
	return query
		.toLowerCase()
		.split(/\s+/)
		.every(word => haystack.includes(word));
}
