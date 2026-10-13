/** `MailEditor`: the Inbox's mail composer with recipient chips, subject, and formatted body, showing the draft a `useMailDraft` owns. */
import { $generateHtmlFromNodes } from "@lexical/html";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $isListNode, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalExtensionComposer } from "@lexical/react/LexicalExtensionComposer";
import { $createQuoteNode, $isQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $findMatchingParent } from "@lexical/utils";
import {
	$createParagraphNode,
	$getRoot,
	$getSelection,
	$isRangeSelection,
	defineExtension,
	type ElementNode,
	FORMAT_TEXT_COMMAND,
	type LexicalEditor,
	type LexicalNode,
	type TextFormatType,
} from "lexical";
import { Bold, Italic, Link, List, ListOrdered, Maximize2, Minimize2, Quote, Trash2, Underline, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import type { MailDraft, MailPerson } from "../../../src/shared/gmail";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type MailDraftEdits, mailExtension, type OpenMailDraft } from "../../mail-draft";

const ADDRESS = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;

/** `typed` as someone to write to: `Name <address>` or a bare address, else `null`. */
function personOf(typed: string): MailPerson | null {
	const text = typed.trim().replace(/,$/, "");
	const named = /^"?([^"<]*)"?\s*<([^>]+)>$/.exec(text);
	const [name, address] = named ? [named[1]!.trim(), named[2]!.trim()] : ["", text];
	return ADDRESS.test(address) ? { name, address } : null;
}

/** One field of people: a chip for each, removed with its × or Backspace, and a text box that adds who you type on Enter, comma, Tab, or leaving it; none of it while `disabled`. */
function PeopleField({ label, people, onChange, disabled, autoFocus, trailing }: { label: string; people: MailPerson[]; onChange: (people: MailPerson[]) => void; disabled: boolean; autoFocus?: boolean; trailing?: ReactNode }) {
	const [typed, setTyped] = useState("");
	const [invalid, setInvalid] = useState(false);
	const commit = (): boolean => {
		if (disabled || typed.trim() === "") return false;
		const added = typed.split(/[,;]/).map(personOf);
		if (added.some(person => person === null)) {
			setInvalid(true);
			return false;
		}
		const known = new Set(people.map(person => person.address.toLowerCase()));
		onChange([...people, ...(added as MailPerson[]).filter(person => !known.has(person.address.toLowerCase()))]);
		setTyped("");
		return true;
	};
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
		if (event.key === "Enter" || event.key === "," || event.key === ";" || (event.key === "Tab" && typed.trim() !== "")) {
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) return;
			if (commit() || event.key !== "Tab") event.preventDefault();
		} else if (event.key === "Backspace" && typed === "" && people.length > 0) {
			event.preventDefault();
			onChange(people.slice(0, -1));
		}
	};
	return (
		<div className="flex min-h-10 items-center gap-2 border-b border-border px-4 py-1.5 text-sm">
			<span className="w-14 shrink-0 text-muted-foreground">{label}</span>
			<ul aria-label={label} className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
				{people.map(person => (
					<li key={person.address} className="flex max-w-full items-center gap-1 rounded-md bg-muted py-0.5 pr-1 pl-2" title={person.address}>
						<span className="truncate">{person.name || person.address}</span>
						<button
							type="button"
							aria-label={`Remove ${person.name || person.address}`}
							disabled={disabled}
							onClick={() => onChange(people.filter(other => other !== person))}
							className="rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
						>
							<X className="size-3.5" />
						</button>
					</li>
				))}
				<li className="min-w-32 flex-1">
					<input
						// biome-ignore lint/a11y/noAutofocus: a new mail opens to say whom it goes to.
						autoFocus={autoFocus}
						aria-label={`Add to ${label}`}
						aria-invalid={invalid || undefined}
						value={typed}
						disabled={disabled}
						onChange={event => {
							setTyped(event.target.value);
							setInvalid(false);
						}}
						onKeyDown={onKeyDown}
						onBlur={commit}
						className={cn("w-full bg-transparent py-0.5 outline-none", invalid && "text-red-600 dark:text-red-400")}
					/>
				</li>
			</ul>
			{trailing}
		</div>
	);
}

