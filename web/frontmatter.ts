/** A Markdown file's YAML frontmatter, read as the properties a page shows above the file's text. */

/** One top-level key of the frontmatter and its value as text: a nested mapping or list keeps its lines, dedented. */
export interface FrontmatterField {
	key: string;
	value: string;
}

const FIELD = /^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/;
const BLOCK_SCALAR = /^[|>][+-]?$/;

/** `"…"` or `'…'` without its quotes. */
const unquote = (value: string): string => (/^(["']).*\1$/.test(value) ? value.slice(1, -1) : value);

/** The lines under a key: a `>` block folds them into one paragraph, anything else keeps them, dedented. */
function nestedValue(marker: string, lines: string[]): string {
	const filled = lines.filter(line => line.trim() !== "");
	const indent = Math.min(...filled.map(line => line.length - line.trimStart().length));
	const dedented = lines.map(line => line.slice(indent)).join("\n").trim();
	return marker.startsWith(">") ? dedented.replace(/\n(?!\n)/g, " ") : dedented;
}

/**
 * `text` split into its frontmatter's fields and the Markdown after it. Text that does not open with a `---` line
 * closed by another, or whose block holds a line no top-level key starts, has no fields and keeps its whole text, so
 * nothing the file holds goes unshown.
 */
export function splitFrontmatter(text: string): { fields: FrontmatterField[]; body: string } {
	const none = { fields: [], body: text };
	const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
	if (!match) return none;
	const fields: { key: string; first: string; nested: string[] }[] = [];
	for (const line of match[1]!.split(/\r?\n/)) {
		const field = FIELD.exec(line);
		if (field) fields.push({ key: field[1]!, first: field[2]?.trim() ?? "", nested: [] });
		else if (fields.length > 0 && (line.trim() === "" || /^(\s|- )/.test(line))) fields.at(-1)!.nested.push(line);
		else if (line.trim() !== "" && !line.startsWith("#")) return none;
	}
	return { fields: fields.map(({ key, first, nested }) => ({ key, value: valueOf(first, nested) })), body: text.slice(match[0].length).replace(/^\s*\n/, "") };
}

/** A key's value from the text after its colon and the lines under it. */
function valueOf(first: string, nested: string[]): string {
	if (!nested.some(line => line.trim() !== "")) return unquote(first);
	if (first === "" || BLOCK_SCALAR.test(first)) return nestedValue(first, nested);
	// A plain scalar that runs on over more lines reads as one line.
	return unquote([first, ...nested.map(line => line.trim())].filter(Boolean).join(" "));
}
