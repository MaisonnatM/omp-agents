/** Syntax colors, line by line, from the `lowlight` grammars, for a file shown in the changes view and a fenced code block in a message. */
import type { RootContent } from "hast";
import { common, createLowlight } from "lowlight";
import type { DiffRow } from "../src/shared/changes";

const lowlight = createLowlight(common);

/** Names no grammar registers as an alias: file extensions, which a fence also uses. */
const LANGUAGE_OF: Record<string, string> = { tsx: "typescript", mts: "typescript", cts: "typescript", jsx: "javascript", mjs: "javascript", cjs: "javascript", jsonl: "json" };

/** A run of text and the `hljs-*` classes that color it, `""` for none. */
export interface Token {
	className: string;
	text: string;
}

/**
 * `text` cut into lines of tokens, colored as `language`, a grammar's name or alias or a file's extension. The whole
 * text is highlighted at once, so a comment or string that spans lines keeps its color; a language no grammar knows
 * gets uncolored lines.
 */
export function highlightLines(text: string, language: string): Token[][] {
	const name = language.toLowerCase();
	// A file named `x.constructor` must not reach the object's prototype.
	const grammar = Object.hasOwn(LANGUAGE_OF, name) ? LANGUAGE_OF[name]! : lowlight.registered(name) ? name : null;
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
	if (grammar) walk(lowlight.highlight(grammar, text).children, "");
	else add("", text);
	return lines;
}

/** Each diff row's tokens: a removed row's from the old side, every other row's from the new side. */
export function highlightRows(rows: readonly DiffRow[], path: string): Token[][] {
	const extension = path.slice(path.lastIndexOf(".") + 1);
	const side = (number: (row: DiffRow) => number | null) => highlightLines(rows.filter(row => number(row) !== null).map(row => row.text).join("\n"), extension);
	const before = side(row => row.old);
	const after = side(row => row.new);
	return rows.map(row => (row.sign === "-" ? before[row.old! - 1] : after[row.new! - 1]) ?? []);
}
