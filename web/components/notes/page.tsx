import { Bot, NotebookPen, Pencil, Plus, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import { everyWord } from "../../../src/shared/every-word";
import { addNote } from "../../../src/user-notes";
import { MAX_NOTE_TITLE } from "../../../src/user-notes-parse";
import type { UserNote, UserNoteChange, UserNoteList } from "../../../src/user-notes-shared";
import type { UserTodoList } from "../../../src/user-todos-shared";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, MenuItem, MenuLinkItem, MenuSeparator } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { dayLabel } from "../../labels";
import { notesIn, notesListText } from "../../notes-views";
import { PAGE_ICON } from "../../page-icons";
import { hashForNotes, hashForTodoId, type NotesListView } from "../../routing";
import { shortcutLabels, useShortcuts } from "../../shortcuts";
import { useOpenLatest } from "../../use-open-latest";
import { FieldPicker } from "../field-picker";
import { focusRow, PageFrame, stepRows, useReturnFocus } from "../list-page";
import { CH_CLOSE, CH_NEXT, CH_PREVIOUS, DetailBar, ListSplit } from "../list-split";
import { NotesEditor } from "../notes-editor";
import { SearchField } from "../search-field";
import { toasts } from "../toaster";
import { AddedByChip } from "../todo/links";

interface NotesPageProps {
	list: UserNoteList | null;
	todos: UserTodoList | null;
	view: NotesListView;
	openId: string | null;
	disabled: boolean;
	onChange: (change: UserNoteChange) => void;
	hosts: RosterHost[];
	past: PastSession[];
}

export function NotesPage({ list, ...props }: NotesPageProps) {
	if (list === null) return <PageFrame title="Notes" meta="Your Markdown notes"><p className="px-6 py-6 text-sm text-muted-foreground">Loading your notes…</p></PageFrame>;
	return <LoadedNotesPage list={list} {...props} />;
}

function LoadedNotesPage({ list, todos, view, openId, disabled, onChange, hosts, past }: NotesPageProps & { list: UserNoteList }) {
	const [query, setQuery] = useState("");
	const search = useRef<HTMLInputElement>(null);
	const titleField = useRef<HTMLInputElement>(null);
	/** The note whose title takes focus once it opens: one just written, or one picked to rename. */
	const [naming, setNaming] = useState<string | null>(null);
	const listed = notesIn(list, view);
	const matches = everyWord(query);
	const shown = listed.filter(note => matches(`${note.title}\n${note.body}`));
	const open = listed.find(note => note.id === openId) ?? null;
	const at = shown.findIndex(note => note.id === openId);
	const text = notesListText(view);
	const navigate = (id: string | null): void => { location.hash = hashForNotes(view, id); };
	const rowOf = (note: UserNote): HTMLElement | null => document.getElementById(`note-${note.id}`);
	useReturnFocus(open?.id ?? null, id => id, id => document.getElementById(`note-${id}`)?.querySelector("a"), list);
	useEffect(() => {
		if (naming !== null && open?.id === naming) titleField.current?.focus();
	}, [naming, open?.id]);
	const create = (): void => {
		if (disabled) return;
		const change = addNote();
		onChange(change);
		setQuery("");
		setNaming(change.note.id);
		location.hash = hashForNotes({ kind: "all" }, change.note.id);
	};
	const step = (by: -1 | 1): void => {
		if (open !== null) {
			const next = shown[at + by];
			if (next) {
				navigate(next.id);
				const row = rowOf(next);
				if (row) focusRow(row);
			}
			return;
		}
		stepRows(shown, rowOf, by);
	};
	useShortcuts({ notesSearch: () => search.current?.focus(), notesNew: create, notesNext: () => step(1), notesPrevious: () => step(-1), notesClose: () => { if (open !== null) navigate(null); } });
	useOpenLatest(id => hashForNotes(view, id), openId, shown[0]?.id ?? null, true);
	const remove = (note: UserNote): void => {
		const index = list.notes.findIndex(row => row.id === note.id);
		onChange({ op: "remove", id: note.id });
		navigate(null);
		toasts.add({ id: "note-undo", title: `Deleted “${note.title || "Untitled"}”`, timeout: 8000, actionProps: { children: "Undo", onClick: () => {
			onChange({ op: "restore", note, index });
			location.hash = hashForNotes(view, note.id);
			toasts.close("note-undo");
		} } });
	};
	const rename = (note: UserNote): void => {
		setNaming(note.id);
		navigate(note.id);
	};
	return (
		<PageFrame title={view.kind === "all" ? "Notes" : text.name} meta={`${listed.length} ${listed.length === 1 ? "note" : "notes"}`} actions={<>
			<SearchField ref={search} label="Search notes" placeholder="Search" query={query} onQuery={setQuery} className="w-32" />
			<Tooltip content="Write a new note" shortcut={shortcutLabels("notesNew")}><Button variant="tertiary" size="compact" leadingIcon={Plus} disabled={disabled} onClick={create}>New note</Button></Tooltip>
		</>}>
			<ListSplit widthKey="omp-agents.notes-list-width" resizeLabel="Resize the note list" detailLabel="Open note" empty={{ icon: NotebookPen, title: "No note open", hint: "Click a note, or focus one with ↑ or ↓ and press Enter." }} list={
				<ul aria-label="Notes" className="mx-auto w-full max-w-3xl space-y-0.5 px-3 py-2">
					{shown.map(note => <NoteRow key={note.id} note={note} href={hashForNotes(view, note.id)} open={note.id === openId} todoHref={todos && note.todoId ? hashForTodoId(todos, note.todoId) : null} disabled={disabled} onRename={rename} onRemove={remove} />)}
					{shown.length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">{query ? `No note matches “${query}”.` : text.empty}</li>}
				</ul>
			} detail={open === null ? null : <section key={open.id} aria-label={open.title || "Untitled"}>
				<DetailBar leading="Notes" previous={{ label: "Previous note", icon: CH_PREVIOUS, shortcut: "notesPrevious", onClick: at > 0 ? () => step(-1) : undefined }} next={{ label: "Next note", icon: CH_NEXT, shortcut: "notesNext", onClick: at >= 0 && at < shown.length - 1 ? () => step(1) : undefined }} close={{ label: "Close the note", icon: CH_CLOSE, shortcut: "notesClose", onClick: () => navigate(null) }}>
					<Tooltip content="Delete note"><Button variant="ghost" size="icon-compact" aria-label="Delete note" disabled={disabled} onClick={() => remove(open)}><Trash2 /></Button></Tooltip>
				</DetailBar>
				<div className="flex flex-col gap-5 px-6 py-5">
					<input ref={titleField} key={open.title} aria-label="Note title" placeholder="Untitled" maxLength={MAX_NOTE_TITLE} defaultValue={open.title} disabled={disabled} onKeyDown={event => {
						if (event.nativeEvent.isComposing) return;
						if (event.key === "Escape") event.currentTarget.value = open.title;
						if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); event.currentTarget.blur(); }
					}} onBlur={event => { setNaming(null); const title = event.currentTarget.value.trim(); if (!disabled && title !== open.title) onChange({ op: "edit-title", id: open.id, title, at: new Date().toISOString() }); }} className="-mx-1 min-w-0 rounded-md bg-transparent px-1 text-xl font-semibold outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring" />
					<NoteTodo note={open} todos={todos} disabled={disabled} onChange={onChange} />
					<NotesEditor key={open.id} value={open.body} label={`Content of ${open.title || "Untitled"}`} readOnly={disabled} onSave={body => onChange({ op: "edit-body", id: open.id, body, at: new Date().toISOString() })} />
					<div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground"><span>Created {dayLabel(open.createdAt)}</span>{open.addedBy && <AddedByChip sessionId={open.addedBy} sessions={{ hosts, past }} />}</div>
				</div>
			</section>} />
		</PageFrame>
	);
}

