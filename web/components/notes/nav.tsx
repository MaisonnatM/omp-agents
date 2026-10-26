/** The sidebar's Notes tab: every note, the ones agents added, and each project's, with how many each holds. */
import type { LucideIcon } from "lucide-react";
import type { Project } from "../../../src/shared/projects";
import type { UserNoteList } from "../../../src/user-notes-shared";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { NOTES_LISTS, notesIn } from "../../notes-views";
import { PAGE_ICON } from "../../page-icons";
import { hashForNotes, type NotesListView } from "../../routing";

interface NotesNavProps {
	/** `null` until the server sends the list. */
	list: UserNoteList | null;
	/** The list the Notes page shows. */
	view: NotesListView;
	/** Every project; the unarchived ones each list their notes. */
	projects: readonly Project[];
}

interface Row {
	key: string;
	view: NotesListView;
	name: string;
	icon: LucideIcon;
	active: boolean;
}

export function NotesNav({ list, view, projects }: NotesNavProps) {
	if (list === null) return <SidebarGroup><p className="px-2 py-1 text-xs text-muted-foreground">Loading your notes…</p></SidebarGroup>;
	const lists: Row[] = NOTES_LISTS.map(({ view: target, name, icon }) => ({ key: target.kind, view: target, name, icon, active: view.kind === target.kind }));
	const live: Row[] = projects
		.filter(project => !project.archived)
		.map(project => ({ key: project.id, view: { kind: "project", id: project.id }, name: project.name, icon: PAGE_ICON.projects, active: view.kind === "project" && view.id === project.id }));
	const menu = (rows: Row[], label: string) => (
		<SidebarMenu aria-label={label}>
			{rows.map(({ key, view: target, name, icon: Icon, active }) => {
				const count = notesIn(list, target).length;
				return (
					<SidebarMenuItem key={key}>
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
	);
	return (
		<>
			<SidebarGroup>{menu(lists, "Note lists")}</SidebarGroup>
			{live.length > 0 && (
				<SidebarGroup>
					<SidebarGroupLabel>Projects</SidebarGroupLabel>
					{menu(live, "Project notes")}
				</SidebarGroup>
			)}
		</>
	);
}
