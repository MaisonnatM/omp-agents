import { Archive, CalendarClock, Circle, GripVertical, NotebookText, Plus, RotateCcw, Trash2, X } from "lucide-react";
import type { UserTodo, UserTodoCategory, UserTodoChange, UserTodoLeaf } from "../../../src/user-todos-shared";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DAY_FORMAT } from "../../labels";
import { categoryColor, dueLabel, type Section, type TodoEntry } from "../../todo-views";
import { workStateOf } from "../../todo-work-state";
import type { TodoDrag } from "../../use-todo-drag";
import { TodoCheck } from "./check";
import type { Draft, TodoEditing } from "./editing";
import { TodoInput } from "./input";
import { type KnownSessions, TodoLinkChip, TodoWorkPill } from "./links";

function DueChip({ due, day }: { due: string; day: string }) {
	const { text, overdue } = dueLabel(due, day);
	return (
		<span className={cn("inline-flex shrink-0 items-center gap-1 text-xs [&>svg]:size-3", overdue ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
			<CalendarClock aria-hidden />
			{text}
		</span>
	);
}

interface TodoRowProps {
	section: Section;
	entry: TodoEntry;
	/** The todos beside it: a top-level todo's section, or its parent's todos. */
	siblings: readonly UserTodoLeaf[];
	/** The category a top-level todo shows as a badge, in a list that mixes categories. */
	category?: UserTodoCategory;
	day: string;
	sessions: KnownSessions;
	/** Changes would not reach the server. */
	disabled: boolean;
	open: boolean;
	drag: TodoDrag;
	editing: TodoEditing;
	onOpen: (id: string) => void;
	onChange: (change: UserTodoChange) => void;
}

/** A todo's row: its checkbox, title, what it carries, and the buttons that add under it and delete it. */
export function TodoRow({ section, entry, siblings, category, day, sessions, disabled, open, drag, editing, onOpen, onChange }: TodoRowProps) {
	const { todo } = entry;
	const top = entry.parent === null ? entry.todo : null;
	const children = top?.children ?? [];
	const isEditing = editing.editingId === todo.id;
	const done = todo.doneAt !== null;
	const childrenDone = children.filter(child => child.doneAt !== null).length;
	const over = drag.overOf(todo.id);
	const rowProps = drag.rowProps(entry, siblings);
	return (
		<li
			data-todo-id={todo.id}
			{...rowProps}
			draggable={rowProps.draggable && !isEditing}
			className={cn(
				"group/todo relative flex h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent/50",
				!top && "ml-6",
				open && "bg-accent",
				drag.draggingId === todo.id && "opacity-50",
				over === "before" && "shadow-[0_-2px_0_0_var(--ring)]",
				over === "after" && "shadow-[0_2px_0_0_var(--ring)]",
			)}
		>
			{rowProps.draggable && !isEditing && (
				<GripVertical aria-hidden className="absolute -left-3 top-1.5 size-3.5 cursor-grab text-muted-foreground/50 opacity-0 group-hover/todo:opacity-100" />
			)}
			<TodoCheck
				done={done}
				label={todo.text}
				disabled={disabled}
				onToggle={() => onChange({ op: "toggle", id: todo.id, doneAt: done ? null : new Date().toISOString() })}
			/>
			{isEditing ? (
				<TodoInput
					initial={todo.text}
					label="Todo"
					onKey={(key, text) => editing.editKey(todo, siblings, entry.parent?.id ?? null, section.categoryId, key, text)}
					onLeave={text => editing.leaveEdit(todo, text)}
				/>
			) : (
				<Tooltip content="Open; double-click to rename">
					<button
						type="button"
						data-todo-row
						onClick={() => onOpen(todo.id)}
						onDoubleClick={() => {
							if (!disabled) editing.edit(todo.id);
						}}
						onKeyDown={event => {
							if (event.key === "Escape") event.currentTarget.blur();
						}}
						className={cn("min-w-0 flex-1 truncate rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring", done ? "text-muted-foreground line-through" : "text-foreground")}
					>
						{todo.text}
					</button>
				</Tooltip>
			)}
			{category && (
				<Badge variant="dot" size="compact" color={categoryColor(category.id)} className="max-w-28 shrink-0 [&>span:last-child]:truncate">
					{category.name}
				</Badge>
			)}
			{todo.due && !done && <DueChip due={todo.due} day={day} />}
			{top?.links.filter(link => link.kind !== "session").map(link => <TodoLinkChip key={JSON.stringify(link)} link={link} sessions={sessions} compact />)}
			{top && !done && <TodoWorkPill state={workStateOf(top, sessions)} compact />}
			{todo.body.trim() && (
				<Tooltip content="Has notes">
					<button
						type="button"
						aria-label={`Open the notes of ${todo.text}`}
						onClick={() => onOpen(todo.id)}
						className="shrink-0 text-muted-foreground hover:text-foreground [&>svg]:size-3.5"
					>
						<NotebookText />
					</button>
				</Tooltip>
			)}
			{children.length > 0 && (
				<span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-label={`${childrenDone} of ${children.length} done`}>
					{childrenDone}/{children.length}
				</span>
			)}
			{!disabled && !isEditing && (
				<span className="pointer-events-none absolute inset-y-0 right-1 flex items-center gap-1.5 rounded-md bg-accent pl-2 pr-1 opacity-0 group-hover/todo:pointer-events-auto group-hover/todo:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 [&_svg]:size-3.5">
					{top && (
						<Tooltip content="Add a todo under it">
							<button
								type="button"
								aria-label={`Add a todo under ${todo.text}`}
								onClick={() => editing.startDraft({ parentId: todo.id, afterId: null, categoryId: section.categoryId })}
								className="text-muted-foreground hover:text-foreground"
							>
								<Plus />
							</button>
						</Tooltip>
					)}
					<Tooltip content="Delete">
						<button
							type="button"
							aria-label={`Delete ${todo.text}`}
							onClick={() => editing.remove(todo.id, todo.text)}
							className="text-muted-foreground hover:text-foreground"
						>
							<X />
						</button>
					</Tooltip>
				</span>
			)}
		</li>
	);
}

interface ArchivedRowProps {
	todo: UserTodo;
	/** Changes would not reach the server. */
	disabled: boolean;
	open: boolean;
	onOpen: (id: string) => void;
	onChange: (change: UserTodoChange) => void;
}

/** An archived todo's row: when it was cleared, and the buttons that put it back or delete it for good. */
export function ArchivedRow({ todo, disabled, open, onOpen, onChange }: ArchivedRowProps) {
	return (
		<li data-todo-id={todo.id} className={cn("group/todo flex h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent/50", open && "bg-accent")}>
			<Archive aria-hidden className="size-4 shrink-0 text-muted-foreground" />
			<Tooltip content="Open">
				<button type="button" onClick={() => onOpen(todo.id)} className="min-w-0 flex-1 truncate text-left text-muted-foreground">
					{todo.text}
					{todo.children.length > 0 && <span className="ml-2 text-xs tabular-nums">{todo.children.length} under it</span>}
				</button>
			</Tooltip>
			{todo.doneAt && <span className="shrink-0 text-xs text-muted-foreground">{DAY_FORMAT.format(new Date(todo.doneAt))}</span>}
			{!disabled && (
				<span className="flex shrink-0 gap-1 opacity-0 group-hover/todo:opacity-100 focus-within:opacity-100 [&_svg]:size-3.5">
					<Tooltip content="Put back in the list">
						<button
							type="button"
							aria-label={`Put ${todo.text} back`}
							onClick={() => onChange({ op: "unarchive", id: todo.id })}
							className="text-muted-foreground hover:text-foreground"
						>
							<RotateCcw />
						</button>
					</Tooltip>
					<Tooltip content="Delete for good">
						<button
							type="button"
							aria-label={`Delete ${todo.text} for good`}
							onClick={() => onChange({ op: "remove", id: todo.id })}
							className="text-muted-foreground hover:text-foreground"
						>
							<Trash2 />
						</button>
					</Tooltip>
				</span>
			)}
		</li>
	);
}

interface DraftRowProps {
	draft: Draft;
	section: Section;
	editing: TodoEditing;
}

/** The row of a todo not added yet, which a new input types into. */
export function DraftRow({ draft, section, editing }: DraftRowProps) {
	return (
		<li className={cn("flex items-start gap-2 rounded-md px-2 py-1 text-sm leading-snug", draft.parentId !== null && "ml-6")}>
			<Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
			<TodoInput
				initial={draft.text}
				label={draft.parentId === null ? "New todo" : "New todo under it"}
				onKey={(key, text) => editing.draftKey(draft, section, key, text)}
				onLeave={text => editing.leaveDraft(draft, text)}
			/>
		</li>
	);
}
