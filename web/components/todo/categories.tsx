import { Ellipsis, Pencil, Plus, Trash2 } from "lucide-react";
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
import { localDay } from "../../days";
import { hashForTodo, type TodoListView } from "../../routing";
import { categoryColor, leftIn, SIDEBAR_LISTS, sameTodoView } from "../../todo-views";
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

export function TodoCategories({ list, view, disabled, onChange, sessions }: TodoCategoriesProps) {
	const [naming, setNaming] = useState<Naming>({ kind: "none" });
	if (list === null) return <SidebarGroup><p className="px-2 py-1 text-xs text-muted-foreground">Loading your todos…</p></SidebarGroup>;
	const day = localDay();
	const link = (target: TodoListView, name: string, icon: ReactNode) => {
		const count = leftIn(list, target, day, sessions);
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
								{link({ kind: "category", id }, name, <span aria-hidden className="mx-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: badgeColors[categoryColor(id)] }} />)}
								{!disabled && (
									<CategoryMenu
										name={name}
										onRename={() => setNaming({ kind: "rename", id })}
										onDelete={() => {
											onChange({ op: "remove-category", id });
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
