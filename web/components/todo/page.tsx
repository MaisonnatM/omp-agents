import { ListX, Plus, Trash2 } from "lucide-react";
import { Fragment, type ReactNode, useRef, useState } from "react";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import type { UserTodo, UserTodoChange, UserTodoLeaf, UserTodoList } from "../../../src/user-todos-shared";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { DONE_KEPT_HOURS } from "../../../src/user-todos";
import { localDay } from "../../days";
import type { TodoListView } from "../../routing";
import { LIST_KINDS, lastToDo, leftIn, matches, placeIn, type Section, type TodoEntry, titleOf, todosOf } from "../../todo-views";
import { useTodoDrag } from "../../use-todo-drag";
import { useTodoKeys } from "../../use-todo-keys";
import { FoldButton, useFolds } from "../fold";
import { PageFrame } from "../list-page";
import { TodoDetail } from "./detail";
import { useTodoEditing } from "./editing";
import type { KnownSessions } from "./links";
import { ArchivedRow, DraftRow, TodoRow } from "./row";
import { TodoSearch } from "./search";
import { TodoSplit } from "./split";
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

/** Your own todos, each with todos of its own, two deep at most, beside the open one's notes. */
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
	const listRef = useRef<HTMLElement>(null);
	const day = localDay();
	const kind = LIST_KINDS[view.kind];
	const frozen = disabled || kind.readOnly;
	const sessions: KnownSessions = { hosts, past };
	const listed = todosOf(list, view, day, sessions);
	const section: Section = { categoryId: view.kind === "category" ? view.id : null, todos: listed.filter(todo => matches(todo, query)) };
	// Looked up before the search filters the list, so typing a search keeps the open todo on screen.
	const open = openId === null ? null : (placeIn([listed], openId)?.entry ?? null);
	const undo = useUndo(onChange);
	const editing = useTodoEditing({ list, kind, day, frozen, onChange, undo, onRemoved: id => openId === id && setOpenId(null), newSessionCwd });
	const drag = useTodoDrag(kind.canMove && !frozen, onChange);
	const logbook = useFolds(LOGBOOK_KEY, () => true);

	const title = titleOf(list, view);
	const left = leftIn(list, view, day, sessions);
	const toDo = section.todos.filter(todo => todo.doneAt === null);
	const done = section.todos.filter(todo => todo.doneAt !== null);
	const anyDone = done.length > 0 || toDo.some(todo => todo.children.some(child => child.doneAt !== null));
	const empty = section.todos.length === 0 ? (query ? `No todo matches “${query}”.` : kind.empty) : null;
	const foldKey = section.categoryId ?? "";
	// A search shows every match, done ones too.
	const logbookOpen = query !== "" || !logbook.isFolded(foldKey);
	const logbookId = `todo-logbook-${foldKey}`;
	const shown = kind.readOnly ? section.todos : logbookOpen ? [...toDo, ...done] : toDo;
	const order = shown.flatMap(todo => [todo.id, ...(kind.readOnly ? [] : todo.children.map(child => child.id))]);
	const at = open ? order.indexOf(open.todo.id) : -1;
	const openStep = useTodoKeys({
		listRef,
		groups: [section.todos],
		editingId: editing.editingId,
		canMove: kind.canMove,
		disabled: frozen,
		onChange,
		onToggle: todo => onChange({ op: "toggle", id: todo.id, doneAt: todo.doneAt === null ? new Date().toISOString() : null }),
		openId: open && open.todo.id,
		openOrder: order,
		onOpen: setOpenId,
	});

	const draftAt = (parentId: string | null, afterId: string | null): ReactNode => {
		const draft = editing.draftAt(section, parentId, afterId);
		// A new key per place and per added todo, so the input starts with the draft's text wherever it moves.
		return draft && <DraftRow key={`draft:${parentId}:${afterId}:${draft.addedId}`} draft={draft} section={section} editing={editing} />;
	};
	const row = (entry: TodoEntry, siblings: readonly UserTodoLeaf[]) => (
		<TodoRow
			section={section}
			entry={entry}
			siblings={siblings}
			category={entry.parent === null && view.kind !== "category" ? list.categories.find(({ id }) => id === entry.todo.categoryId) : undefined}
			day={day}
			sessions={sessions}
			disabled={disabled}
			open={entry.todo.id === openId}
			drag={drag}
			editing={editing}
			onOpen={setOpenId}
			onChange={onChange}
		/>
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
			<TodoSplit
				list={
					<section ref={listRef} aria-label={title} className="mx-auto w-full max-w-3xl space-y-1 px-3 py-2">
						<ul aria-label={kind.readOnly ? "Archived todos" : `Todos of ${title}`} className="flex flex-col gap-0.5">
							{kind.readOnly ? (
								section.todos.map(todo => <ArchivedRow key={todo.id} todo={todo} disabled={disabled} open={todo.id === openId} onOpen={setOpenId} onChange={onChange} />)
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
									<ul id={logbookId} aria-label={`Done todos of ${title}`} className="flex flex-col gap-0.5">
										{done.map(rowsOf)}
									</ul>
								)}
							</div>
						)}
					</section>
				}
				detail={
					open && (
						<TodoDetail
							key={open.todo.id}
							list={list}
							open={open}
							readOnly={frozen}
							onChange={onChange}
							onClose={() => setOpenId(null)}
							onPrevious={at > 0 ? () => openStep(-1) : undefined}
							onNext={at >= 0 && at < order.length - 1 ? () => openStep(1) : undefined}
							sessions={sessions}
							newSessionCwd={newSessionCwd}
							linearConnected={linearConnected}
						/>
					)
				}
			/>
			{undo.toast}
		</PageFrame>
	);
}
