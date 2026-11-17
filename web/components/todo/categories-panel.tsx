/** `CategoriesPanel`, the Todo page's categories under **Display**: each with its color, renamed or deleted there, and a new one added. */
import { IconPencil, IconPlusSmall, IconTrashCan } from "central-icons";
import { useRef, useState } from "react";
import type { UserTodoCategory, UserTodoChange } from "../../../src/user-todos-shared";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { activityControl } from "../../activity";
import type { TodoFilter } from "../../todo-filter";
import { type InlineConfirm, useInlineConfirm } from "../../use-inline-confirm";
import { CategoryDot } from "./fields";

/** How typing a name ended: `key` for Enter or Esc, which hand focus back to the button that started it, `blur` for focus leaving. */
type NamedBy = "key" | "blur";

interface NameInputProps {
	initial: string;
	label: string;
	/** Enter, or focus leaving, with `name` trimmed; Esc with `name` empty. An empty name saves nothing. */
	onDone: (name: string, by: NamedBy) => void;
}

/** A category's name being typed; Esc leaves it as it was. */
function NameInput({ initial, label, onDone }: NameInputProps) {
	const [name, setName] = useState(initial);
	const done = useRef(false);
	const finish = (value: string, by: NamedBy): void => {
		if (done.current) return;
		done.current = true;
		onDone(value.trim(), by);
	};
	return (
		<input
			autoFocus
			aria-label={label}
			value={name}
			onChange={event => setName(event.target.value)}
			onKeyDown={event => {
				if (event.nativeEvent.isComposing) return;
				if (event.key === "Enter") {
					event.preventDefault();
					finish(name, "key");
				} else if (event.key === "Escape") finish("", "key");
			}}
			onBlur={() => finish(name, "blur")}
			className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-2 text-sm outline-none ring-1 ring-ring/40"
		/>
	);
}

interface CategoryRowProps {
	category: UserTodoCategory;
	/** Its name is being typed. */
	renaming: boolean;
	onRenaming: (renaming: boolean) => void;
	disabled: boolean;
	confirm: InlineConfirm;
	onChange: (change: UserTodoChange) => void;
}

/** A category's row: its color and name, which **Rename** turns into an input, and **Delete**, which keeps its todos and asks again first. */
function CategoryRow({ category: { id, name }, renaming, onRenaming, disabled, confirm, onChange }: CategoryRowProps) {
	const renameButton = useRef<HTMLButtonElement>(null);
	return (
		<li className="flex h-7 items-center gap-2">
			<CategoryDot categoryId={id} />
			{renaming ? (
				<NameInput
					initial={name}
					label={`Rename ${name}`}
					onDone={(next, by) => {
						if (next && next !== name) onChange({ op: "rename-category", id, name: next });
						if (by === "key") renameButton.current?.focus();
						onRenaming(false);
					}}
				/>
			) : (
				<span title={name} className="min-w-0 flex-1 truncate">
					{name}
				</span>
			)}
			<Tooltip content="Rename">
				<Button {...activityControl("todo.category.rename")} ref={renameButton} variant="ghost" size="icon-compact" aria-label={`Rename ${name}`} disabled={disabled} onClick={() => onRenaming(true)}>
					<IconPencil />
				</Button>
			</Tooltip>
			<Tooltip content={confirm.isArmed(id) ? "Click again to delete" : "Delete, keeping its todos"}>
				<Button
					{...activityControl("todo.category.delete")}
					variant={confirm.isArmed(id) ? "destructive-outline" : "ghost"}
					size="icon-compact"
					aria-label={confirm.isArmed(id) ? `Confirm delete ${name}` : `Delete ${name}, keeping its todos`}
					disabled={disabled}
					{...confirm.props(id, () => onChange({ op: "remove-category", id }))}
				>
					<IconTrashCan />
				</Button>
			</Tooltip>
		</li>
	);
}

/** What the panel types into: a category's new name, or the name of one not added yet. */
type Naming = { kind: "none" } | { kind: "rename"; id: string } | { kind: "add" };

export interface CategoriesPanelProps {
	categories: readonly UserTodoCategory[];
	filter: TodoFilter;
	onFilter: (filter: TodoFilter) => void;
	/** Changes would not reach the server. */
	disabled: boolean;
	onChange: (change: UserTodoChange) => void;
}

/** Each category with its color, which you rename or delete, keeping its todos, and **New category**, which adds one that **Filter** then keeps alone. */
export function CategoriesPanel({ categories, filter, onFilter, disabled, onChange }: CategoriesPanelProps) {
	const [naming, setNaming] = useState<Naming>({ kind: "none" });
	const confirm = useInlineConfirm("todo-category");
	// Set when Enter or Esc ends a new category's name, so **New category** takes focus back as it returns.
	const refocusAdd = useRef(false);
	return (
		<>
			{categories.length > 0 && (
				<ul aria-label="Todo categories" className="space-y-1 text-sm">
					{categories.map(category => (
						<CategoryRow
							key={category.id}
							category={category}
							renaming={naming.kind === "rename" && naming.id === category.id}
							onRenaming={renaming => setNaming(renaming ? { kind: "rename", id: category.id } : { kind: "none" })}
							disabled={disabled}
							confirm={confirm}
							onChange={onChange}
						/>
					))}
				</ul>
			)}
			{naming.kind === "add" ? (
				<div className="flex h-7 items-center">
					<NameInput
						initial=""
						label="New category"
						onDone={(name, by) => {
							refocusAdd.current = by === "key";
							setNaming({ kind: "none" });
							if (!name) return;
							const id = crypto.randomUUID();
							onChange({ op: "add-category", id, name });
							onFilter({ ...filter, categories: new Set([id]) });
						}}
					/>
				</div>
			) : (
				<Button
					{...activityControl("todo.category.add")}
					ref={button => {
						if (!button || !refocusAdd.current) return;
						refocusAdd.current = false;
						button.focus();
					}}
					variant="outline"
					size="compact"
					leadingIcon={IconPlusSmall}
					disabled={disabled}
					onClick={() => setNaming({ kind: "add" })}
				>
					New category
				</Button>
			)}
		</>
	);
}
