import { expect, test } from "bun:test";
import { buildEditorFromExtensions } from "@lexical/extension";
import { $createParagraphNode, $createTextNode, $getRoot, defineExtension } from "lexical";
import { $fill, $replaceRange, ChipNode } from "./prompt-editor";

const editor = buildEditorFromExtensions(
	defineExtension({
		name: "[root]",
		nodes: [ChipNode],
		onError: error => {
			throw error;
		},
	}),
);

/** The prompt after `text` has `replacement` in place of offsets `start` to `end`. */
function replaced(text: string, start: number, end: number, replacement: string): string {
	editor.update(
		() => {
			$fill(text);
			$replaceRange(start, end, replacement);
		},
		{ discrete: true },
	);
	return editor.read(() => $getRoot().getTextContent());
}

test("replace puts text at a caret, over a selection, across a line break, and at the end", () => {
	expect(replaced("fix  bug", 4, 4, "the")).toBe("fix the bug");
	expect(replaced("fix it now", 4, 6, "the bug")).toBe("fix the bug now");
	expect(replaced("first\nsecond", 3, 8, "-")).toBe("fir-cond");
	expect(replaced("done", 4, 4, "!")).toBe("done!");
	expect(replaced("", 0, 0, "spoken")).toBe("spoken");
});

test("replace counts a chip as the characters it stands for", () => {
	editor.update(
		() => {
			const paragraph = $createParagraphNode();
			paragraph.append($createTextNode("see "), new ChipNode({ kind: "file", label: "a.ts", target: "a.ts", text: "@a.ts" }), $createTextNode(" now"));
			$getRoot().clear().append(paragraph);
			$replaceRange(9, 9, " and b.ts");
		},
		{ discrete: true },
	);
	expect(editor.read(() => $getRoot().getTextContent())).toBe("see @a.ts and b.ts now");
});
