/**
 * A hash segment decoded, `null` for a malformed percent-escape (`%E0`, `%zz`), which a hand-edited or cut link may
 * hold; each parser reads `null` as naming nothing, so such a link opens what the hash names without it instead of throwing.
 */
export function decodeSegment(raw: string): string | null {
	try {
		return decodeURIComponent(raw);
	} catch (error) {
		if (error instanceof URIError) return null;
		throw error;
	}
}
