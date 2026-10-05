import { Circle, CircleCheck, ListX, Plus, X } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import type { UserTodo, UserTodoChange, UserTodoLeaf } from "../../src/shared";
import { applyUserTodo } from "../../src/user-todos";
import { SidebarGroup, SidebarGroupAction, SidebarGroupLabel } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/** What the Todo tab types into: a todo's text, or a todo not added yet, at its place in the list, with what it holds so far. */
type Editing =
	| { kind: "none" }
	| { kind: "edit"; id: string }
	| { kind: "draft"; parentId: string | null; afterId: string | null; text: string };

const NOT_EDITING: Editing = { kind: "none" };

/** The keys a todo's input acts on, beyond typing. */
type TodoKey = "enter" | "escape" | "indent" | "outdent" | "erase";

function todoKey(event: KeyboardEvent<HTMLInputElement>): TodoKey | null {
	if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return null;
	switch (event.key) {
		case "Enter":
			return "enter";
		case "Escape":
			return "escape";
		case "Tab":
			return event.shiftKey ? "outdent" : "indent";
		case "Backspace":
			return event.currentTarget.value === "" ? "erase" : null;
		default:
			return null;
	}
}

interface TodoInputProps {
	initial: string;
	label: string;
	/** Acts on `key`; whether the input goes away, so its blur must not save again. */
	onKey: (key: TodoKey, text: string) => boolean;
	/** Focus left the input with `text` in it. */
	onLeave: (text: string) => void;
}

function TodoInput({ initial, label, onKey, onLeave }: TodoInputProps) {
	const [text, setText] = useState(initial);
	const settled = useRef(false);
	return (
		<input
			autoFocus
			aria-label={label}
			value={text}
			onChange={event => setText(event.target.value)}
			onKeyDown={event => {
				const key = todoKey(event);
				if (!key) return;
				event.preventDefault();
				settled.current = onKey(key, text);
			}}
			onBlur={() => {
				if (!settled.current) onLeave(text);
			}}
			className="-mx-1 min-w-0 flex-1 rounded-sm bg-transparent px-1 outline-none ring-1 ring-ring/40"
		/>
	);
}

interface TodoPanelProps {
	/** `null` until the server sends the list. */
	todos: UserTodo[] | null;
	/** Changes would not reach the server, so the list is read-only. */
	disabled: boolean;
	onChange: (change: UserTodoChange) => void;
}

