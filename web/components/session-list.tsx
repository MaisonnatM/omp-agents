import { ListRestart, Loader, Plus, Search } from "lucide-react";
import { useState } from "react";
import type { View } from "../../src/shared/sessions";
import { SidebarContent, SidebarGroup, SidebarGroupAction, SidebarGroupActions, SidebarGroupLabel, SidebarInput, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { hashForProjects, sameView } from "../routing";
import { projectHosts, type SidebarSessions } from "../sessions";
import { shortcutLabels } from "../shortcuts";
import { useStoredKeys } from "../stored-state";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { ProjectSessions } from "./project-group";
import { HostRow, PastRow } from "./session-row";

const COLLAPSED_GROUPS_KEY = "omp-agents.sidebar-collapsed-groups";
/** Past sessions the list shows at first, and how many more each "Show more" adds; the rest stay out of the page until asked for. */
const PAST_PAGE = 100;

interface SessionListProps {
	/** The sessions tab's lists, under the selected workspace and matching `query`. */
	lists: SidebarSessions;
	/** What the search field holds; it narrows `lists`. */
	query: string;
	onQuery: (query: string) => void;
	/** Pin session `sessionId`, or unpin it when it is pinned; the same function on every render. */
	onTogglePin: (sessionId: string) => void;
	/** Views on screen, highlighted in the list. */
	open: View[];
	/** All workspaces are listed, so a titled row names its workspace. */
	showWorkspace: boolean;
	/** The new-session draft is open. */
	newSessionOpen: boolean;
	/** The New session button's label, naming the selected workspace. */
	newSessionLabel: string;
}

/** The Sessions tab: New session, the search field, then the projects, and the pinned, idle, running, interrupted, and past groups. */
export function SessionList({ lists, query, onQuery, onTogglePin, open, showWorkspace, newSessionOpen, newSessionLabel }: SessionListProps) {
	const { start, dismissStart, openNewSession } = useDashboardActions();
	const { connected, starts: { resumeAll } } = useDashboardStatus();
	const [collapsed, toggleGroup] = useStoredKeys(COLLAPSED_GROUPS_KEY);
	const [pastShown, setPastShown] = useState(PAST_PAGE);
	const { projects, pinned, running, idle, interrupted, ended } = lists;
	const resumingAll = resumeAll?.phase === "starting";
	const isOpen = (view: View): boolean => open.some(pane => sameView(pane, view));
	/** The search field narrows the lists, so a group left empty hides rather than saying it has no sessions. */
	const filtering = query.trim() !== "";
	const rowProps = { showWorkspace, onTogglePin };
	const hostRows = (hosts: SidebarSessions["running"], isPinned: boolean) =>
		hosts.map(host => (
			<HostRow key={host.instanceId} session={host} pinned={isPinned} open={isOpen({ kind: "live", instanceId: host.instanceId, agentId: null })} {...rowProps} />
		));
	const pastRows = (past: SidebarSessions["ended"], isPinned: boolean) =>
		past.map(session => <PastRow key={session.sessionId} session={session} pinned={isPinned} open={isOpen({ kind: "past", sessionId: session.sessionId })} {...rowProps} />);
	const hidden = ended.length - pastShown;
	return (
		<>
			<SidebarGroup className="gap-1">
				<SidebarMenu aria-label="Start a session">
					<SidebarMenuItem>
						<Tooltip content={newSessionLabel} shortcut={shortcutLabels("newSession")} side="right">
							<SidebarMenuButton icon={Plus} isActive={newSessionOpen} aria-current={newSessionOpen ? "page" : undefined} onClick={openNewSession}>
								<span className="truncate">{newSessionLabel}</span>
							</SidebarMenuButton>
						</Tooltip>
					</SidebarMenuItem>
				</SidebarMenu>
				<label className="relative block">
					<Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<SidebarInput
						type="search"
						aria-label="Filter the sidebar's sessions"
						placeholder="Search sessions"
						value={query}
						onChange={event => onQuery(event.target.value)}
						onKeyDown={event => {
							if (event.key !== "Escape") return;
							onQuery("");
							event.currentTarget.blur();
						}}
						className="pl-8"
					/>
				</label>
			</SidebarGroup>
			<SidebarContent>
				{filtering && projects.length + pinned.hosts.length + pinned.past.length + idle.length + running.length + interrupted.length + ended.length === 0 && (
					<p className="px-4 py-2 text-xs text-muted-foreground">{`No sessions match “${query.trim()}”`}</p>
				)}
				{(!filtering || projects.length > 0) && (
					<SidebarGroup
						collapsible
						open={!collapsed.has("projects")}
						onOpenChange={() => toggleGroup("projects")}
						headerActions={
							<SidebarGroupActions>
								<Tooltip content="New project">
									<SidebarGroupAction asChild>
										<a href={hashForProjects({ kind: "new" })} aria-label="New project">
											<Plus />
										</a>
									</SidebarGroupAction>
								</Tooltip>
							</SidebarGroupActions>
						}
					>
						<SidebarGroupLabel>{projects.length === 0 ? "No projects" : projects.length === 1 ? "1 project" : `${projects.length} projects`}</SidebarGroupLabel>
						{projects.map(group => (
							<ProjectSessions
								key={group.project.id}
								group={group}
								open={!collapsed.has(`project:${group.project.id}`)}
								onOpenChange={() => toggleGroup(`project:${group.project.id}`)}
								isOpen={isOpen}
								{...rowProps}
							/>
						))}
					</SidebarGroup>
				)}
				{pinned.hosts.length + pinned.past.length > 0 && (
					<SidebarGroup collapsible open={!collapsed.has("pinned")} onOpenChange={() => toggleGroup("pinned")}>
						<SidebarGroupLabel>{`${pinned.hosts.length + pinned.past.length} pinned`}</SidebarGroupLabel>
						<SidebarMenu aria-label="Pinned omp sessions">
							{hostRows(pinned.hosts, true)}
							{pastRows(pinned.past, true)}
						</SidebarMenu>
					</SidebarGroup>
				)}
				{idle.length > 0 && (
					<SidebarGroup collapsible open={!collapsed.has("idle")} onOpenChange={() => toggleGroup("idle")}>
						<SidebarGroupLabel>{`${idle.length} idle`}</SidebarGroupLabel>
						<SidebarMenu aria-label="Idle omp sessions">{hostRows(idle, false)}</SidebarMenu>
					</SidebarGroup>
				)}
				{(!filtering || running.length > 0) && (
					<SidebarGroup collapsible open={!collapsed.has("running")} onOpenChange={() => toggleGroup("running")}>
						<SidebarGroupLabel>
							{running.length > 0 ? `${running.length} running` : pinned.hosts.length + idle.length + projectHosts(projects).length > 0 ? "No other sessions running" : "No sessions"}
						</SidebarGroupLabel>
						<SidebarMenu aria-label="Running omp sessions">{hostRows(running, false)}</SidebarMenu>
					</SidebarGroup>
				)}
				{interrupted.length > 0 && (
					<SidebarGroup
						collapsible
						open={!collapsed.has("interrupted")}
						onOpenChange={() => toggleGroup("interrupted")}
						headerActions={
							<SidebarGroupActions>
								<Tooltip content={resumingAll ? "Resuming…" : "Resume all"} disabled={resumingAll || !connected}>
									<SidebarGroupAction asChild className="disabled:pointer-events-none disabled:opacity-50">
										<button
											type="button"
											aria-label={resumingAll ? "Resuming interrupted sessions" : "Resume all interrupted sessions"}
											disabled={resumingAll || !connected}
											onClick={() => start({ kind: "resume-all", sessionIds: interrupted.map(session => session.sessionId) })}
										>
											{resumingAll ? <Loader className="animate-spin" /> : <ListRestart />}
										</button>
									</SidebarGroupAction>
								</Tooltip>
							</SidebarGroupActions>
						}
					>
						<SidebarGroupLabel>{`${interrupted.length} interrupted`}</SidebarGroupLabel>
						{resumeAll?.phase === "failed" && (
							<p role="alert" className="mx-2 mb-1 flex items-start gap-2 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-600 dark:text-red-400">
								<span className="min-w-0 flex-1">{resumeAll.error}</span>
								<button type="button" className="shrink-0 underline-offset-2 hover:underline" onClick={() => dismissStart("resume-all")}>
									Dismiss
								</button>
							</p>
						)}
						<SidebarMenu aria-label="Interrupted omp sessions">{pastRows(interrupted, false)}</SidebarMenu>
					</SidebarGroup>
				)}
				{(!filtering || ended.length > 0) && (
					<SidebarGroup collapsible open={!collapsed.has("past")} onOpenChange={() => toggleGroup("past")}>
						<SidebarGroupLabel>{ended.length === 0 ? "No past sessions" : `${ended.length} past`}</SidebarGroupLabel>
						<SidebarMenu aria-label="Past omp sessions">
							{pastRows(ended.slice(0, pastShown), false)}
							{hidden > 0 && (
								<SidebarMenuItem>
									<SidebarMenuButton className="text-muted-foreground" onClick={() => setPastShown(shown => shown + PAST_PAGE)}>
										{`Show ${Math.min(hidden, PAST_PAGE)} more`}
									</SidebarMenuButton>
								</SidebarMenuItem>
							)}
						</SidebarMenu>
					</SidebarGroup>
				)}
			</SidebarContent>
		</>
	);
}
