/** The Board's half of the left sidebar, under its Board tab: the Workspaces with each one's Board sessions nested under it. */
import { IconFolder1, IconFolderOpen } from "central-icons";
import { hashForSession } from "../../../src/shared/sessions";
import type { Workspace } from "../../../src/shared/workspaces";
import { type BoardState, type BoardTask, statusOf } from "../../../templates/omp/agent/extensions/board/log";
import { SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { activityControl } from "../../activity";
import { folderName } from "../../labels";
import { hashForPage } from "../../routing";
import { CountPill } from "../count-pill";
import { type KnownSessions, sessionLabel } from "../todo/links";
import type { BoardRoute } from "./module";

/** The Board's address: Workspace `workspace`, Board task `thread`'s thread open, with `search`'s results shown, or its reply `reply` highlighted. */
export const hashForBoard = (workspace: string | null, thread: number | null = null, { search = null, reply = null }: Partial<Pick<BoardRoute, "search" | "reply">> = {}): string =>
	hashForPage({ kind: "board", workspace, thread, search, reply });

/**
 * The Workspaces the Board lists: the sidebar's, then any a Board task or `route` names, and the one it shows:
 * `route`'s, else the sidebar's picked one, else the latest Board task's, else the first.
 */
export function boardWorkspaces(state: BoardState, sidebar: readonly Workspace[], picked: string | null, route: BoardRoute): { workspaces: Workspace[]; open: Workspace | null } {
	const known = new Map<string, Workspace>(sidebar.map(workspace => [workspace.cwd, workspace]));
	const add = (cwd: string) => {
		if (!known.has(cwd)) known.set(cwd, { cwd, cwdDisplay: cwd });
	};
	for (const task of state.tasks) add(task.workspace);
	if (route.workspace !== null) add(route.workspace);
	const workspaces = [...known.values()];
	const open = route.workspace ?? picked ?? state.tasks.at(-1)?.workspace ?? workspaces[0]?.cwd ?? null;
	return { workspaces, open: open === null ? null : (known.get(open) ?? null) };
}

/** The sessions Board tasks in a Workspace name: who posted, replied, was started on, or claimed them, first seen first. */
function boardSessions(tasks: readonly BoardTask[]): string[] {
	const ids = new Set<string>();
	for (const task of tasks) {
		if (task.by.kind === "session") ids.add(task.by.sessionId);
		for (const entry of task.replies) {
			if ("by" in entry && entry.by.kind === "session") ids.add(entry.by.sessionId);
			if ("note" in entry && "sessionId" in entry.note && entry.note.sessionId) ids.add(entry.note.sessionId);
		}
	}
	return [...ids];
}

const go = (hash: string) => () => {
	location.hash = hash;
};

interface BoardSidebarProps {
	route: BoardRoute;
	state: BoardState | null;
	workspaces: readonly Workspace[];
	picked: string | null;
	sessions: KnownSessions;
}

export function BoardSidebar({ route, state, workspaces: sidebar, picked, sessions }: BoardSidebarProps) {
	if (state === null) return <p className="px-4 py-2 text-xs text-muted-foreground">Loading the Board…</p>;
	const { workspaces, open } = boardWorkspaces(state, sidebar, picked, route);
	return (
		<SidebarContent>
			<SidebarGroup>
				<SidebarGroupLabel>Workspaces</SidebarGroupLabel>
				<SidebarMenu aria-label="Board workspaces" className="gap-px">
					{workspaces.map(workspace => {
						const inIt = state.tasks.filter(task => task.workspace === workspace.cwd);
						const ready = inIt.filter(task => statusOf(state, task).kind === "ready").length;
						const ids = boardSessions(inIt);
						const current = workspace.cwd === open?.cwd;
						return (
							<SidebarMenuItem key={workspace.cwd}>
								<SidebarMenuButton
									{...activityControl("board.workspace")}
									icon={current && ids.length > 0 ? IconFolderOpen : IconFolder1}
									isActive={current}
									aria-current={current ? "page" : undefined}
									title={workspace.cwdDisplay}
									onClick={go(hashForBoard(workspace.cwd))}
								>
									<span className="min-w-0 flex-1 truncate">{folderName(workspace.cwdDisplay) ?? workspace.cwdDisplay}</span>
									{ready > 0 && (
										<>
											<CountPill count={ready} />
											<span className="sr-only">{`, ${ready} ready`}</span>
										</>
									)}
								</SidebarMenuButton>
								{ids.length > 0 && (
									<SidebarMenu aria-label={`Board sessions in ${folderName(workspace.cwdDisplay) ?? workspace.cwdDisplay}`} className="my-1 ml-[15px] w-auto gap-px border-l border-border pl-1">
										{ids.map(id => {
											const { name, host } = sessionLabel(id, sessions);
											return (
												<SidebarMenuItem key={id}>
													<SidebarMenuButton {...activityControl("board.session.open")} size="short" dot={host ? "filled" : "ring"} className={host ? undefined : "text-muted-foreground"} onClick={go(hashForSession(id))}>
														<span className="min-w-0 flex-1 truncate">{name}</span>
														{!host && <span className="text-xs">stopped</span>}
													</SidebarMenuButton>
												</SidebarMenuItem>
											);
										})}
									</SidebarMenu>
								)}
							</SidebarMenuItem>
						);
					})}
				</SidebarMenu>
			</SidebarGroup>
		</SidebarContent>
	);
}
