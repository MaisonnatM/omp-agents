/** The Board's half of the left sidebar, under its Board tab: the Workspaces with each one's Board sessions nested under it, then the Bots under the Bots tab's own groups (Pinned, each section, Other Bots), each a collapsible group like the Sessions workspaces. */
import { IconFolder1, IconFolderOpen, IconPin, IconUserGroup } from "central-icons";
import { useState } from "react";
import { revealDetailsTab } from "../../details-tabs";
import type { Workspace } from "../../../src/shared/workspaces";
import { type BoardState, type BoardTask, statusOf, wakeTarget } from "../../../templates/omp/agent/extensions/board/log";
import { SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { activityControl } from "../../activity";
import { folderName } from "../../labels";
import { type BotGroup, type BotRow, botAsking, botGroupKey, botGroupLabel, botGroupListName, botGroups } from "../../bots-model";
import type { IconComponent } from "@/lib/icon-context";
import { hashForBots, hashForPage } from "../../routing";
import { BotAvatar } from "../bots/bot-avatar";
import { CountPill } from "../count-pill";
import { type KnownSessions, sessionLabel } from "../todo/links";
import type { BoardRoute } from "./module";

/** The Board's Messages address: Workspace `workspace`, Board task `thread`'s thread open, with `search`'s results shown, or its reply `reply` highlighted. */
export const hashForBoard = (workspace: string | null, thread: number | null = null, { search = null, reply = null }: Partial<Pick<BoardRoute, "search" | "reply">> = {}): string =>
	hashForPage({ kind: "board", workspace, view: { tab: "messages", thread }, search, reply, bots: false });

/** The Bots group's page on the Board: every Bot, whatever its Workspace. */
export const hashForBoardBots = (): string => hashForPage({ kind: "board", workspace: null, view: { tab: "messages", thread: null }, search: null, reply: null, bots: true });

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

/** The sessions Board task `task` names: who posted it, replied to it, was started on it, or claimed it. */
function namedIn(task: BoardTask): string[] {
	const ids: string[] = [];
	if (task.by.kind === "session") ids.push(task.by.sessionId);
	for (const entry of task.replies) {
		if ("by" in entry && entry.by.kind === "session") ids.push(entry.by.sessionId);
		if ("note" in entry && "sessionId" in entry.note && entry.note.sessionId) ids.push(entry.note.sessionId);
	}
	return ids;
}

/** The Board thread's open tabs, kept across threads. */
export const THREAD_TABS = "omp-agents.board-thread-tabs";

/** The Board's address for session `sessionId` in Workspace `workspace`: the latest Board thread whose replies wake it, which shows its conversation, else the latest that names it. */
export function hashForBoardSession(state: BoardState, workspace: string, sessionId: string): string {
	const tasks = state.tasks.filter(task => task.workspace === workspace).reverse();
	const task = tasks.find(each => wakeTarget(each, { kind: "user" }) === sessionId) ?? tasks.find(each => namedIn(each).includes(sessionId));
	return hashForBoard(workspace, task?.id ?? null);
}

/** Shows the session's conversation tab in the Board thread the address it goes with opens. */
export const revealSessionTab = () => revealDetailsTab(THREAD_TABS, "session", "thread");
export const revealThreadTab = () => revealDetailsTab(THREAD_TABS, "thread", "thread");
const GROUP_ICONS: Record<BotGroup["kind"], IconComponent> = { pinned: IconPin, section: IconFolder1, rest: IconUserGroup };

const go = (hash: string) => () => {
	location.hash = hash;
};

interface BoardSidebarProps {
	route: BoardRoute;
	state: BoardState | null;
	workspaces: readonly Workspace[];
	picked: string | null;
	sessions: KnownSessions;
	/** `null` until the server sends the Bots. */
	bots: readonly BotRow[] | null;
}

export function BoardSidebar({ route, state, workspaces: sidebar, picked, sessions, bots }: BoardSidebarProps) {
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
	const toggle = (key: string) => setCollapsed(prev => {
		const next = new Set(prev);
		if (!next.delete(key)) next.add(key);
		return next;
	});
	if (state === null) return <p className="px-4 py-2 text-xs text-muted-foreground">Loading the Board…</p>;
	const { workspaces, open } = boardWorkspaces(state, sidebar, picked, route);
	return (
		<SidebarContent>
			<SidebarGroup collapsible open={!collapsed.has("workspaces")} onOpenChange={() => toggle("workspaces")}>
				<SidebarGroupLabel>Workspaces</SidebarGroupLabel>
				<SidebarMenu aria-label="Board workspaces" className="gap-px">
					{workspaces.map(workspace => {
						const inIt = state.tasks.filter(task => task.workspace === workspace.cwd);
						const ready = inIt.filter(task => statusOf(state, task).kind === "ready").length;
						const ids = [...new Set(inIt.flatMap(namedIn))]
							.map(id => ({ id, ...sessionLabel(id, sessions) }))
							.filter(row => row.host);
						const current = !route.bots && workspace.cwd === open?.cwd;
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
										{ids.map(({ id, name }) => (
											<SidebarMenuItem key={id}>
												<SidebarMenuButton
													{...activityControl("board.session.open")}
													size="short"
													dot="filled"
													onClick={() => {
														revealSessionTab();
														location.hash = hashForBoardSession(state, workspace.cwd, id);
													}}
												>
													<span className="min-w-0 flex-1 truncate">{name}</span>
												</SidebarMenuButton>
											</SidebarMenuItem>
										))}
									</SidebarMenu>
								)}
							</SidebarMenuItem>
						);
					})}
				</SidebarMenu>
			</SidebarGroup>
			<SidebarGroup collapsible open={!collapsed.has("bots")} onOpenChange={() => toggle("bots")}>
				<SidebarGroupLabel>Bots</SidebarGroupLabel>
				<div>
			{bots !== null && botGroups(bots).map(group => {
				const key = botGroupKey(group);
				return (
					<SidebarGroup
						key={key}
						className="py-0"
						collapsible
						open={!collapsed.has(key)}
						onOpenChange={() => toggle(key)}
					>
						<SidebarGroupLabel icon={GROUP_ICONS[group.kind]} className="h-7 text-[13px] text-foreground/85 hover:text-foreground">
							{botGroupLabel(group)}
						</SidebarGroupLabel>
						<SidebarMenu aria-label={botGroupListName(group)} className="ml-[15px] w-auto gap-px border-l border-border pl-1">
							{group.rows.map(row => (
								<SidebarMenuItem key={row.bot.id}>
									<SidebarMenuButton size="short" title={row.bot.cwd} onClick={go(hashForBots(row.bot.id))}>
										<BotAvatar look={row.bot} size="inline" working={row.host?.status === "working"} asking={botAsking(row.host) !== null} />
										<span className="min-w-0 flex-1 truncate">{row.bot.name}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</SidebarGroup>
				);
			})}
				</div>
			</SidebarGroup>
		</SidebarContent>
	);
}
