import { useEffect, useRef, useState } from "react";
import { MessageMarkdown } from "./message-markdown";

interface MarkdownEditorProps {
	/** The saved markdown. */
	value: string;
	/** What the text field is named after. */
	label: string;
	/** The text cannot change, as while the server is lost or the todo is archived. */
	readOnly: boolean;
	onSave: (value: string) => void;
}

/**
 * Notes as the agent's messages render them. Clicking the render, or Enter on it, swaps it for the markdown in the
 * same type; the text saves and the render comes back when the field loses focus, and also saves on Cmd+S and when
 * the editor goes away. Until then, a change of `value` from elsewhere shows only once you have saved.
 */
export function MarkdownEditor({ value, label, readOnly, onSave }: MarkdownEditorProps) {
	/** What you typed since the last save, `null` for nothing. */
	const [draft, setDraft] = useState<string | null>(null);
	const [writing, setWriting] = useState(false);
	const text = draft ?? value;
	const dirty = draft !== null && draft !== value;
	const save = (): void => {
		if (dirty) onSave(draft);
		setDraft(null);
	};
	const latest = useRef({ dirty, draft, onSave });
	latest.current = { dirty, draft, onSave };
	useEffect(
		() => () => {
			const { dirty, draft, onSave } = latest.current;
			if (dirty && draft !== null) onSave(draft);
		},
		[],
	);
	useEffect(() => {
		if (!readOnly) return;
		const { dirty, draft, onSave } = latest.current;
		if (dirty && draft !== null) {
			onSave(draft);
			setDraft(null);
		}
	}, [readOnly]);

	if (readOnly || !writing) {
		const render = text.trim() ? <MessageMarkdown text={text} /> : <p className="text-muted-foreground">{readOnly ? "No notes." : "Add notes…"}</p>;
		if (readOnly) {
			return (
				<div className="min-w-0 text-sm leading-relaxed" aria-label={label}>
					{render}
				</div>
			);
		}
		return (
			<div
				role="button"
				tabIndex={0}
				aria-label={`Edit ${label}`}
				onClick={event => {
					// A link in the notes opens, rather than the editor.
					if (!(event.target as HTMLElement).closest("a")) setWriting(true);
				}}
				onKeyDown={event => {
					if (event.key === "Enter" && event.target === event.currentTarget) {
						event.preventDefault();
						setWriting(true);
					}
				}}
				className="-mx-2 min-h-16 min-w-0 cursor-text rounded-md px-2 py-1 text-sm leading-relaxed outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
			>
				{render}
			</div>
		);
	}
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<textarea
				autoFocus
				aria-label={label}
				placeholder="Write notes in markdown…"
				value={text}
				onChange={event => setDraft(event.target.value)}
				onBlur={() => {
					save();
					setWriting(false);
				}}
				onKeyDown={event => {
					if ((event.metaKey || event.ctrlKey) && event.key === "s") {
						event.preventDefault();
						save();
					}
					if (event.key === "Escape") event.currentTarget.blur();
				}}
				className="field-sizing-content -mx-2 min-h-32 w-[calc(100%+1rem)] resize-none rounded-md bg-background px-2 py-1 font-sans text-sm leading-relaxed text-foreground outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-ring"
			/>
			<span className="text-xs text-muted-foreground">{dirty ? "Unsaved. Click away or press Esc to save" : "Markdown. Click away or press Esc to finish"}</span>
		</div>
	);
}
