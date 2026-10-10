import { expect, test, vi } from "bun:test";
import { buildEditorFromExtensions } from "@lexical/extension";
import { $isListNode } from "@lexical/list";
import { $createParagraphNode, $createTextNode, $getRoot, defineExtension, type LexicalEditor, type ParagraphNode } from "lexical";
import { $importNotes, exportNotes, notesExtension, registerNotesSync } from "./markdown-notes";

const newEditor = (): LexicalEditor =>
	buildEditorFromExtensions(
		defineExtension({
			name: "[root]",
			dependencies: [notesExtension],
			onError: error => {
				throw error;
			},
		}),
	);

const editor = newEditor();

/** Loads `markdown` into the editor and reads back its blocks, its text, and the markdown it saves. */
function load(markdown: string): { blocks: string[]; text: string; saved: string } {
	editor.update(() => $importNotes(markdown), { discrete: true });
	return {
		...editor.read(() => ({
			blocks: $getRoot()
				.getChildren()
				.map(node => ($isListNode(node) ? `list:${node.getListType()}` : node.getType())),
			text: $getRoot().getTextContent(),
		})),
		saved: exportNotes(editor),
	};
}

test("a note with every format the editor writes saves back unchanged", () => {
	const note = [
		"# Plan",
		"",
		"Some **bold**, *italic*, ~~gone~~, `code` and a [link](https://example.com).",
		"",
		"- one",
		"- two",
		"",
		"- [x] done",
		"- [ ] todo",
		"",
		"1. first",
		"2. second",
		"",
		"> quoted",
		"",
		"```ts",
		"const a = 1;",
		"```",
		"",
		"line one",
		"line two",
	].join("\n");
	const { blocks, saved } = load(note);
	expect(blocks).toEqual([
		"heading",
		"paragraph",
		"paragraph",
		"paragraph",
		"list:bullet",
		"paragraph",
		"list:check",
		"paragraph",
		"list:number",
		"paragraph",
		"quote",
		"paragraph",
		"code",
		"paragraph",
		"paragraph",
		"paragraph",
	]);
	expect(saved).toBe(note);
});

test("plain lines stay lines", () => {
	expect(load("Assurance · soirée\nsecond line")).toEqual({
		blocks: ["paragraph", "paragraph"],
		text: "Assurance · soirée\n\nsecond line",
		saved: "Assurance · soirée\nsecond line",
	});
	expect(load("a\n\n\nb\n").saved).toBe("a\n\n\nb\n");
});

test("paths, identifiers, and lone stars save as typed, without backslashes", () => {
	expect(load("~/code/my_repo/file_name.ts and 2 * 3 * 4, a ~ b, ~~~")).toEqual({
		blocks: ["paragraph"],
		text: "~/code/my_repo/file_name.ts and 2 * 3 * 4, a ~ b, ~~~",
		saved: "~/code/my_repo/file_name.ts and 2 * 3 * 4, a ~ b, ~~~",
	});
});

test("text that would read as formatting keeps its backslashes", () => {
	expect(load("\\*not italic\\* in my\\_repo")).toEqual({ blocks: ["paragraph"], text: "*not italic* in my_repo", saved: "\\*not italic\\* in my\\_repo" });
});

test("a bare URL becomes a link and saves as the URL", () => {
	expect(load("see https://example.com now").saved).toBe("see https://example.com now");
	expect(editor.read(() => $getRoot().getAllTextNodes().map(node => node.getParent()?.getType()))).toEqual(["paragraph", "autolink", "paragraph"]);
});

test("GitHub tables and raw HTML show as their source text and save unchanged", () => {
	expect(load("| a | b |\n| - | - |\n| 1 | 2 |")).toEqual({
		blocks: ["paragraph", "paragraph", "paragraph"],
		text: "| a | b |\n\n| - | - |\n\n| 1 | 2 |",
		saved: "| a | b |\n| - | - |\n| 1 | 2 |",
	});
	expect(load("<b>hi</b><br>")).toEqual({ blocks: ["paragraph"], text: "<b>hi</b><br>", saved: "<b>hi</b><br>" });
});

test("formatting markdown cannot hold does not stay on the text", () => {
	editor.update(
		() => {
			const text = $createTextNode("hi").toggleFormat("bold").toggleFormat("underline").toggleFormat("highlight");
			$getRoot().clear().append($createParagraphNode().append(text));
		},
		{ discrete: true },
	);
	expect(editor.read(() => $getRoot().getAllTextNodes().map(node => [node.hasFormat("bold"), node.hasFormat("underline"), node.hasFormat("highlight")]))).toEqual([[true, false, false]]);
	expect(exportNotes(editor)).toBe("**hi**");
});

/** A fresh editor holding `markdown`, its sync, and every markdown the sync saved. */
function synced(markdown: string) {
	const notes = newEditor();
	notes.update(() => $importNotes(markdown), { discrete: true });
	const saves: string[] = [];
	const sync = registerNotesSync(notes, markdown, saved => saves.push(saved), 800);
	const type = (text: string): void => notes.update(() => $getRoot().getLastChildOrThrow<ParagraphNode>().append($createTextNode(text)), { discrete: true });
	const text = (): string => notes.read(() => $getRoot().getTextContent());
	return { notes, saves, sync, type, text };
}

test("a note you never changed never saves, even one the editor would write differently", () => {
	const { saves, sync } = synced("__bold__ and - [ ]  spaced");
	sync.save();
	sync.dispose();
	expect(saves).toEqual([]);
});

test("a change saves once, after the pause", () => {
	vi.useFakeTimers();
	try {
		const { saves, type } = synced("a");
		type("b");
		vi.advanceTimersByTime(500);
		type("c");
		vi.advanceTimersByTime(500);
		expect(saves).toEqual([]);
		vi.advanceTimersByTime(300);
		expect(saves).toEqual(["abc"]);
	} finally {
		vi.useRealTimers();
	}
});

test("the echo of an earlier save leaves newer text alone", () => {
	const { saves, sync, type, text } = synced("a");
	type("b");
	sync.save();
	type("c");
	sync.save();
	expect(saves).toEqual(["ab", "abc"]);
	sync.receive("ab");
	sync.receive("abc");
	expect(text()).toBe("abc");
});

test("another window's change shows while you have changed nothing, and waits while you have", () => {
	const { saves, sync, type, text } = synced("a");
	sync.receive("from elsewhere");
	expect(text()).toBe("from elsewhere");
	type("!");
	sync.receive("again");
	expect(text()).toBe("from elsewhere!");
	sync.dispose();
	expect(saves).toEqual(["from elsewhere!"]);
});
