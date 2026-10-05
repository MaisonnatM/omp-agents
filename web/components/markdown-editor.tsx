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
 * Notes as the agent's messages render them. The render stays on screen. While the notes can change, the same text
 * is edited under that render, in the same type, and saves when the field loses focus, on Cmd+S, and when the editor
 * goes away. Until then, a change of `value` from elsewhere shows only once you have saved.
 */
export function MarkdownEditor({ value, label, readOnly, onSave }: MarkdownEditorProps) {
	/** What you typed since the last save, `null` for nothing. */
	const [draft, setDraft] = useState<string | null>(null);
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

	return (
		<div className="flex min-w-0 flex-col gap-2">
			{dirty && <span className="text-xs text-muted-foreground">Unsaved</span>}
			<div className="overflow-hidden rounded-md border border-border">
				<div className="min-h-16 px-4 py-3 text-sm leading-relaxed" aria-label={readOnly ? label : undefined} aria-hidden={readOnly ? undefined : true}>
					{text.trim() ? <MessageMarkdown text={text} /> : <p className="text-muted-foreground">Nothing to preview.</p>}
				</div>
				{!readOnly && (
					<textarea
						aria-label={label}
						placeholder="Write notes in markdown…"
						value={text}
						onChange={event => setDraft(event.target.value)}
						onBlur={save}
						onKeyDown={event => {
							if ((event.metaKey || event.ctrlKey) && event.key === "s") {
								event.preventDefault();
								save();
							}
						}}
						className="min-h-32 w-full resize-y border-t border-border bg-background px-4 py-3 font-sans text-sm leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				)}
			</div>
		</div>
	);
}