const THEME = {
	list: { ul: "list-disc pl-6", ol: "list-decimal pl-6" },
	quote: "border-l-2 border-border pl-3 text-muted-foreground",
	link: "text-blue-600 underline dark:text-blue-400",
	text: { bold: "font-semibold", italic: "italic", underline: "underline" },
};

/** What the selection sits in, for the toolbar to show pressed. */
interface Formats {
	bold: boolean;
	italic: boolean;
	underline: boolean;
	link: boolean;
	bullet: boolean;
	number: boolean;
	quote: boolean;
}

const NO_FORMATS: Formats = { bold: false, italic: false, underline: false, link: false, bullet: false, number: false, quote: false };

function $formats(): Formats {
	const selection = $getSelection();
	if (!$isRangeSelection(selection)) return NO_FORMATS;
	const node = selection.anchor.getNode();
	const list = $findMatchingParent(node, $isListNode);
	const listType = list && $isListNode(list) ? list.getListType() : null;
	return {
		bold: selection.hasFormat("bold"),
		italic: selection.hasFormat("italic"),
		underline: selection.hasFormat("underline"),
		link: $findMatchingParent(node, $isLinkNode) !== null,
		bullet: listType === "bullet",
		number: listType === "number",
		quote: $findMatchingParent(node, (parent: LexicalNode) => $isQuoteNode(parent)) !== null,
	};
}

function ToolButton({ label, keys, pressed, disabled, onClick, children }: { label: string; keys?: string[]; pressed?: boolean; disabled: boolean; onClick: () => void; children: ReactNode }) {
	return (
		<Tooltip content={label} shortcut={keys}>
			<Button
				type="button"
				variant="ghost"
				size="icon-compact"
				aria-label={label}
				aria-pressed={pressed}
				disabled={disabled}
				// Keeps the editor's selection, which a click on the button would otherwise move away from.
				onMouseDown={event => event.preventDefault()}
				onClick={onClick}
				className={cn(pressed && "bg-accent text-foreground")}
			>
				{children}
			</Button>
		</Tooltip>
	);
}

/** Bold, italic, underline, a link, a bulleted or numbered list, and a quote, each pressed while the selection holds it; none while `disabled`. */
function Toolbar({ editor, disabled }: { editor: LexicalEditor; disabled: boolean }) {
	const [formats, setFormats] = useState(NO_FORMATS);
	useEffect(() => editor.registerUpdateListener(({ editorState }) => setFormats(editorState.read($formats))), [editor]);
	const format = (kind: TextFormatType) => () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, kind);
	const link = (): void => {
		if (formats.link) {
			editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
			return;
		}
		const url = window.prompt("Link to")?.trim();
		if (url) editor.dispatchCommand(TOGGLE_LINK_COMMAND, /^[a-z]+:/i.test(url) ? url : `https://${url}`);
	};
	const quote = (): void =>
		editor.update(() => {
			const selection = $getSelection();
			if ($isRangeSelection(selection)) $setBlocksType(selection, (): ElementNode => (formats.quote ? $createParagraphNode() : $createQuoteNode()));
		});
	return (
		<div role="toolbar" aria-label="Formatting" className="flex items-center gap-0.5">
			<ToolButton label="Bold" keys={["⌘", "B"]} pressed={formats.bold} disabled={disabled} onClick={format("bold")}>
				<Bold />
			</ToolButton>
			<ToolButton label="Italic" keys={["⌘", "I"]} pressed={formats.italic} disabled={disabled} onClick={format("italic")}>
				<Italic />
			</ToolButton>
			<ToolButton label="Underline" keys={["⌘", "U"]} pressed={formats.underline} disabled={disabled} onClick={format("underline")}>
				<Underline />
			</ToolButton>
			<ToolButton label={formats.link ? "Remove link" : "Link"} pressed={formats.link} disabled={disabled} onClick={link}>
				<Link />
			</ToolButton>
			<ToolButton label="Bulleted list" pressed={formats.bullet} disabled={disabled} onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}>
				<List />
			</ToolButton>
			<ToolButton label="Numbered list" pressed={formats.number} disabled={disabled} onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}>
				<ListOrdered />
			</ToolButton>
			<ToolButton label="Quote" pressed={formats.quote} disabled={disabled} onClick={quote}>
				<Quote />
			</ToolButton>
		</div>
	);
}

