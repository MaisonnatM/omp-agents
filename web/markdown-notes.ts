/**
 * A todo's notes as a Lexical document. The notes stay a markdown string everywhere else; this module is the one place
 * that turns that string into the editor's nodes and back, and decides when the editor's text saves.
 */
import { CodeExtension } from "@lexical/code-core";
import { buildEditorFromExtensions } from "@lexical/extension";
import { AutoLinkExtension, autoLinkUrlMatcher, ClickableLinkExtension, LinkExtension } from "@lexical/link";
import { CheckListExtension, ListExtension } from "@lexical/list";
import { $convertFromMarkdownString, $convertToMarkdownString, CHECK_LIST, registerMarkdownShortcuts, TRANSFORMERS, type Transformer } from "@lexical/markdown";
import { RichTextExtension } from "@lexical/rich-text";
import { CLEAR_HISTORY_COMMAND, configExtension, defineExtension, type LexicalEditor, TEXT_TYPE_TO_FORMAT, type TextFormatType, TextNode } from "lexical";

// `- [ ] a` also reads as a bullet, so the check list has to be tried first.
const NOTE_TRANSFORMERS: Transformer[] = [CHECK_LIST, ...TRANSFORMERS];

const MARKDOWN_FORMATS: readonly TextFormatType[] = ["bold", "italic", "strikethrough", "code"];
/** Formats Cmd+U or a paste can apply that markdown cannot hold, so the note would lose them on its next load. */
const OTHER_FORMATS = (Object.keys(TEXT_TYPE_TO_FORMAT) as TextFormatType[]).filter(format => !MARKDOWN_FORMATS.includes(format));

function $keepMarkdownFormats(node: TextNode): void {
	for (const format of OTHER_FORMATS) if (node.hasFormat(format)) node.toggleFormat(format);
}

/** The nodes notes hold and what typing markdown does to them; without the editable and history, which the view adds. */
export const notesExtension = defineExtension({
	name: "notes/markdown",
	dependencies: [
		RichTextExtension,
		ListExtension,
		CheckListExtension,
		LinkExtension,
		configExtension(ClickableLinkExtension, { newTab: true }),
		configExtension(AutoLinkExtension, { matchers: [autoLinkUrlMatcher] }),
		CodeExtension,
	],
	register: editor => {
		const stops = [registerMarkdownShortcuts(editor, NOTE_TRANSFORMERS), editor.registerNodeTransform(TextNode, $keepMarkdownFormats)];
		return () => {
			for (const stop of stops) stop();
		};
	},
});

// Preserving newlines keeps a single line break a line break, so plain notes come back as they were written.
export const $importNotes = (markdown: string): void => $convertFromMarkdownString(markdown, NOTE_TRANSFORMERS, undefined, true);

const $exportEscaped = (): string => $convertToMarkdownString(NOTE_TRANSFORMERS, undefined, true);

/** Where {@link exportNotes} reads markdown back, apart from the editor on screen. */
let scratch: LexicalEditor | null = null;

/**
 * The editor's document as markdown. Lexical writes a backslash before every `*`, `_`, `` ` ``, and `~` of plain text;
 * they go when the note reads the same without them, so a path such as `~/my_repo` stays as typed for search and for
 * an agent's prompt.
 */
export function exportNotes(editor: LexicalEditor): string {
	const escaped = editor.read($exportEscaped);
	const plain = escaped.replace(/\\([*_`~])/g, "$1");
	if (plain === escaped) return escaped;
	scratch ??= buildEditorFromExtensions(defineExtension({ name: "notes/scratch", dependencies: [notesExtension] }));
	scratch.update(() => $importNotes(plain), { discrete: true });
	return scratch.read($exportEscaped) === escaped ? plain : escaped;
}

export interface NotesSync {
	/** Save now what changed since the last load or save. */
	save(): void;
	/** The saved notes changed: an echo of a save is ignored, and another window's change shows unless you have changed the text. */
	receive(value: string): void;
	/** Save what changed and stop listening. */
	dispose(): void;
}

/**
 * Saves `editor`'s notes through `onSave` `delayMs` after the last change, and on {@link NotesSync.save}. A note you
 * never changed never saves, since exporting would rewrite markdown the editor normalizes.
 */
export function registerNotesSync(editor: LexicalEditor, value: string, onSave: (markdown: string) => void, delayMs: number): NotesSync {
	/** The markdown the editor exports for what was last loaded or saved: the text holds changes only when it differs. */
	let baseline = exportNotes(editor);
	/** The saved notes the editor last loaded or saved. */
	let current = value;
	/** Saves whose echo has not come back, oldest first. */
	const sent: string[] = [];
	let cancel = (): void => {};
	const save = (): void => {
		cancel();
		const markdown = exportNotes(editor);
		if (markdown === baseline) return;
		baseline = markdown;
		current = markdown;
		sent.push(markdown);
		onSave(markdown);
	};
	const stop = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
		if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
		cancel();
		const timer = setTimeout(save, delayMs);
		cancel = () => clearTimeout(timer);
	});
	return {
		save,
		receive(value) {
			const echo = sent.indexOf(value);
			if (echo >= 0) {
				sent.splice(0, echo + 1);
				return;
			}
			if (value === current || exportNotes(editor) !== baseline) return;
			editor.update(() => $importNotes(value), { discrete: true });
			editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
			current = value;
			baseline = exportNotes(editor);
		},
		dispose() {
			stop();
			save();
		},
	};
}
