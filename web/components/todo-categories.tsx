import { Ellipsis, Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import type { UserTodoChange, UserTodoList } from "../../src/shared";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, MenuItem } from "@/components/ui/menu";
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
import { hashForTodo } from "../routing";

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
	/** The category the Todo page shows, `null` for every todo. */
	category: string | null;
	/** Changes would not reach the server. */
	disabled: boolean;
	onChange: (change: UserTodoChange) => void;
}

/** The Todo tab of the sidebar: every todo, then each category, with the top-level todos left to do in it. */
export function TodoCategories({ list, category, disabled, onChange }: TodoCategoriesProps) {
	const [naming, setNaming] = useState<Naming>({ kind: "none" });
	if (list === null) return <SidebarGroup><p className="px-2 py-1 text-xs text-muted-foreground">Loading your todos…</p></SidebarGroup>;
	const left = (categoryId: string | null): number => list.todos.filter(todo => !todo.done && (categoryId === null || todo.categoryId === categoryId)).length;
	const link = (id: string | null, name: string) => {
		const count = left(id);
		return (
			<SidebarMenuButton asChild isActive={category === id}>
				<a href={hashForTodo(id)} aria-current={category === id ? "page" : undefined} aria-label={`${name}, ${count} to do`}>
					<span className="truncate">{name}</span>
				</a>
			</SidebarMenuButton>
		);
	};
	return (
		<SidebarGroup>
			<SidebarGroupLabel>Categories</SidebarGroupLabel>
			{!disabled && (
				<SidebarGroupAction title="New category" aria-label="New category" onClick={() => setNaming({ kind: "add" })}>
					<Plus />
				</SidebarGroupAction>
			)}
			<SidebarMenu aria-label="Todo categories">
				<SidebarMenuItem>
					{link(null, "All")}
					<SidebarMenuBadge aria-hidden>{left(null)}</SidebarMenuBadge>
				</SidebarMenuItem>
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
							{link(id, name)}
							<SidebarMenuBadge aria-hidden>{left(id)}</SidebarMenuBadge>
							{!disabled && (
								<DropdownMenu>
									<DropdownMenuTrigger render={<SidebarMenuAction showOnHover aria-label={`More actions for ${name}`} title="More actions" />}>
										<Ellipsis />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<MenuItem onClick={() => setNaming({ kind: "rename", id })}>
											<Pencil />
											Rename
										</MenuItem>
										<MenuItem
											variant="destructive"
											onClick={() => {
												onChange({ op: "remove-category", id });
												if (category === id) location.hash = hashForTodo(null);
											}}
										>
											<Trash2 />
											Delete, keeping its todos
										</MenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
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
								location.hash = hashForTodo(id);
							}}
						/>
					</li>
				)}
			</SidebarMenu>
		</SidebarGroup>
	);
}