interface NoteRowProps {
	note: UserNote;
	href: string;
	open: boolean;
	/** Its todo's page, `null` when it belongs to none. */
	todoHref: string | null;
	/** Changes would not reach the server. */
	disabled: boolean;
	onRename: (note: UserNote) => void;
	onRemove: (note: UserNote) => void;
}

/** A note's row: its title, first line, and last change, with **Open**, **Rename**, **Open todo**, and **Delete** on right-click. */
function NoteRow({ note, href, open, todoHref, disabled, onRename, onRemove }: NoteRowProps) {
	return (
		<ContextMenu>
			<ContextMenuTrigger render={<li id={`note-${note.id}`} />}>
				<a href={href} aria-current={open ? "page" : undefined} className={cn("flex flex-col gap-1 rounded-md px-3 py-2 text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring", open && "bg-accent")}>
					<span className="flex min-w-0 items-center gap-1.5"><span className="truncate font-medium">{note.title || "Untitled"}</span>{note.todoId && <PAGE_ICON.todo aria-label="Linked to a todo" className="size-3.5 shrink-0 text-muted-foreground" />}{note.addedBy && <Bot aria-label="Added by an agent" className="size-3.5 shrink-0 text-muted-foreground" />}</span>
					<span className="truncate text-xs text-muted-foreground">{preview(note.body) || "No content"}</span>
					<span className="text-xs text-muted-foreground">Updated {dayLabel(note.updatedAt)}</span>
				</a>
			</ContextMenuTrigger>
			<ContextMenuContent className="min-w-48">
				<MenuLinkItem href={href}>
					<SquareArrowOutUpRight />
					Open
				</MenuLinkItem>
				<MenuItem disabled={disabled} onClick={() => onRename(note)}>
					<Pencil />
					Rename
				</MenuItem>
				{todoHref && (
					<MenuLinkItem href={todoHref}>
						<PAGE_ICON.todo />
						Open todo
					</MenuLinkItem>
				)}
				<MenuSeparator />
				<MenuItem variant="destructive" disabled={disabled} onClick={() => onRemove(note)}>
					<Trash2 />
					Delete
				</MenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

/** The note's first line of text, without the markers that make it a heading, a list item, a check item, or a quote. */
const preview = (body: string): string => body.split("\n").map(line => line.replace(/^\s*(?:#{1,6}\s|>\s?|[-*+]\s(?:\[[ xX]\]\s)?|\d+\.\s)*/, "").trim()).find(Boolean) ?? "";

function NoteTodo({ note, todos, disabled, onChange }: { note: UserNote; todos: UserTodoList | null; disabled: boolean; onChange: (change: UserNoteChange) => void }) {
	const choices = [...(todos?.todos ?? []), ...(todos?.archive ?? [])];
	const todo = choices.find(row => row.id === note.todoId);
	const current = todo?.text ?? (note.todoId ? "Deleted todo" : "No todo");
	const href = todos && note.todoId ? hashForTodoId(todos, note.todoId) : null;
	return <div className="flex min-w-0 flex-wrap items-center gap-2">
		<FieldPicker field="Todo" current={current} trigger={<><PAGE_ICON.todo aria-hidden className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{current}</span></>} choices={[{ value: "", label: "No todo" }, ...choices.map(row => ({ value: row.id, label: row.text }))]} selected={[note.todoId ?? ""]} disabled={disabled || todos === null} onPick={value => { if ((value || null) !== note.todoId) onChange({ op: "set-todo", id: note.id, todoId: value || null }); }} />
		{href && <a href={href} className="text-xs text-muted-foreground underline underline-offset-2">Open todo</a>}
	</div>;
}
