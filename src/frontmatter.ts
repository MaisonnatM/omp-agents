/** The YAML frontmatter a Markdown file opens with, as decision records and the page's file views read it. */
import type { Frontmatter } from "./shared/models";

const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n)*/;

/**
 * The mapping `text`'s frontmatter holds and where the text after the block starts; `data` is `null` when the YAML is
 * broken or not a mapping. `null` when `text` opens with no `---` block closed by another.
 */
export function parseFrontmatter(text: string): { data: Record<string, unknown> | null; end: number } | null {
	const block = BLOCK.exec(text);
	if (!block) return null;
	let data: Record<string, unknown> | null = null;
	try {
		const parsed: unknown = Bun.YAML.parse(block[1] ?? "");
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
	} catch {}
	return { data, end: block[0].length };
}

const shown = (value: unknown): string =>
	value === null || value === undefined ? "" : typeof value === "string" ? value.trimEnd() : typeof value === "object" ? Bun.YAML.stringify(value, null, 2) : String(value);

/** A Markdown file's frontmatter as the page shows it, each top-level value as text; none for another file or a block that does not parse. */
export function frontmatterOf(path: string, text: string): Frontmatter | undefined {
	if (!/\.(?:md|markdown)$/i.test(path)) return undefined;
	const front = parseFrontmatter(text);
	if (!front?.data) return undefined;
	return { fields: Object.entries(front.data).map(([key, value]) => ({ key, value: shown(value) })), end: front.end };
}
