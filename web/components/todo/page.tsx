import { ListX, Plus, Trash2 } from "lucide-react";
import { Fragment, type ReactNode, useRef, useState } from "react";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import type { UserTodo, UserTodoChange, UserTodoLeaf, UserTodoList } from "../../../src/user-todos-shared";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DONE_KEPT_HOURS } from "../../../src/user-todos";
import { localDay } from "../../days";
import { hashForTodo, type TodoListView } from "../../routing";
import { LIST_KINDS, lastToDo, leftIn, matches, type Section, sectionsOf, type TodoEntry, titleOf } from "../../todo-views";
import { useTodoDrag } from "../../use-todo-drag";
import { useTodoKeys } from "../../use-todo-keys";
import { FoldButton, useFolds } from "../fold";
import { PageFrame } from "../list-page";
import { TodoDetail } from "./detail";
import { useTodoEditing } from "./editing";
import type { KnownSessions } from "./links";
import { ArchivedRow, DraftRow, TodoRow } from "./row";
import { TodoSearch } from "./search";
import { useUndo } from "./undo";

interface TodoPageProps {
	/** `null` until the server sends the list. */
	list: UserTodoList | null;
	view: TodoListView;
	/** Changes would not reach the server, so the list is read-only. */
	disabled: boolean;
	onChange: (change: UserTodoChange) => void;
	hosts: RosterHost[];
	past: PastSession[];
	/** Where **Start session** opens the new-session draft. */
	newSessionCwd: string;
	linearConnected: boolean;
}

/** Sections whose Logbook you unfolded, by category id, `""` for none; a Logbook starts folded. */
const LOGBOOK_KEY = "omp-agents.todo-logbook-open";

/** Your own todos, each with todos of its own, two deep at most, and the open one's notes under its row. */
export function TodoPage({ list, ...props }: TodoPageProps) {
	if (list === null) {
		return (
			<PageFrame title="Todo" meta="Your own todo list">
				<p className="px-6 py-6 text-sm text-muted-foreground">Loading your todos…</p>
			</PageFrame>
		);
	}
	return <LoadedTodoPage list={list} {...props} />;
}

/** The rows of `todos`, done ones last, with `end`, the draft that ends the ones to do, between the two. */
function rowsAround<T extends UserTodoLeaf>(todos: readonly T[], rowsOf: (todo: T) => ReactNode, end: ReactNode): ReactNode[] {
	const done = todos.findIndex(todo => todo.doneAt !== null);
	const at = done < 0 ? todos.length : done;
	return [...todos.slice(0, at).map(rowsOf), end, ...todos.slice(at).map(rowsOf)];
}

