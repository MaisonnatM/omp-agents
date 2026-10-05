import { Eye, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { SizeProvider } from "@/lib/size-context";
import { MessageMarkdown } from "./message-markdown";

type EditorTab = "write" | "preview";

interface MarkdownEditorProps {
	/** The saved markdown. */
	value: string;
	/** What the text field and the tabs are named after. */
	label: string;
	/** The text cannot change, as while the server is lost. */
	readOnly: boolean;
	onSave: (value: string) => void;
}

/**
 * Markdown to write in a text field or read rendered as the agent's messages are. What you type saves when the field
 * loses focus, on Cmd+S, on a switch of tab, and when the editor goes away; until then, a change of `value` from
 * elsewhere shows only once you have saved.
 */
export function MarkdownEditor({ value, label, readOnly, onSave }: MarkdownEditorProps) {
	const [tab, setTab] = useState<EditorTab>(value.trim() ? "preview" : "write");
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

	return (
		<Tabs
			value={tab}
			onValueChange={next => {
				save();
				setTab(next === "preview" ? "preview" : "write");
			}}
			className="flex min-w-0 flex-col gap-2"
		>
			<div className="flex items-center justify-between gap-3">
				<SizeProvider size="compact">
					<TabsList aria-label={label}>
						<TabItem value="write" label="Write" icon={Pencil} />
						<TabItem value="preview" label="Preview" icon={Eye} />
					</TabsList>
				</SizeProvider>
				{dirty && <span className="text-xs text-muted-foreground">Unsaved</span>}
			</div>
			<TabPanel value="write">
				<textarea
					aria-label={label}
					placeholder="Write notes in markdown…"
					readOnly={readOnly}
					value={text}
					onChange={event => setDraft(event.target.value)}
					onBlur={save}
					onKeyDown={event => {
						if ((event.metaKey || event.ctrlKey) && event.key === "s") {
							event.preventDefault();
							save();
						}
					}}
					className="min-h-64 w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
			</TabPanel>
			<TabPanel value="preview" className="min-h-16 rounded-md border border-border px-4 py-3 text-sm leading-relaxed">
				{text.trim() ? <MessageMarkdown text={text} /> : <p className="text-muted-foreground">Nothing to preview.</p>}
			</TabPanel>
		</Tabs>
	);
}
