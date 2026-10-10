import { HistoryExtension } from "@lexical/history";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalExtensionComposer } from "@lexical/react/LexicalExtensionComposer";
import { defineExtension } from "lexical";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { $importNotes, type NotesSync, notesExtension, registerNotesSync } from "../markdown-notes";

interface NotesEditorProps {
	/** The saved markdown. */
	value: string;
	/** What the text field is named after. */
	label: string;
	/** The text cannot change, as while the server is lost or the todo is archived. */
	readOnly: boolean;
	onSave: (value: string) => void;
}

const THEME = {
	code: "notes-code",
	list: { checklist: "notes-checklist", listitemChecked: "notes-checked", listitemUnchecked: "notes-unchecked", nested: { listitem: "notes-nested" } },
	text: { italic: "italic", strikethrough: "line-through" },
};

/** How long after the last change the notes save by themselves, so a ticked check item saves without a blur. */
const SAVE_AFTER_MS = 800;

/**
 * A todo's notes, always formatted, edited in place: markdown typed at the start of a line or around text formats it as
 * you type. The text saves a moment after you stop changing it, when the field loses focus, on Esc, on Cmd+S, when the
 * editor goes away, and when it turns read-only.
 */
export function NotesEditor({ value, label, readOnly, onSave }: NotesEditorProps) {
	// Built once: the editor keeps its own document from then on, and `Notes` follows `value`.
	const [extension] = useState(() =>
		defineExtension({
			name: "[root]",
			namespace: "notes",
			dependencies: [notesExtension, HistoryExtension],
			theme: THEME,
			editable: !readOnly,
			onError: error => console.error(error),
			$initialEditorState: () => $importNotes(value),
		}),
	);
	return (
		// `null`: the editable renders as a child, since a new `contentEditable` element would build a new editor.
		<LexicalExtensionComposer extension={extension} contentEditable={null}>
			<Notes value={value} label={label} readOnly={readOnly} onSave={onSave} />
		</LexicalExtensionComposer>
	);
}

function Notes({ value, label, readOnly, onSave }: NotesEditorProps) {
	const [editor] = useLexicalComposerContext();
	const latestSave = useRef(onSave);
	latestSave.current = onSave;
	const sync = useRef<NotesSync | null>(null);
	const save = (): void => sync.current?.save();

	useEffect(() => {
		const notes = registerNotesSync(editor, value, markdown => latestSave.current(markdown), SAVE_AFTER_MS);
		sync.current = notes;
		return notes.dispose;
	}, [editor]);

	useEffect(() => sync.current?.receive(value), [value]);

	useEffect(() => {
		if (readOnly) save();
		editor.setEditable(!readOnly);
	}, [editor, readOnly]);

	const placeholder = readOnly ? "No notes." : "Add notes…";
	return (
		<div className="relative min-w-0">
			<ContentEditable
				aria-label={label}
				aria-placeholder={placeholder}
				placeholder={<p className="pointer-events-none absolute top-1 left-0 select-none text-sm leading-relaxed text-muted-foreground">{placeholder}</p>}
				onBlur={save}
				onKeyDown={event => {
					if ((event.metaKey || event.ctrlKey) && event.key === "s") {
						event.preventDefault();
						save();
					}
					if (event.key === "Escape") event.currentTarget.blur();
				}}
				className={cn(
					"message-markdown notes-editor -mx-2 min-h-16 min-w-0 rounded-md px-2 py-1 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring",
					!readOnly && "cursor-text hover:bg-accent/40",
				)}
			/>
		</div>
	);
}
