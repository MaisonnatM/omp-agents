import { Circle, CircleCheck, ListX, NotebookText, Plus, X } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import type { UserTodo, UserTodoChange, UserTodoLeaf, UserTodoList } from "../../src/shared";
import { applyUserTodo } from "../../src/user-todos";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { hashForTodo } from "../routing";
import { PageFrame } from "./list-sheet-page";
import { MarkdownEditor } from "./markdown-editor";

/** What the Todo page types into: a todo's title, or a todo not added yet, at its place in the list, with what it holds so far. */
type Editing =
	| { kind: "none" }
	| { kind: "edit"; id: string }
	| { kind: "draft"; parentId: string | null; afterId: string | null; categoryId: string | null; text: string };

type Draft = Extract<Editing, { kind: "draft" }>;

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

/** The todos the page lists under one heading: those of one category, or of none. */
interface Section {
	categoryId: string | null;
	/** `null` for the only section, which the page's title already names. */
	title: string | null;
	todos: UserTodo[];
}

/** One category's section, or, for every todo, the todos of no category first, then each category with todos in its order. */
function sectionsOf({ categories, todos }: UserTodoList, category: string | null): Section[] {
	const inCategory = (categoryId: string | null) => todos.filter(todo => todo.categoryId === categoryId);
	if (category !== null) return [{ categoryId: category, title: null, todos: inCategory(category) }];
	const named = categories.map(({ id, name }) => ({ categoryId: id, title: name, todos: inCategory(id) })).filter(section => section.todos.length > 0);
	return [{ categoryId: null, title: named.length > 0 ? "No category" : null, todos: inCategory(null) }, ...named];
}

/** The todo whose notes show beside the list, and the top-level todo it is under, `null` when it is one. */
type Open = { todo: UserTodo; parent: null } | { todo: UserTodoLeaf; parent: UserTodo };

function openIn(todos: UserTodo[], id: string | null): Open | null {
	for (const todo of todos) {
		if (todo.id === id) return { todo, parent: null };
		const child = todo.children.find(leaf => leaf.id === id);
		if (child) return { todo: child, parent: todo };
	}
	return null;
}

interface TodoDetailProps {
	list: UserTodoList;
	open: Open;
	disabled: boolean;
	onChange: (change: UserTodoChange) => void;
	onClose: () => void;
}

/** The open todo: its title, its category, and its markdown. */
function TodoDetail({ list, open, disabled, onChange, onClose }: TodoDetailProps) {
	const { todo } = open;
	return (
		<section aria-label={todo.text} className="flex min-w-0 flex-col gap-3 self-start md:sticky md:top-6">
			<div className="flex items-start gap-2">
				<button
					type="button"
					role="checkbox"
					aria-checked={todo.done}
					aria-label={todo.text}
					disabled={disabled}
					onClick={() => onChange({ op: "toggle", id: todo.id, done: !todo.done })}
					className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground disabled:pointer-events-none [&>svg]:size-4"
				>
					{todo.done ? <CircleCheck /> : <Circle />}
				</button>
				<h3 className={cn("min-w-0 flex-1 break-words text-base font-semibold leading-snug", todo.done && "text-muted-foreground line-through")}>{todo.text}</h3>
				<Button variant="ghost" size="icon-compact" aria-label="Close the todo" title="Close" onClick={onClose}>
					<X />
				</Button>
			</div>
			{open.parent ? (
				<p className="text-xs text-muted-foreground">Under {open.parent.text}</p>
			) : (
				<label className="flex items-center gap-2 text-xs text-muted-foreground">
					Category
					<select
						value={open.todo.categoryId ?? ""}
						disabled={disabled}
						onChange={event => onChange({ op: "categorize", id: todo.id, categoryId: event.target.value || null })}
						className="h-7 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<option value="">No category</option>
						{list.categories.map(category => (
							<option key={category.id} value={category.id}>
								{category.name}
							</option>
						))}
					</select>
				</label>
			)}
			<MarkdownEditor
				key={todo.id}
				value={todo.body}
				label={`Notes of ${todo.text}`}
				readOnly={disabled}
				onSave={body => onChange({ op: "edit-body", id: todo.id, body })}
			/>
		</section>
	);
}

