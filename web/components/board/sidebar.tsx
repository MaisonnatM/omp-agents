/** The Board's half of the left sidebar, under its Board tab: the Workspaces, each with a count of what waits on you there. */
import { IconHashtag } from "central-icons";
import { useState } from "react";
import { revealDetailsTab } from "../../details-tabs";
import type { RosterHost } from "../../../src/shared/sessions";
import type { Workspace } from "../../../src/shared/workspaces";
import type { BoardState } from "../../../templates/omp/agent/extensions/board/log";
import { SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { activityControl } from "../../activity";
import { folderName, waitingOnYou } from "../../labels";
import { hashForPage, type PageHash } from "../../routing";
import { CountPill } from "../count-pill";
import { type BoardRoute, pageView } from "./module";
import { useSeen, waitingIn } from "./seen";
import { namedIn, threadSession } from "./work";

/** The Board's Messages address: Workspace `workspace`, Board task `thread`'s thread open, with `search`'s results shown, its reply `reply` highlighted, or session `session`'s tabs in it. */
export const hashForBoard = (workspace: string | null, thread: number | null = null, { search = null, reply = null, session = null }: Partial<Pick<BoardRoute, "search" | "reply" | "session">> = {}): string =>
	hashForPage({ kind: "board", workspace, view: { tab: "messages", thread }, search, reply, session });

/** Links in Workspace `workspace`'s tabs: a project or pull request page opens in the Board tab that shows it, any other page at its own address. */
export const boardPageHash =
	(workspace: string | null): PageHash =>
	page => {
		const view = pageView(page);
		return hashForPage(view ? { kind: "board", workspace, view, search: null, reply: null, session: null } : page);
	};

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

/** The Board thread's open tabs, kept across threads. */
export const THREAD_TABS = "omp-agents.board-thread-tabs";

/** The Board's address for session `sessionId` in Workspace `workspace`: the latest Board thread whose replies wake it, else the latest that names it, showing that session's tabs. */
export function hashForBoardSession(state: BoardState, workspace: string, sessionId: string): string {
	const tasks = state.tasks.filter(task => task.workspace === workspace).reverse();
	const task = tasks.find(each => threadSession(each, null) === sessionId) ?? tasks.find(each => namedIn(each).includes(sessionId));
	return task ? hashForBoard(workspace, task.id, { session: sessionId }) : hashForBoard(workspace);
}

/** Shows the session's conversation tab in the Board thread the address it goes with opens. */
export const revealSessionTab = () => revealDetailsTab(THREAD_TABS, "session", "thread");
export const revealThreadTab = () => revealDetailsTab(THREAD_TABS, "thread", "thread");

const go = (hash: string) => () => {
	location.hash = hash;
};

interface BoardSidebarProps {
	route: BoardRoute;
	state: BoardState | null;
	workspaces: readonly Workspace[];
	picked: string | null;
	/** The live sessions the Sessions tab lists, whose count of those that need you each Workspace's count includes. */
	hosts: readonly RosterHost[];
}

export function BoardSidebar({ route, state, workspaces: sidebar, picked, hosts }: BoardSidebarProps) {
	const [folded, setFolded] = useState(false);
	const seen = useSeen();
	if (state === null) return <p className="px-4 py-2 text-xs text-muted-foreground">Loading the Board…</p>;
	const { workspaces, open } = boardWorkspaces(state, sidebar, picked, route);
	return (
		<SidebarContent>
			<SidebarGroup collapsible open={!folded} onOpenChange={() => setFolded(was => !was)}>
				<SidebarGroupLabel>Workspaces</SidebarGroupLabel>
				<SidebarMenu aria-label="Board workspaces" className="gap-px">
					{workspaces.map(workspace => {
						const waiting = waitingIn(state, seen, hosts, workspace.cwd);
						const current = workspace.cwd === open?.cwd;
						return (
							<SidebarMenuItem key={workspace.cwd}>
								<SidebarMenuButton
									{...activityControl("board.workspace")}
									icon={IconHashtag}
									isActive={current}
									aria-current={current ? "page" : undefined}
									title={workspace.cwdDisplay}
									onClick={go(hashForBoard(workspace.cwd))}
								>
									<span className="min-w-0 flex-1 truncate">{folderName(workspace.cwdDisplay) ?? workspace.cwdDisplay}</span>
									{waiting > 0 && (
										<>
											<CountPill count={waiting} />
											<span className="sr-only">{`, ${waitingOnYou(waiting)}`}</span>
										</>
									)}
								</SidebarMenuButton>
							</SidebarMenuItem>
						);
					})}
				</SidebarMenu>
			</SidebarGroup>
		</SidebarContent>
	);
}
