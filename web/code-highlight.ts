/** Syntax colors, line by line, from the `lowlight` grammars, for a file shown in the changes view and a fenced code block in a message. */
import type { Root, RootContent } from "hast";
import type { DiffRow } from "../src/shared/changes";
import { loadedOnce, useLoaded } from "./loaded-once";

/** What highlighting reads of a `lowlight` instance. */
interface Grammars {
	registered(name: string): boolean;
	highlight(language: string, value: string): Root;
}

const NO_GRAMMARS: Grammars = { registered: () => false, highlight: () => ({ type: "root", children: [] }) };

/** The grammars, a chunk of their own: until they land, every text highlights as uncolored lines. */
const grammars = loadedOnce<Grammars>(() =>
	import("lowlight").then(
		({ common, createLowlight }) => createLowlight(common),
		() => NO_GRAMMARS,
	),
);

export const loadGrammars = (): Promise<unknown> => grammars.load();

/** Whether the grammars have loaded, starting their load; a component that highlights reads it, so it renders again in color once they land. */
export const useGrammars = (): boolean => useLoaded(grammars) !== null;

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
	const lowlight = grammars.value ?? NO_GRAMMARS;
	const name = language.toLowerCase();
	// A file named `x.constructor` must not reach the object's prototype.
	const alias = Object.hasOwn(LANGUAGE_OF, name) ? LANGUAGE_OF[name]! : name;
	const grammar = lowlight.registered(alias) ? alias : null;
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

/** Each diff row's tokens: a removed row's from the old side, every other row's from the new side, each side highlighted as one text of its rows in order. */
export function highlightRows(rows: readonly DiffRow[], path: string): Token[][] {
	const extension = path.slice(path.lastIndexOf(".") + 1);
	const side = (number: (row: DiffRow) => number | null) => highlightLines(rows.filter(row => number(row) !== null).map(row => row.text).join("\n"), extension);
	const before = side(row => row.old);
	const after = side(row => row.new);
	let oldIndex = 0;
	let newIndex = 0;
	return rows.map(row => {
		const tokens = row.sign === "-" ? before[oldIndex] : after[newIndex];
		if (row.old !== null) oldIndex++;
		if (row.new !== null) newIndex++;
		return tokens ?? [];
	});
}
