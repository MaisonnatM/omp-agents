/** Text read out of HTML without a parser: its character references, and a tag's attributes. */

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
const REFERENCE = /&(?:([a-z]+)|#(\d+)|#x([\da-f]+));/gi;
/** One compiled pattern per attribute name {@link attribute} is asked for. */
const ATTRIBUTES = new Map<string, RegExp>();

/** `text` with its character references decoded: `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&nbsp;`, and numeric ones such as `&#39;`; any other stays as written. */
export function decodeEntities(text: string): string {
	return text.replace(REFERENCE, (reference: string, name?: string, decimal?: string, hex?: string) => {
		if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? reference;
		const code = decimal ? Number(decimal) : Number.parseInt(hex ?? "", 16);
		return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : reference;
	});
}

/**
 * The value of attribute `name` in `tag`, quoted or bare, with its character references decoded.
 * The name must follow whitespace, so `data-name=` is not `name=`; `name` is a literal attribute name, not a pattern.
 */
export function attribute(tag: string, name: string): string | undefined {
	let pattern = ATTRIBUTES.get(name);
	if (!pattern) {
		pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
		ATTRIBUTES.set(name, pattern);
	}
	const match = pattern.exec(tag);
	const value = match?.[1] ?? match?.[2] ?? match?.[3];
	return value === undefined ? undefined : decodeEntities(value);
}
