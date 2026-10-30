/** The sidebar's Todo tab: the todo views and categories, with counts left to do (`TodoCategories`). */
import { Check, Ellipsis, Pencil, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import type { UserTodoChange, UserTodoList } from "../../../src/user-todos-shared";
import { badgeColors } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import {
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { localDay } from "../../../src/shared/days";
import { hashForTodo, type TodoListView } from "../../routing";
import { categoryColor, leftIn, SIDEBAR_LISTS, sameTodoView } from "../../todo-views";
import { useHiddenTodoCategories } from "../../use-hidden-todo-categories";
import type { KnownSessions } from "./links";

interface NameInputProps {
	initial: string;
	label: string;
	/** Enter, or focus leaving, with `name` trimmed; an empty name saves nothing. */
	onDone: (name: string) => void;
}

/** A category's name being typed; Esc leaves it as it was. */
function NameInput({ initial, label, onDone }: NameInputProps) {
	const [name, setName] = useState(initial);
	const done = useRef(false);
	const finish = (value: string): void => {
		if (done.current) return;
		done.current = true;
		onDone(value.trim());
	};
	return (
		<input
			autoFocus
			aria-label={label}
			value={name}
			onChange={event => setName(event.target.value)}
			onKeyDown={event => {
				if (event.nativeEvent.isComposing) return;
				if (event.key === "Enter") finish(name);
				else if (event.key === "Escape") finish("");
			}}
			onBlur={() => finish(name)}
			className="mx-2 h-8 w-[calc(100%-1rem)] rounded-md bg-transparent px-2 text-sm outline-none ring-1 ring-ring/40"
		/>
	);
}

/** What the sidebar types into: a category's new name, or the name of one not added yet. */
type Naming = { kind: "none" } | { kind: "rename"; id: string } | { kind: "add" };

interface TodoCategoriesProps {
	/** `null` until the server sends the list. */
	list: UserTodoList | null;
	sessions: KnownSessions;
	/** The list the Todo page shows. */
	view: TodoListView;
	/** The sidebar's Workspace, which narrows every count; `null` for all workspaces. */
	workspace: string | null;
	/** Changes would not reach the server. */
	disabled: boolean;
	onChange: (change: UserTodoChange) => void;
}

/** The Todo tab of the sidebar: every todo, today's, the ones agents added, the archive, then each category, with the top-level todos left to do in each. */
function CategoryMenu({ name, onRename, onDelete }: { name: string; onRename: () => void; onDelete: () => void }) {
	const [open, setOpen] = useState(false);
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<Tooltip content="More actions" forceOpen={open ? false : undefined}>
				<DropdownMenuTrigger render={<SidebarMenuAction showOnHover aria-label={`More actions for ${name}`} />}>
					<Ellipsis />
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end">
				<MenuItem onClick={onRename}>
					<Pencil />
					Rename
				</MenuItem>
				<MenuItem variant="destructive" onClick={onDelete}>
					<Trash2 />
					Delete, keeping its todos
				</MenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Whether a category's todos show in the lists that span categories; it sits over the category's link, in the place the link leaves for it. */
function ShownCheckbox({ id, name, shown, onToggle }: { id: string; name: string; shown: boolean; onToggle: () => void }) {
	const color = badgeColors[categoryColor(id)];
	const lists = "All, Today, Needs you, and From agents";
	return (
		<Tooltip content={shown ? `Hide ${name} from ${lists}` : `Show ${name} in ${lists}`}>
			<button
				type="button"
				role="checkbox"
				aria-checked={shown}
				aria-label={`Show ${name} in ${lists}`}
				onClick={onToggle}
				className="absolute left-[3px] top-1/2 z-20 flex size-6 -translate-y-1/2 items-center justify-center rounded-md outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]"
			>
				<span aria-hidden className="flex size-3.5 items-center justify-center rounded-[3px] border-2" style={{ borderColor: color, backgroundColor: shown ? color : undefined }}>
					{shown && <Check className="size-2.5 text-white" strokeWidth={3.5} />}
				</span>
			</button>
		</Tooltip>
	);
}

export function TodoCategories({ list, view, workspace, disabled, onChange, sessions }: TodoCategoriesProps) {
	const [naming, setNaming] = useState<Naming>({ kind: "none" });
	const [hidden, toggleHidden] = useHiddenTodoCategories();
	if (list === null) return <SidebarGroup><p className="px-2 py-1 text-xs text-muted-foreground">Loading your todos…</p></SidebarGroup>;
	const day = localDay();
	const link = (target: TodoListView, name: string, icon: ReactNode) => {
		const count = leftIn(list, target, day, sessions, hidden, workspace);
		const active = sameTodoView(view, target);
		return (
			<>
				<SidebarMenuButton asChild isActive={active}>
					<a href={hashForTodo(target)} aria-current={active ? "page" : undefined} aria-label={`${name}, ${count} ${target.kind === "archive" ? "archived" : "to do"}`}>
						{icon}
						<span className="truncate">{name}</span>
					</a>
				</SidebarMenuButton>
				{(count > 0 || target.kind === "all" || target.kind === "category") && <SidebarMenuBadge aria-hidden>{count}</SidebarMenuBadge>}
			</>
		);
	};
	return (
		<>
			<SidebarGroup>
				<SidebarMenu aria-label="Todo lists">
					{SIDEBAR_LISTS.map(({ view: target, name, icon: Icon }) => (
						<SidebarMenuItem key={target.kind}>{link(target, name, <Icon className="size-4" />)}</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarGroup>
			<SidebarGroup>
				<SidebarGroupLabel>Categories</SidebarGroupLabel>
				{!disabled && (
					<Tooltip content="New category">
						<SidebarGroupAction aria-label="New category" onClick={() => setNaming({ kind: "add" })}>
							<Plus />
						</SidebarGroupAction>
					</Tooltip>
				)}
				<SidebarMenu aria-label="Todo categories">
					{list.categories.map(({ id, name }) =>
						naming.kind === "rename" && naming.id === id ? (
							<li key={id}>
								<NameInput
									initial={name}
									label={`Rename ${name}`}
									onDone={next => {
										if (next && next !== name) onChange({ op: "rename-category", id, name: next });
										setNaming({ kind: "none" });
									}}
								/>
							</li>
						) : (
							<SidebarMenuItem key={id}>
								<ShownCheckbox id={id} name={name} shown={!hidden.has(id)} onToggle={() => toggleHidden(id)} />
								{link({ kind: "category", id }, name, <span aria-hidden className="size-3.5 shrink-0" />)}
								{!disabled && (
									<CategoryMenu
										name={name}
										onRename={() => setNaming({ kind: "rename", id })}
										onDelete={() => {
											onChange({ op: "remove-category", id });
											if (hidden.has(id)) toggleHidden(id);
											if (view.kind === "category" && view.id === id) location.hash = hashForTodo({ kind: "all" });
										}}
									/>
								)}
							</SidebarMenuItem>
						),
					)}
					{naming.kind === "add" && (
						<li>
							<NameInput
								initial=""
								label="New category"
								onDone={name => {
									setNaming({ kind: "none" });
									if (!name) return;
									const id = crypto.randomUUID();
									onChange({ op: "add-category", id, name });
									location.hash = hashForTodo({ kind: "category", id });
								}}
							/>
						</li>
					)}
				</SidebarMenu>
			</SidebarGroup>
		</>
	);
}
