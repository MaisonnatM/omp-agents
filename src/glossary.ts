/** The Memory page's glossary: each workspace repository's `GLOSSARY.md`, split into its terms. See docs/architecture/memory-page.md. */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { displayPath } from "./paths";
import type { GlossaryRepo, GlossarySection, GlossaryTerm, GlossaryView } from "./shared/memory-page";

/** A term's first line: `**Term**: definition`, or a list item `- **Term**: definition`; the colon may sit inside the bold. */
const TERM_LINE = /^(?:[-*]\s+)?\*\*(.+?):?\*\*:?\s*(.*)$/;
const AVOID_LINE = /^[_*]Avoid[_*]\s*:\s*(.*)$/i;
const HEADING = /^#{2,}\s+(.+)$/;

/**
 * `text`'s terms under their `##` headings, in the file's order; terms before any heading sit in a section with title
 * `null`, and a section without terms is left out. A term runs to the next blank line, term, or heading, and its
 * `_Avoid_:` line, split on commas, gives the words not to use for it.
 */
export function parseGlossary(text: string): GlossarySection[] {
	const sections: GlossarySection[] = [];
	let section: GlossarySection | null = null;
	let term: GlossaryTerm | null = null;
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		const heading = HEADING.exec(line);
		if (heading) {
			section = { title: heading[1] ?? "", terms: [] };
			sections.push(section);
			term = null;
			continue;
		}
		const avoid = term && AVOID_LINE.exec(line);
		if (term && avoid) {
			term.avoid = (avoid[1] ?? "")
				.split(",")
				.map(word => word.trim())
				.filter(word => word !== "");
			continue;
		}
		const head = TERM_LINE.exec(line);
		if (head) {
			if (!section) {
				section = { title: null, terms: [] };
				sections.push(section);
			}
			term = { term: (head[1] ?? "").trim(), definition: (head[2] ?? "").trim(), avoid: [] };
			section.terms.push(term);
			continue;
		}
		if (line === "") term = null;
		else if (term) term.definition = term.definition === "" ? line : `${term.definition}\n${line}`;
	}
	return sections.filter(each => each.terms.length > 0);
}

/** The repository whose main checkout is `root`, with its glossary's terms; `null` when it has no `GLOSSARY.md` or no term in it. */
function repoOf(root: string): GlossaryRepo | null {
	let text: string;
	try {
		text = readFileSync(join(root, "GLOSSARY.md"), "utf8");
	} catch {
		return null;
	}
	const sections = parseGlossary(text);
	return sections.length === 0 ? null : { root, rootDisplay: displayPath(root), name: basename(root), sections };
}

/** Every repository among `roots` with a glossary, by folder name. */
export function glossaryView(roots: readonly string[]): GlossaryView {
	const repos = roots.flatMap(root => repoOf(root) ?? []);
	repos.sort((a, b) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root));
	return { repos };
}
