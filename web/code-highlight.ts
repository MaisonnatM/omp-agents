/** Syntax colors for a file shown line by line, from the `lowlight` grammars that message code blocks use. */
import type { RootContent } from "hast";
import { common, createLowlight } from "lowlight";
import type { DiffRow } from "../src/shared/changes";

const lowlight = createLowlight(common);

/** Extensions no grammar registers as an alias. */
const LANGUAGE_OF: Record<string, string> = { tsx: "typescript", mts: "typescript", cts: "typescript", jsx: "javascript", mjs: "javascript", cjs: "javascript", jsonl: "json" };

/** A run of text and the `hljs-*` classes that color it, `""` for none. */
export interface Token {
	className: string;
	text: string;
}

/**
 * `text` cut into lines of tokens. The whole text is highlighted at once, so a comment or string that spans lines keeps
 * its color; a path with no known grammar gets uncolored lines.
 */
export function highlightLines(text: string, path: string): Token[][] {
	const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	// A file named `x.constructor` must not reach the object's prototype.
	const language = Object.hasOwn(LANGUAGE_OF, extension) ? LANGUAGE_OF[extension]! : lowlight.registered(extension) ? extension : null;
	const lines: Token[][] = [[]];
	const add = (className: string, value: string) => {
		value.split("\n").forEach((part, index) => {
			if (index > 0) lines.push([]);
			if (part) lines.at(-1)!.push({ className, text: part });
		});
	};
	const walk = (nodes: readonly RootContent[], className: string) => {
		for (const node of nodes) {
			if (node.type === "text") add(className, node.value);
			else if (node.type === "element") {
				const own = node.properties.className;
				walk(node.children, Array.isArray(own) ? [className, ...own].filter(Boolean).join(" ") : className);
			}
		}
	};
	if (language) walk(lowlight.highlight(language, text).children, "");
	else add("", text);
	return lines;
}

/** Each diff row's tokens: a removed row's from the old side, every other row's from the new side. */
export function highlightRows(rows: readonly DiffRow[], path: string): Token[][] {
	const side = (number: (row: DiffRow) => number | null) => highlightLines(rows.filter(row => number(row) !== null).map(row => row.text).join("\n"), path);
	const before = side(row => row.old);
	const after = side(row => row.new);
	return rows.map(row => (row.sign === "-" ? before[row.old! - 1] : after[row.new! - 1]) ?? []);
}
