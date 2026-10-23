/** The sidebar's Notes tab: every note, and the ones agents added, with how many each holds. */
import type { UserNoteList } from "../../../src/user-notes-shared";
import { SidebarGroup, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { NOTES_LISTS, notesIn } from "../../notes-views";
import { hashForNotes, type NotesListView } from "../../routing";

interface NotesNavProps {
	/** `null` until the server sends the list. */
	list: UserNoteList | null;
	/** The list the Notes page shows. */
	view: NotesListView;
}

export function NotesNav({ list, view }: NotesNavProps) {
	if (list === null) return <SidebarGroup><p className="px-2 py-1 text-xs text-muted-foreground">Loading your notes…</p></SidebarGroup>;
	return (
		<SidebarGroup>
			<SidebarMenu aria-label="Note lists">
				{NOTES_LISTS.map(({ view: target, name, icon: Icon }) => {
					const count = notesIn(list, target).length;
					const active = view.kind === target.kind;
					return (
						<SidebarMenuItem key={target.kind}>
							<SidebarMenuButton asChild isActive={active}>
								<a href={hashForNotes(target)} aria-current={active ? "page" : undefined} aria-label={`${name}, ${count} ${count === 1 ? "note" : "notes"}`}>
									<Icon className="size-4" />
									<span className="truncate">{name}</span>
								</a>
							</SidebarMenuButton>
							<SidebarMenuBadge aria-hidden>{count}</SidebarMenuBadge>
						</SidebarMenuItem>
					);
				})}
			</SidebarMenu>
		</SidebarGroup>
	);
}