interface MailEditorProps {
	/** The draft it shows, frozen while it is being sent; `edit` changes and sends it, and the `useMailDraft` that hands both over owns it. */
	draft: OpenMailDraft;
	edit: MailDraftEdits;
	/** Who it says it is to: `Reply to`, `Reply all`, or `To` for a new mail. */
	toLabel: string;
	/** Whether it has a subject row, as a new mail does; a reply keeps the conversation's. */
	withSubject: boolean;
	/** Whether the To field takes focus first, as a new mail's does; a reply's body takes it. */
	focusPeople?: boolean;
	/** Whether it fills the page instead of the bottom of it. */
	expanded: boolean;
	onExpand?: (expanded: boolean) => void;
	onSend: (draft: MailDraft) => Promise<void>;
	/** Called on Esc: the editor closes and keeps the draft. */
	onClose: () => void;
	/** Called once the draft is sent, even when the browser cannot forget it, or thrown away. */
	onDone: () => void;
}

/**
 * A mail being written, as Front lays one out: whom it goes to as chips, with Cc and Bcc rows a click away, the subject
 * of a new mail, the formatted body, and a bottom row of formatting and Send. ⌘Enter sends and Esc closes it.
 */
export function MailEditor(props: MailEditorProps) {
	const [extension] = useState(() =>
		defineExtension({
			name: "[root]",
			namespace: "mail",
			dependencies: [mailExtension],
			theme: THEME,
			onError: error => console.error(error),
			...(props.draft.document.body ? { $initialEditorState: (editor: LexicalEditor) => editor.setEditorState(editor.parseEditorState(props.draft.document.body)) } : {}),
		}),
	);
	return (
		<LexicalExtensionComposer extension={extension} contentEditable={null}>
			<Editor {...props} />
		</LexicalExtensionComposer>
	);
}