interface TodoPageProps {
	/** `null` until the server sends the list. */
	list: UserTodoList | null;
	/** The category whose todos the page shows, `null` for every todo. */
	category: string | null;
	/** Changes would not reach the server, so the list is read-only. */
	disabled: boolean;
	onChange: (change: UserTodoChange) => void;
}

/** Your own todos, each with todos of its own, two deep at most, and the open one's notes beside them. */
export function TodoPage({ list, category, disabled, onChange }: TodoPageProps) {
	const [editing, setEditing] = useState<Editing>(NOT_EDITING);
	const [openId, setOpenId] = useState<string | null>(null);
	if (list === null) {
		return (
			<PageFrame title="Todo" meta="Your own todo list">
				<p className="px-6 py-6 text-sm text-muted-foreground">Loading your todos…</p>
			</PageFrame>
		);
	}
	const { todos } = list;
	const shown = category === null ? todos : todos.filter(todo => todo.categoryId === category);
	const title = (category !== null && list.categories.find(({ id }) => id === category)?.name) || "Todo";
	const left = shown.filter(todo => !todo.done).length;
	const anyDone = shown.some(todo => todo.done || todo.children.some(child => child.done));

	/** Saves `text` as todo `todo`'s title; an empty one removes the todo. */
	const commit = (todo: UserTodoLeaf, text: string): void => {
		const trimmed = text.trim();
		if (!trimmed) onChange({ op: "remove", id: todo.id });
		else if (trimmed !== todo.text) onChange({ op: "edit", id: todo.id, text: trimmed });
	};
	const add = ({ parentId, afterId, categoryId }: Draft, text: string): string | null => {
		const trimmed = text.trim();
		if (!trimmed) return null;
		const id = crypto.randomUUID();
		onChange({ op: "add", id, parentId, afterId, categoryId, text: trimmed });
		return id;
	};

	const editKey = (todo: UserTodoLeaf, parentId: string | null, categoryId: string | null, key: TodoKey, text: string): boolean => {
		switch (key) {
			case "enter":
				commit(todo, text);
				setEditing(text.trim() ? { kind: "draft", parentId, afterId: todo.id, categoryId, text: "" } : NOT_EDITING);
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
				if (applyUserTodo(list, move) === list) return false;
				commit(todo, text);
				onChange(move);
				// The todo renders in another list, which mounts a new input for it.
				return true;
			}
		}
	};

	const draftKey = (draft: Draft, section: Section, key: TodoKey, text: string): boolean => {
		switch (key) {
			case "enter": {
				const id = add(draft, text);
				setEditing(id ? { ...draft, afterId: id, text: "" } : NOT_EDITING);
				return true;
			}
			case "escape":
			case "erase":
				setEditing(NOT_EDITING);
				return true;
			case "indent": {
				// Under the top-level todo it follows, or the section's last one when it ends the section.
				const parentId = draft.parentId === null ? (draft.afterId ?? section.todos.at(-1)?.id ?? null) : null;
				if (parentId === null) return false;
				setEditing({ ...draft, parentId, afterId: null, text });
				return true;
			}
			case "outdent":
				if (draft.parentId === null) return false;
				setEditing({ ...draft, parentId: null, afterId: draft.parentId, text });
				return true;
		}
	};

	const draftAt = (section: Section, parentId: string | null, afterId: string | null) => {
		if (disabled || editing.kind !== "draft" || editing.parentId !== parentId || editing.afterId !== afterId || editing.categoryId !== section.categoryId) return null;
		const draft = editing;
		return (
			// A new key per place, so the input starts with the draft's text wherever it moves.
			<li key={`draft:${parentId}:${afterId}`} className={cn("flex items-start gap-2 rounded-md px-2 py-1 text-sm leading-snug", parentId !== null && "ml-6")}>
				<Circle aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
				<TodoInput
					initial={draft.text}
					label={parentId === null ? "New todo" : "New todo under it"}
					onKey={(key, text) => draftKey(draft, section, key, text)}
					onLeave={text => {
						add(draft, text);
						setEditing(NOT_EDITING);
					}}
				/>
			</li>
		);
	};

	/** A todo's row; `parent` is the top-level todo it is under, and `children` its own todos when it is a top-level one. */
	const row = (section: Section, todo: UserTodoLeaf, parent: UserTodo | null, children: UserTodoLeaf[]) => {
		const isEditing = !disabled && editing.kind === "edit" && editing.id === todo.id;
		const childrenDone = children.filter(child => child.done).length;
		return (
			<li
				key={todo.id}
				className={cn(
					"group/todo flex items-start gap-2 rounded-md px-2 py-1 text-sm leading-snug hover:bg-accent/50",
					parent !== null && "ml-6",
					todo.id === openId && "bg-accent",
				)}
			>
				<button
					type="button"
					role="checkbox"
					aria-checked={todo.done}
					aria-label={todo.text}
					disabled={disabled}
					onClick={() => onChange({ op: "toggle", id: todo.id, done: !todo.done })}
					className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground disabled:pointer-events-none [&>svg]:size-4"
				>
					{todo.done ? <CircleCheck /> : <Circle />}
				</button>
				{isEditing ? (
					<TodoInput
						initial={todo.text}
						label="Todo"
						onKey={(key, text) => editKey(todo, parent?.id ?? null, section.categoryId, key, text)}
						onLeave={text => {
							commit(todo, text);
							setEditing(NOT_EDITING);
						}}
					/>
				) : (
					<button
						type="button"
						title="Open and edit"
						onClick={() => {
							setOpenId(todo.id);
							if (!disabled) setEditing({ kind: "edit", id: todo.id });
						}}
						className={cn("min-w-0 flex-1 break-words text-left", todo.done ? "text-muted-foreground line-through" : "text-foreground")}
					>
						{todo.text}
					</button>
				)}
				{todo.body.trim() && (
					<button
						type="button"
						title="Has notes"
						aria-label={`Open the notes of ${todo.text}`}
						onClick={() => setOpenId(todo.id)}
						className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground [&>svg]:size-3.5"
					>
						<NotebookText />
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
								onClick={() => setEditing({ kind: "draft", parentId: todo.id, afterId: null, categoryId: section.categoryId, text: "" })}
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

	const sectionView = (section: Section) => {
		const label = section.title ?? title;
		const sectionLeft = section.todos.filter(todo => !todo.done).length;
		return (
			<section key={section.categoryId ?? ""} aria-label={label} className="space-y-1">
				{section.title !== null && (
					<h3 className="flex items-baseline gap-2 px-2 text-sm font-medium">
						{section.categoryId === null ? (
							section.title
						) : (
							<a href={hashForTodo(section.categoryId)} className="hover:underline">
								{section.title}
							</a>
						)}
						<span className="text-xs tabular-nums text-muted-foreground">{sectionLeft}</span>
					</h3>
				)}
				<ul aria-label={`Todos of ${label}`} className="flex flex-col gap-0.5">
					{section.todos.flatMap(todo => [
						row(section, todo, null, todo.children),
						...todo.children.flatMap(child => [row(section, child, todo, []), draftAt(section, todo.id, child.id)]),
						draftAt(section, todo.id, null),
						draftAt(section, null, todo.id),
					])}
					{draftAt(section, null, null)}
				</ul>
				{!disabled && (
					<button
						type="button"
						onClick={() => setEditing({ kind: "draft", parentId: null, afterId: section.todos.at(-1)?.id ?? null, categoryId: section.categoryId, text: "" })}
						className="flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground [&>svg]:size-4"
					>
						<Plus />
						Add a todo
					</button>
				)}
			</section>
		);
	};

	const open = openIn(shown, openId);
	return (
		<PageFrame
			title={title}
			meta={left === 0 ? "Nothing to do" : `${left} to do`}
			actions={
				anyDone &&
				!disabled && (
					<Button variant="ghost" size="compact" leadingIcon={ListX} onClick={() => onChange({ op: "clear-done", categoryId: category })}>
						Clear done
					</Button>
				)
			}
		>
			<div className={cn("mx-auto grid w-full gap-8 px-6 py-6", open ? "max-w-6xl md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]" : "max-w-3xl")}>
				<div className="space-y-6">{sectionsOf(list, category).map(sectionView)}</div>
				{open && (
					<TodoDetail
						key={open.todo.id}
						list={list}
						open={open}
						disabled={disabled}
						onChange={onChange}
						onClose={() => setOpenId(null)}
					/>
				)}
			</div>
		</PageFrame>
	);
}
