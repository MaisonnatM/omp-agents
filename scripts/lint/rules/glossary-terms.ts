import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lineAt, type Rule } from "../rule";

/** Avoided terms that are also plain English with another meaning, such as "both sides" of a sync or the macOS window's "title bar", which only a reviewer can judge. */
const ORDINARY = new Set(["both sides", "each leg", "qr code", "test result", "title bar"]);

/**
 * The avoided terms of `GLOSSARY.md` that are safe to search for, with the word to use instead: those of two or three words.
 * A one-word avoided term, such as "thread" or "task", is also a common word with another meaning, and a longer one is an explanation, not a term.
 */
export function avoidedTerms(glossary: string): Map<string, string> {
	const terms = new Map<string, string>();
	let use = "";
	for (const line of glossary.split("\n")) {
		const heading = /^\*\*(.+?):?\*\*:?\s*$/.exec(line);
		if (heading) use = heading[1]!;
		if (!line.startsWith("_Avoid_:")) continue;
		for (const raw of line.slice("_Avoid_:".length).replace(/\([^)]*\)/g, "").split(",")) {
			const term = raw.trim().replace(/\.$/, "").toLowerCase();
			const words = term.split(/\s+/).length;
			if (words >= 2 && words <= 3 && !ORDINARY.has(term)) terms.set(term, use);
		}
	}
	return terms;
}

let cached: { pattern: RegExp; terms: Map<string, string> } | undefined;

function load() {
	if (cached) return cached;
	const terms = avoidedTerms(readFileSync(join(import.meta.dir, "../../../GLOSSARY.md"), "utf8"));
	const alternatives = [...terms.keys()].map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
	cached = { pattern: new RegExp(`(?<![\\w-])(${alternatives.join("|")})(?![\\w-])`, "gi"), terms };
	return cached;
}

/** Checks the docs' prose only, past code spans and fences: in code, a CSS class such as `changes-card` is a name the code already has, not a word for a concept. */
export const glossaryTerms: Rule = {
	id: "glossary-terms",
	why: "Name things with GLOSSARY.md's words, never the ones it says to avoid.",
	appliesTo: path => path.endsWith(".md") && !/^(GLOSSARY|CHANGELOG|LEARNINGS)\.md$|^docs\/decisions\//.test(path),
	check(source) {
		const { pattern, terms } = load();
		const prose = source.replace(/```[\s\S]*?```|`[^`\n]*`/g, code => code.replace(/[^\n]/g, " "));
		return [...prose.matchAll(pattern)].map(match => ({
			line: lineAt(source, match.index),
			message: `"${match[0]}": GLOSSARY.md says ${terms.get(match[1]!.toLowerCase().replace(/\s+/g, " "))}`,
		}));
	},
};
