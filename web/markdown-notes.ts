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
	/** The saved notes changed: they show once no save waits for the server, unless you have changed the text. */
	receive(value: string): void;
	/** Save what changed and stop listening. */
	dispose(): void;
}

/**
 * Saves `editor`'s notes through `onSave` `delayMs` after the last change, and on {@link NotesSync.save}. A note you
 * never changed never saves, since exporting would rewrite markdown the editor normalizes. `onSave` settles once the
 * server has handled the save; until every save has, what arrives is its echo or older, so it does not replace the text.
 * A save the server refused leaves the text changed, so it does not get replaced and saves again.
 */
export function registerNotesSync(editor: LexicalEditor, value: string, onSave: (markdown: string) => Promise<void>, delayMs: number): NotesSync {
	/** The markdown the editor exports for what was last loaded or saved: the text holds changes only when it differs. */
	let baseline = exportNotes(editor);
	/** The saved notes the editor last loaded or saved. */
	let current = value;
	/** The saved notes as last heard of: received, or saved since. */
	let latest = value;
	/** How many saves the server has not handled yet. */
	let waiting = 0;
	let disposed = false;
	let cancel = (): void => {};
	/** Shows `latest` once no save waits, unless it shows already or you have changed the text. */
	const adopt = (): void => {
		if (disposed || waiting > 0 || latest === current || exportNotes(editor) !== baseline) return;
		editor.update(() => $importNotes(latest), { discrete: true });
		editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
		current = latest;
		baseline = exportNotes(editor);
	};
	const save = (): void => {
		cancel();
		const markdown = exportNotes(editor);
		if (markdown === baseline) return;
		const before = baseline;
		baseline = markdown;
		current = markdown;
		latest = markdown;
		waiting += 1;
		onSave(markdown)
			.then(
				() => {},
				() => {
					if (baseline === markdown) baseline = before;
				},
			)
			.finally(() => {
				waiting -= 1;
				adopt();
			});
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
			latest = value;
			adopt();
		},
		dispose() {
			stop();
			save();
			disposed = true;
		},
	};
}
