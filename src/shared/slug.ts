/** `text` as a name's segment: lower case, dashes between words, at most `max` characters, else `fallback` when no letter or digit is left. */
export function slug(text: string, fallback: string, max = Number.POSITIVE_INFINITY): string {
	return (
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, max)
			.replace(/-+$/, "") || fallback
	);
}