/** The sidebar's Todo tab: your own todos, each with todos of its own, two deep at most. */
export function TodoPanel({ todos, disabled, onChange }: TodoPanelProps) {
	const [editing, setEditing] = useState<Editing>(NOT_EDITING);
	if (todos === null) return <p className="px-4 py-1 text-xs text-muted-foreground">Loading your todos…</p>;
	/** Saves `text` as todo `todo`'s; an empty one removes the todo. */
	const commit = (todo: UserTodoLeaf, text: string): void => {
		const trimmed = text.trim();
		if (!trimmed) onChange({ op: "remove", id: todo.id });
		else if (trimmed !== todo.text) onChange({ op: "edit", id: todo.id, text: trimmed });
	};
	const add = (parentId: string | null, afterId: string | null, text: string): string | null => {
		const trimmed = text.trim();
		if (!trimmed) return null;
		const id = crypto.randomUUID();
		onChange({ op: "add", id, parentId, afterId, text: trimmed });
		return id;
	};

	const editKey = (todo: UserTodoLeaf, parentId: string | null, key: TodoKey, text: string): boolean => {
		switch (key) {
			case "enter":
				commit(todo, text);
				setEditing(text.trim() ? { kind: "draft", parentId, afterId: todo.id, text: "" } : NOT_EDITING);
				return true;
			case "escape":
				setEditing(NOT_EDITING);
				return true;
			case "erase":
				onChange({ op: "remove", id: todo.id });
				setEditing(NOT_EDITING);
				return true;
			case "indent":
			case "outdent": {
				const move: UserTodoChange = { op: key, id: todo.id };
				if (applyUserTodo(todos, move) === todos) return false;
				commit(todo, text);
				onChange(move);
				// The todo renders in another list, which mounts a new input for it.
				return true;
			}
		}
	};

	const draftKey = (draft: Extract<Editing, { kind: "draft" }>, key: TodoKey, text: string): boolean => {
		switch (key) {
			case "enter": {
				const id = add(draft.parentId, draft.afterId, text);
				setEditing(id ? { kind: "draft", parentId: draft.parentId, afterId: id, text: "" } : NOT_EDITING);
				return true;
			}
			case "escape":
				setEditing(NOT_EDITING);
				return true;
			case "erase":
				setEditing(NOT_EDITING);
				return true;
			case "indent": {
				// Under the top-level todo it follows, or the last one when it ends the list.
				const parentId = draft.parentId === null ? (draft.afterId ?? todos.at(-1)?.id ?? null) : null;
				if (parentId === null) return false;
				setEditing({ kind: "draft", parentId, afterId: null, text });
				return true;
			}
			case "outdent":
				if (draft.parentId === null) return false;
				setEditing({ kind: "draft", parentId: null, afterId: draft.parentId, text });
				return true;
		}
	};

	const draftAt = (parentId: string | null, afterId: string | null) => {
		if (disabled || editing.kind !== "draft" || editing.parentId !== parentId || editing.afterId !== afterId) return null;
		const draft = editing;
		return (
			// A new key per place, so the input starts with the draft's text wherever it moves.
			<li key={`draft:${parentId}:${afterId}`} className={cn("flex items-start gap-2 rounded-md px-2 py-1 text-sm leading-snug", parentId !== null && "ml-5")}>
				<Circle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" />
				<TodoInput
					initial={draft.text}
					label={parentId === null ? "New todo" : "New todo under it"}
					onKey={(key, text) => draftKey(draft, key, text)}
					onLeave={text => {
						add(parentId, afterId, text);
						setEditing(NOT_EDITING);
					}}
				/>
			</li>
		);
	};

	/** A todo's row; `parent` is the top-level todo it is under, and `children` its own todos when it is a top-level one. */
	const row = (todo: UserTodoLeaf, parent: UserTodo | null, children: UserTodoLeaf[]) => {
		const isEditing = !disabled && editing.kind === "edit" && editing.id === todo.id;
		const childrenDone = children.filter(child => child.done).length;
		return (
			<li
				key={todo.id}
				className={cn("group/todo flex items-start gap-2 rounded-md px-2 py-1 text-sm leading-snug hover:bg-accent/50", parent !== null && "ml-5")}
			>
				<button
					type="button"
					role="checkbox"
					aria-checked={todo.done}
					aria-label={todo.text}
					disabled={disabled}
					onClick={() => onChange({ op: "toggle", id: todo.id, done: !todo.done })}
					className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground disabled:pointer-events-none [&>svg]:size-3.5"
				>
					{todo.done ? <CircleCheck /> : <Circle />}
				</button>
				{isEditing ? (
					<TodoInput
						initial={todo.text}
						label="Todo"
						onKey={(key, text) => editKey(todo, parent?.id ?? null, key, text)}
						onLeave={text => {
							commit(todo, text);
							setEditing(NOT_EDITING);
						}}
					/>
				) : (
					<button
						type="button"
						disabled={disabled}
						title="Edit"
						onClick={() => setEditing({ kind: "edit", id: todo.id })}
						className={cn("min-w-0 flex-1 break-words text-left", todo.done ? "text-muted-foreground line-through" : "text-foreground")}
					>
						{todo.text}
					</button>
				)}
				{children.length > 0 && (
					<span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-label={`${childrenDone} of ${children.length} done`}>
						{childrenDone}/{children.length}
					</span>
				)}
				{!disabled && !isEditing && (
					<span className="flex shrink-0 gap-1 opacity-0 group-hover/todo:opacity-100 focus-within:opacity-100 [&_svg]:size-3.5">
						{parent === null && (
							<button
								type="button"
								title="Add a todo under it"
								aria-label={`Add a todo under ${todo.text}`}
								onClick={() => setEditing({ kind: "draft", parentId: todo.id, afterId: null, text: "" })}
								className="text-muted-foreground hover:text-foreground"
							>
								<Plus />
							</button>
						)}
						<button
							type="button"
							title="Delete"
							aria-label={`Delete ${todo.text}`}
							onClick={() => onChange({ op: "remove", id: todo.id })}
							className="text-muted-foreground hover:text-foreground"
						>
							<X />
						</button>
					</span>
				)}
			</li>
		);
	};

	const left = todos.filter(todo => !todo.done).length;
	const anyDone = todos.some(todo => todo.done || todo.children.some(child => child.done));
	return (
		<SidebarGroup>
			<SidebarGroupLabel>{left === 0 ? "Nothing to do" : `${left} to do`}</SidebarGroupLabel>
			{anyDone && !disabled && (
				<SidebarGroupAction title="Clear done" aria-label="Clear done todos" onClick={() => onChange({ op: "clear-done" })}>
					<ListX />
				</SidebarGroupAction>
			)}
			<ul aria-label="Todos" className="flex flex-col gap-0.5 px-2">
				{todos.flatMap(todo => [
					row(todo, null, todo.children),
					...todo.children.flatMap(child => [row(child, todo, []), draftAt(todo.id, child.id)]),
					draftAt(todo.id, null),
					draftAt(null, todo.id),
				])}
				{draftAt(null, null)}
			</ul>
			{!disabled && (
				<button
					type="button"
					onClick={() => setEditing({ kind: "draft", parentId: null, afterId: null, text: "" })}
					className="mx-2 flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground [&>svg]:size-3.5"
				>
					<Plus />
					Add a todo
				</button>
			)}
		</SidebarGroup>
	);
}