function LoadedTodoPage({ list, view, disabled, onChange, hosts, past, newSessionCwd, linearConnected }: TodoPageProps & { list: UserTodoList }) {
	const [openId, setOpenId] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const listRef = useRef<HTMLDivElement>(null);
	const day = localDay();
	const kind = LIST_KINDS[view.kind];
	const frozen = disabled || kind.readOnly;
	const sessions: KnownSessions = { hosts, past };
	const sections = sectionsOf(list, view, day, sessions).map(section => ({ ...section, todos: section.todos.filter(todo => matches(todo, query)) }));
	const undo = useUndo(onChange);
	const editing = useTodoEditing({ list, kind, day, frozen, onChange, undo, onRemoved: id => openId === id && setOpenId(null), newSessionCwd });
	const drag = useTodoDrag(kind.canMove && !frozen, onChange);
	const logbook = useFolds(LOGBOOK_KEY, () => true);
	useTodoKeys({
		listRef,
		groups: sections.map(section => section.todos),
		editingId: editing.editingId,
		canMove: kind.canMove,
		disabled: frozen,
		onChange,
		onToggle: todo => onChange({ op: "toggle", id: todo.id, doneAt: todo.doneAt === null ? new Date().toISOString() : null }),
	});

	const title = titleOf(list, view);
	const left = leftIn(list, view, day, sessions);
	const anyDone = sections.some(section => section.todos.some(todo => todo.doneAt !== null || todo.children.some(child => child.doneAt !== null)));

	/** The open todo's notes and fields, under its row. */
	const detailRow = (entry: TodoEntry): ReactNode =>
		entry.todo.id === openId && (
			<li className={cn("min-w-0 rounded-lg border border-border bg-background p-4 shadow-sm", entry.parent && "ml-6")}>
				<TodoDetail
					key={entry.todo.id}
					list={list}
					open={entry}
					readOnly={frozen}
					onChange={onChange}
					onClose={() => setOpenId(null)}
					sessions={sessions}
					newSessionCwd={newSessionCwd}
					linearConnected={linearConnected}
				/>
			</li>
		);

	const sectionView = (section: Section) => {
		const label = section.title ?? title;
		const toDo = section.todos.filter(todo => todo.doneAt === null);
		const done = section.todos.filter(todo => todo.doneAt !== null);
		const empty = section.todos.length === 0 ? (query ? `No todo matches “${query}”.` : kind.empty) : null;
		const foldKey = section.categoryId ?? "";
		// A search shows every match, done ones too.
		const logbookOpen = query !== "" || !logbook.isFolded(foldKey);
		const logbookId = `todo-logbook-${foldKey}`;
		const draftAt = (parentId: string | null, afterId: string | null): ReactNode => {
			const draft = editing.draftAt(section, parentId, afterId);
			// A new key per place and per added todo, so the input starts with the draft's text wherever it moves.
			return draft && <DraftRow key={`draft:${parentId}:${afterId}:${draft.addedId}`} draft={draft} section={section} editing={editing} />;
		};
		const row = (entry: TodoEntry, siblings: readonly UserTodoLeaf[]) => (
			<>
				<TodoRow
					section={section}
					entry={entry}
					siblings={siblings}
					day={day}
					sessions={sessions}
					disabled={disabled}
					open={entry.todo.id === openId}
					drag={drag}
					editing={editing}
					onOpen={setOpenId}
					onChange={onChange}
				/>
				{detailRow(entry)}
			</>
		);
		const rowsOf = (todo: UserTodo): ReactNode => (
			<Fragment key={todo.id}>
				{row({ todo, parent: null }, section.todos)}
				{rowsAround(
					todo.children,
					child => (
						<Fragment key={child.id}>
							{row({ todo: child, parent: todo }, todo.children)}
							{draftAt(todo.id, child.id)}
						</Fragment>
					),
					draftAt(todo.id, null),
				)}
				{draftAt(null, todo.id)}
			</Fragment>
		);
		return (
			<section key={section.categoryId ?? ""} aria-label={label} className="space-y-1">
				{section.title !== null && (
					<h3 className="flex items-baseline gap-2 px-2 text-sm font-medium">
						{section.categoryId === null ? (
							section.title
						) : (
							<a href={hashForTodo({ kind: "category", id: section.categoryId })} className="hover:underline">
								{section.title}
							</a>
						)}
						<span className="text-xs tabular-nums text-muted-foreground">{toDo.length}</span>
					</h3>
				)}
				<ul aria-label={kind.readOnly ? "Archived todos" : `Todos of ${label}`} className="flex flex-col gap-0.5">
					{kind.readOnly ? (
						section.todos.map(todo => (
							<Fragment key={todo.id}>
								<ArchivedRow todo={todo} disabled={disabled} open={todo.id === openId} onOpen={setOpenId} onChange={onChange} />
								{detailRow({ todo, parent: null })}
							</Fragment>
						))
					) : (
						<>
							{toDo.map(rowsOf)}
							{draftAt(null, null)}
						</>
					)}
				</ul>
				{empty && <p className="px-2 text-sm text-muted-foreground">{empty}</p>}
				{!disabled && kind.add && (
					<Tooltip content={kind.add.dueToday ? "Add a todo due today" : "Add a todo at the end of this list"}>
						<button
							type="button"
							onClick={() => editing.startDraft({ parentId: null, afterId: lastToDo(section.todos), categoryId: section.categoryId })}
							className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground [&>svg]:size-4"
						>
							<Plus />
							{kind.add.label}
						</button>
					</Tooltip>
				)}
				{!kind.readOnly && done.length > 0 && (
					<div className="space-y-1 pt-2">
						<h4 className="flex items-baseline gap-2 px-2 text-sm text-muted-foreground">
							<FoldButton open={logbookOpen} onToggle={() => logbook.toggle(foldKey)} controls={logbookId}>
								<span className="font-medium text-foreground/80">Logbook</span>
								<span className="text-xs tabular-nums">{done.length} done</span>
							</FoldButton>
							<span className="ml-auto text-xs text-muted-foreground/70">Moves to Done after {DONE_KEPT_HOURS} hours</span>
						</h4>
						{logbookOpen && (
							<ul id={logbookId} aria-label={`Done todos of ${label}`} className="flex flex-col gap-0.5">
								{done.map(rowsOf)}
							</ul>
						)}
					</div>
				)}
			</section>
		);
	};

	return (
		<PageFrame
			title={title}
			meta={kind.readOnly ? `${left} done` : left === 0 ? "Nothing to do" : `${left} to do`}
			actions={
				<>
					<TodoSearch query={query} onQuery={setQuery} />
					{kind.readOnly && list.archive.length > 0 && !disabled && (
						<Tooltip content="Delete every archived todo">
							<Button
								variant="ghost"
								size="compact"
								leadingIcon={Trash2}
								onClick={() => {
									if (window.confirm(`Delete the ${list.archive.length} archived todos for good?`)) onChange({ op: "empty-archive" });
								}}
							>
								Empty
							</Button>
						</Tooltip>
					)}
					{!kind.readOnly && anyDone && !disabled && (
						<Tooltip content="Move checked todos to Done">
							<Button variant="ghost" size="compact" leadingIcon={ListX} onClick={() => onChange({ op: "clear-done", categoryId: view.kind === "category" ? view.id : null })}>
								Clear done
							</Button>
						</Tooltip>
					)}
				</>
			}
		>
			<div ref={listRef} className="mx-auto w-full max-w-3xl space-y-6 px-6 py-6">
				{sections.map(sectionView)}
			</div>
			{undo.toast}
		</PageFrame>
	);
}