function Editor({ draft: { document: mail, phase }, edit, toLabel, withSubject, focusPeople, expanded, onExpand, onSend, onClose, onDone }: MailEditorProps) {
	const [editor] = useLexicalComposerContext();
	const [revealed, setRevealed] = useState({ cc: false, bcc: false });
	const shown = { cc: revealed.cc || mail.cc.length > 0, bcc: revealed.bcc || mail.bcc.length > 0 };
	const sending = phase.kind === "sending";

	const { editBody } = edit;
	useEffect(
		() =>
			editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
				if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
				const blank = editorState.read(() => $getRoot().getTextContent().trim() === "");
				editBody(blank ? "" : JSON.stringify(editorState.toJSON()));
			}),
		[editor, editBody],
	);
	useEffect(() => {
		if (!focusPeople) editor.focus();
	}, [editor]);
	// In the commit that starts a send, before the next key reaches the body, so what it shows stays what is sent.
	useLayoutEffect(() => editor.setEditable(!sending), [editor, sending]);

	const empty = mail.body === "";
	const nobody = mail.to.length + mail.cc.length + mail.bcc.length === 0;
	const send = async (): Promise<void> => {
		if (sending || empty || nobody) return;
		const sent = await edit.send(submitted =>
			onSend({
				to: submitted.to,
				cc: submitted.cc,
				bcc: submitted.bcc,
				subject: submitted.subject,
				...editor.read(() => ({ html: $generateHtmlFromNodes(editor, null).replace(/(<p><br><\/p>)+$/, ""), text: $getRoot().getTextContent().trimEnd() })),
			}),
		);
		if (sent) onDone();
	};
	const discard = (): void => {
		edit.discard();
		onDone();
	};
	const onKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			void send();
		} else if (event.key === "Escape" && !sending) {
			event.preventDefault();
			event.stopPropagation();
			onClose();
		}
	};
	// A Cc or Bcc row stays once shown, even after its last chip goes.
	const editShown = (field: "cc" | "bcc") => (people: MailPerson[]) => {
		setRevealed(current => ({ ...current, [field]: true }));
		edit.editRecipients(field, people);
	};

	const reveal = (field: "cc" | "bcc") => (
		<button type="button" onClick={() => setRevealed(current => ({ ...current, [field]: true }))} className="rounded-sm px-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
			{field === "cc" ? "Cc" : "Bcc"}
		</button>
	);
	const toTrailing = (
		<span className="flex shrink-0 items-center gap-1 text-sm">
			{!shown.cc && reveal("cc")}
			{!shown.bcc && reveal("bcc")}
			{onExpand && (
				<Tooltip content={expanded ? "Shrink" : "Expand"}>
					<Button type="button" variant="ghost" size="icon-compact" aria-label={expanded ? "Shrink" : "Expand"} onClick={() => onExpand(!expanded)}>
						{expanded ? <Minimize2 /> : <Maximize2 />}
					</Button>
				</Tooltip>
			)}
		</span>
	);
	return (
		<form
			aria-label={withSubject ? "New mail" : toLabel}
			onKeyDown={onKeyDown}
			onSubmit={event => {
				event.preventDefault();
				void send();
			}}
			className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-lg", expanded && "flex-1")}
		>
			<PeopleField label={toLabel} people={mail.to} onChange={to => edit.editRecipients("to", to)} disabled={sending} autoFocus={focusPeople} trailing={toTrailing} />
			{shown.cc && <PeopleField label="Cc" people={mail.cc} onChange={editShown("cc")} disabled={sending} />}
			{shown.bcc && <PeopleField label="Bcc" people={mail.bcc} onChange={editShown("bcc")} disabled={sending} />}
			{withSubject && (
				<label className="flex min-h-10 items-center gap-2 border-b border-border px-4 text-sm">
					<span className="w-14 shrink-0 text-muted-foreground">Subject</span>
					<input value={mail.subject} disabled={sending} onChange={event => edit.editSubject(event.target.value)} className="min-w-0 flex-1 bg-transparent py-1.5 outline-none" />
				</label>
			)}
			<div className={cn("relative min-h-0 overflow-y-auto", expanded ? "flex-1" : "max-h-[40vh]")}>
				<ContentEditable
					aria-label="Message"
					aria-placeholder="Write your message…"
					placeholder={<p className="pointer-events-none absolute top-3 left-4 select-none text-sm text-muted-foreground">Write your message…</p>}
					className={cn("min-h-28 space-y-2 px-4 py-3 text-sm leading-relaxed outline-none", expanded && "h-full")}
				/>
			</div>
			{phase.kind === "editing" && phase.failure && (
				<p role="alert" className="px-4 pb-2 text-xs text-red-600 dark:text-red-400">
					Cannot send: {phase.failure}
				</p>
			)}
			<div className="flex items-center gap-2 border-t border-border px-2 py-1.5">
				<Toolbar editor={editor} disabled={sending} />
				<Tooltip content="Discard draft">
					<Button type="button" variant="ghost" size="icon-compact" aria-label="Discard draft" disabled={sending} onClick={discard}>
						<Trash2 />
					</Button>
				</Tooltip>
				<span className="ml-auto hidden text-xs text-muted-foreground sm:inline">⌘↵ to send · Esc to close</span>
				<Button type="submit" size="sm" disabled={sending || empty || nobody}>
					{sending ? "Sending…" : "Send"}
				</Button>
			</div>
		</form>
	);
}
