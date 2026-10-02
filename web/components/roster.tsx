import { AppWindow, Archive, Check, ChevronsUpDown, CircleStop, Columns2, Copy, Ellipsis, Folder, GitPullRequest, Inbox, Keyboard, ListRestart, Loader, MessagesSquare, Play, Plus, Settings, SquareKanban } from "lucide-react";
import { type CSSProperties, type ReactElement, type ReactNode, useState } from "react";
import type { PastSession, PullRequest, RosterHost, View } from "../../src/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuTrigger,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
	MenuItem,
	MenuLinkItem,
	MenuSeparator,
	MenuShortcut,
} from "@/components/ui/menu";
import {
	SidebarContent,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { SizeProvider } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { inboxRepoKey, inboxSection, inboxSections, pullRequestUrl } from "../inbox-model";
import { age, hostLabel, modeOf, pastLabel, projectName, SPLIT_CLICK } from "../labels";
import { hashForInbox, hashForSettings, hashForTickets, type OpenMode, sameView } from "../routing";
import type { SectionTarget } from "../section";
import { workspaces } from "../sessions";
import { shortcutKeys, useShortcuts } from "../shortcuts";
import type { StartOf } from "../starts";
import { ticketGroups, ticketSection } from "../tickets-model";
import type { ResumeAll } from "../use-dashboard";
import { useInbox } from "../use-inbox";
import { useTickets } from "../use-tickets";
import { ShipStep } from "./ship-step";
import { StatusDot, statusLabel } from "./status-dot";

/** The project the sidebar and the inbox are scoped to, by `cwd`; absent for all projects. */
const PROJECT_KEY = "omp-agents.sidebar-project";

/** The project `cwd` the sidebar and the inbox show, `null` for all projects, and its setter, which localStorage keeps. */
export function useProject(projects: { cwd: string }[]): [string | null, (cwd: string | null) => void] {
	const [stored, setStored] = useState(() => localStorage.getItem(PROJECT_KEY));
	const pick = (cwd: string | null): void => {
		setStored(cwd);
		if (cwd === null) localStorage.removeItem(PROJECT_KEY);
		else localStorage.setItem(PROJECT_KEY, cwd);
	};
	// A stored project with no sessions left, or not yet loaded, shows all of them.
	return [projects.some(({ cwd }) => cwd === stored) ? stored : null, pick];
}

const SIDEBAR_TABS = [
	{ value: "inbox", label: "Inbox", icon: Inbox },
	{ value: "tickets", label: "Tickets", icon: SquareKanban },
	{ value: "sessions", label: "Sessions", icon: MessagesSquare },
] as const;

/** The sidebar's tab; the inbox and tickets tabs go with their pages, sessions with the panes. */
export type SidebarTab = (typeof SIDEBAR_TABS)[number]["value"];

/** The project a titled row ran in, before its title, shown only under all projects. An untitled row's label is already the project's name. */
function ProjectBadge({ cwdDisplay }: { cwdDisplay: string }) {
	const name = projectName(cwdDisplay);
	return name ? <Badge size="compact" className="shrink-0 self-center">{name}</Badge> : null;
}

interface RowMenuProps {
	view: View;
	/** The row's name, which the "More actions" button is labelled after. */
	label: string;
	/** `view` is on screen, which leaves out Open in split. */
	isOpen: boolean;
	onOpen: (view: View, mode: OpenMode) => void;
	/** The row's `SidebarMenuButton`. */
	children: ReactElement;
	/** The row's own items, after Open and Open in split. */
	items?: ReactNode;
	style?: CSSProperties;
}

/** A sidebar row whose quick actions open on right-click and from its hover-revealed "More actions" button. */
export function RowMenu({ view, label, isOpen, onOpen, children, items, style }: RowMenuProps) {
	const menuItems = (
		<>
			<MenuItem onClick={() => onOpen(view, "replace")}>
				<AppWindow />
				Open
			</MenuItem>
			{!isOpen && (
				<MenuItem onClick={() => onOpen(view, "split")}>
					<Columns2 />
					Open in split
					<MenuShortcut>{SPLIT_CLICK}</MenuShortcut>
				</MenuItem>
			)}
			{items}
		</>
	);
	return (
		<ContextMenu>
			<ContextMenuTrigger render={<SidebarMenuItem style={style} />}>
				{children}
				<DropdownMenu>
					<DropdownMenuTrigger render={<SidebarMenuAction showOnHover aria-label={`More actions for ${label}`} title="More actions" />}>
						<Ellipsis />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">{menuItems}</DropdownMenuContent>
				</DropdownMenu>
			</ContextMenuTrigger>
			<ContextMenuContent>{menuItems}</ContextMenuContent>
		</ContextMenu>
	);
}

/** Items a running or past session's menu shares: its pull requests, its workspace's settings, and copying its ids. */
function SessionItems({ row }: { row: { cwd: string; sessionId: string; pullRequests: PullRequest[] } }) {
	return (
		<>
			<MenuSeparator />
			{row.pullRequests.map(pr => (
				<MenuLinkItem key={pullRequestUrl(pr)} href={pullRequestUrl(pr)} target="_blank" rel="noreferrer">
					<GitPullRequest />
					Open {pr.repo}#{pr.number}
				</MenuLinkItem>
			))}
			<MenuLinkItem href={hashForSettings(row.cwd)}>
				<Settings />
				Workspace settings
			</MenuLinkItem>
			<MenuSeparator />
			<MenuItem onClick={() => void navigator.clipboard.writeText(row.cwd)}>
				<Folder />
				Copy path
			</MenuItem>
			<MenuItem onClick={() => void navigator.clipboard.writeText(row.sessionId)}>
				<Copy />
				Copy session ID
			</MenuItem>
		</>
	);
}
interface ProjectPickerProps {
	/** Directories sessions ran in, as {@link workspaces} lists them. */
	projects: { cwd: string; cwdDisplay: string }[];
	/** The selected project's `cwd`, or `null` for all projects. */
	current: string | null;
	onPick: (cwd: string | null) => void;
}

/** Scopes the roster to one directory's running and past sessions. */
function ProjectPicker({ projects, current, onPick }: ProjectPickerProps) {
	const [open, setOpen] = useState(false);
	useShortcuts({ project: () => setOpen(shown => !shown) });
	const selected = projects.find(project => project.cwd === current);
	const label = selected ? (projectName(selected.cwdDisplay) ?? selected.cwdDisplay) : "All projects";
	const pick = (cwd: string | null): void => {
		setOpen(false);
		if (cwd !== current) onPick(cwd);
	};
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="compact"
					leadingIcon={Folder}
					trailingIcon={ChevronsUpDown}
					title={selected?.cwdDisplay}
					aria-label={`Show sessions from: ${label}`}
					active={open}
					className="min-w-0 font-semibold"
				>
					<span className="truncate">{label}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-[min(18rem,calc(100vw-2rem))] p-0">
				<Command>
					<CommandInput aria-label="Search projects" placeholder="Search projects…" />
					<CommandList>
						<CommandEmpty>No project matches.</CommandEmpty>
						<CommandGroup>
							<CommandItem value="All projects" onSelect={() => pick(null)}>
								All projects
								<Check className={cn("ml-auto", current === null ? "opacity-100" : "opacity-0")} />
							</CommandItem>
						</CommandGroup>
						<CommandGroup heading="Projects">
							{projects.map(project => (
								<CommandItem key={project.cwd} value={project.cwd} keywords={[project.cwdDisplay]} onSelect={() => pick(project.cwd)}>
									<span className="flex min-w-0 flex-col">
										<span className="truncate">{projectName(project.cwdDisplay) ?? project.cwdDisplay}</span>
										<span className="truncate text-xs text-muted-foreground">{project.cwdDisplay}</span>
									</span>
									<Check className={cn("ml-auto shrink-0", project.cwd === current ? "opacity-100" : "opacity-0")} />
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

interface SectionLinkProps {
	/** The page the section is on. */
	href: string;
	section: SectionTarget;
	/** The section a link last chose. */
	chosen: SectionTarget | null;
	title: string;
	label: string;
	count: number;
	/** Gets a new target each time, so choosing a section again scrolls back to it. */
	onChoose: (target: SectionTarget) => void;
}

/** A link to a section of a page, with its count. A plain click scrolls there; the page listens for `onChoose`. */
function SectionLink({ href, section, chosen, title, label, count, onChoose }: SectionLinkProps) {
	const isChosen = chosen?.id === section.id;
	return (
		<SidebarMenuItem>
			<SidebarMenuButton asChild isActive={isChosen}>
				<a
					href={href}
					aria-controls={section.id}
					aria-current={isChosen ? "location" : undefined}
					aria-label={label}
					onClick={event => {
						// Modified and middle clicks keep the link's own new-tab behavior.
						if (event.button !== 0 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
						event.preventDefault();
						onChoose({ ...section });
					}}
				>
					{title}
				</a>
			</SidebarMenuButton>
			<SidebarMenuBadge aria-hidden>{count}</SidebarMenuBadge>
		</SidebarMenuItem>
	);
}

const navNote = (text: string) => <p className="px-2 py-1 text-xs text-muted-foreground">{text}</p>;

interface InboxNavProps {
	project: string | null;
	target: SectionTarget | null;
	onTarget: (target: SectionTarget) => void;
}

/** The inbox page's sections with their pull request counts, per repository, each a link to its section on the page. */
function InboxNav({ project, target, onTarget }: InboxNavProps) {
	const { read, error } = useInbox(project, false);
	if (!read) return <SidebarGroup>{navNote(error ? `Cannot load the inbox: ${error}` : "Asking GitHub for pull requests…")}</SidebarGroup>;
	const { repos } = read.data;
	if (repos.length === 0) return <SidebarGroup>{navNote("No session ran in a GitHub repository.")}</SidebarGroup>;
	return repos.map(repo => {
		const name = `${repo.owner}/${repo.repo}`;
		const key = inboxRepoKey(repo);
		const sections = "error" in repo ? [] : inboxSections(repo.pullRequests);
		let body: ReactNode;
		if ("error" in repo) body = navNote(`Cannot read ${name} from GitHub.`);
		else if (sections.length === 0) body = navNote("No open pull requests and no reviews waiting.");
		else
			body = (
				<SidebarMenu aria-label={repos.length > 1 ? `Inbox sections of ${name}` : "Inbox sections"}>
					{sections.map(({ title, pullRequests: { length } }) => (
						<SectionLink
							key={title}
							href={hashForInbox(null)}
							section={inboxSection(key, title)}
							chosen={target}
							title={title}
							label={`${title}, ${length} pull request${length === 1 ? "" : "s"}`}
							count={length}
							onChoose={onTarget}
						/>
					))}
				</SidebarMenu>
			);
		return (
			<SidebarGroup key={key}>
				{repos.length > 1 && <SidebarGroupLabel>{name}</SidebarGroupLabel>}
				{body}
			</SidebarGroup>
		);
	});
}

interface TicketsNavProps {
	target: SectionTarget | null;
	onTarget: (target: SectionTarget) => void;
}

/** The tickets page's status groups with their issue counts, each a link to its group on the page. */
function TicketsNav({ target, onTarget }: TicketsNavProps) {
	const { read, error } = useTickets(false);
	if (!read) return <SidebarGroup>{navNote(error ? `Cannot load the tickets: ${error}` : "Asking Linear for your issues…")}</SidebarGroup>;
	const groups = ticketGroups(read.data.tickets);
	if (groups.length === 0) return <SidebarGroup>{navNote("No issues assigned to you.")}</SidebarGroup>;
	return (
		<SidebarGroup>
			<SidebarMenu aria-label="Ticket groups">
				{groups.map(({ status, tickets: { length } }) => (
					<SectionLink
						key={status}
						href={hashForTickets()}
						section={ticketSection(status)}
						chosen={target}
						title={status}
						label={`${status}, ${length} issue${length === 1 ? "" : "s"}`}
						count={length}
						onChoose={onTarget}
					/>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}

interface RosterProps {
	hosts: RosterHost[];
	past: PastSession[];
	/** Views on screen, highlighted in the list. */
	open: View[];
	connected: boolean;
	/** The new-session draft is open. */
	newSessionOpen: boolean;
	/** The settings page, for the open session's workspace. */
	settingsHref: string;
	settingsOpen: boolean;
	/** The sidebar's tab, which follows the page: the inbox, the tickets, or the sessions over the panes. */
	tab: SidebarTab;
	onTab: (tab: SidebarTab) => void;
	/** The inbox or tickets section a sidebar link last chose. */
	sectionTarget: SectionTarget | null;
	onSectionTarget: (target: SectionTarget) => void;
	/** The selected project's `cwd`, or `null` for all projects. */
	project: string | null;
	onPickProject: (cwd: string | null) => void;
	onOpen: (view: View, mode: OpenMode) => void;
	/** Open the new-session draft; no omp starts until its first message. */
	onNewSession: () => void;
	resume: StartOf<"resume"> | null;
	/** Continue past session `sessionId`, in the pane that shows it. */
	onResume: (sessionId: string) => void;
	/** The page's last **Resume all**, while it runs or after it failed. */
	resumeAll: ResumeAll | null;
	/** Resume every interrupted session the sidebar lists. */
	onResumeAll: (sessionIds: string[]) => void;
	onDismissResumeAll: () => void;
	/** Move interrupted session `sessionId` to the past sessions. */
	onDismissInterrupted: (sessionId: string) => void;
	/** End running session `instanceId`, as its pane's End session does. */
	onEnd: (instanceId: string) => void;
	onShowShortcuts: () => void;
	/** The button that hides the sidebar, first in the header. */
	toggle: ReactNode;
}

export function Roster({
	hosts,
	past,
	open,
	connected,
	newSessionOpen,
	settingsHref,
	settingsOpen,
	tab,
	onTab,
	sectionTarget,
	onSectionTarget,
	project,
	onPickProject,
	onOpen,
	onNewSession,
	resume,
	onResume,
	resumeAll,
	onResumeAll,
	onDismissResumeAll,
	onDismissInterrupted,
	onEnd,
	onShowShortcuts,
	toggle,
}: RosterProps) {
	const [runningOpen, setRunningOpen] = useState(true);
	const projects = workspaces(hosts, past);
	const inProject = (row: { cwd: string }): boolean => project === null || row.cwd === project;
	const shownHosts = hosts.filter(inProject);
	const shownPast = past.filter(inProject);
	const shownInterrupted = shownPast.filter(session => session.interrupted);
	const shownEnded = shownPast.filter(session => !session.interrupted);
	const resumingAll = resumeAll?.phase === "starting";
	const isOpen = (view: View): boolean => open.some(pane => sameView(pane, view));
	const selectedProject = projects.find(({ cwd }) => cwd === project);
	const newSessionLabel = selectedProject ? `New session in ${projectName(selectedProject.cwdDisplay) ?? selectedProject.cwdDisplay}` : "New session";
	const pastRow = (session: PastSession, items?: ReactNode) => {
		const pastView: View = { kind: "past", sessionId: session.sessionId };
		return (
			<RowMenu
				key={session.sessionId}
				view={pastView}
				label={pastLabel(session)}
				isOpen={isOpen(pastView)}
				onOpen={onOpen}
				items={
					<>
						{/* One resume runs at a time, as the pane's Resume button allows. */}
						<MenuItem disabled={resume?.phase === "starting"} onClick={() => onResume(session.sessionId)}>
							<Play />
							{resume?.phase === "starting" && resume.op.sessionId === session.sessionId ? "Resuming…" : "Resume"}
						</MenuItem>
						{items}
						<SessionItems row={session} />
					</>
				}
			>
				<SidebarMenuButton
					isActive={isOpen(pastView)}
					onClick={event => onOpen(pastView, modeOf(event))}
					title={`${session.cwd}\nlast active ${new Date(session.modifiedAt).toLocaleString()}`}
				>
					<span className="flex min-w-0 flex-1 items-baseline gap-2">
						{project === null && session.title !== null && <ProjectBadge cwdDisplay={session.cwdDisplay} />}
						<span className="truncate font-medium text-foreground">{pastLabel(session)}</span>
						<ShipStep ship={session.ship} />
						{session.pullRequests.length > 0 && (
							<span className="shrink-0 text-xs text-muted-foreground">{session.pullRequests.map(pr => `#${pr.number}`).join(" ")}</span>
						)}
						<span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{age(session.modifiedAt)}</span>
					</span>
				</SidebarMenuButton>
			</RowMenu>
		);
	};
	return (
		<Tabs value={tab} onValueChange={value => onTab(value as SidebarTab)} className="flex min-h-0 flex-1 flex-col">
			<SidebarHeader className="flex-row items-center justify-between gap-2 px-2 pt-4">
				<h1 className="sr-only">omp sessions</h1>
				<ProjectPicker projects={projects} current={project} onPick={onPickProject} />
				<Button
					variant="ghost"
					size="icon-compact"
					className="ml-auto shrink-0 text-muted-foreground"
					title={`Keyboard shortcuts (${shortcutKeys("help")})`}
					aria-label="Keyboard shortcuts"
					onClick={onShowShortcuts}
				>
					<Keyboard />
				</Button>

				<Button asChild variant="ghost" size="icon-compact" active={settingsOpen} className="shrink-0 text-muted-foreground">
					<a href={settingsHref} title={`Settings (${shortcutKeys("settings")})`} aria-label="Settings" aria-current={settingsOpen ? "page" : undefined}>
						<Settings />
					</a>
				</Button>
				{toggle}
			</SidebarHeader>
			<SizeProvider size="compact">
				<TabsList aria-label="Sidebar" className="mx-2 self-start">
					{SIDEBAR_TABS.map(({ value, label, icon }) => (
						<TabItem key={value} value={value} label={label} icon={icon} />
					))}
				</TabsList>
			</SizeProvider>
			{!connected && (
				<p className="mx-3 mt-2 rounded-md bg-red-500/10 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">
					Lost the dashboard server. Retrying…
				</p>
			)}
			{/* SidebarContent puts `hidden` on its inner element, so the class hides its scroll frame too. */}
			<TabPanel value="sessions" forceMount asChild className={tab === "sessions" ? undefined : "hidden"}>
				<SidebarContent>
					<SidebarGroup collapsible open={runningOpen} onOpenChange={setRunningOpen}>
						<SidebarGroupLabel>
							{shownHosts.length === 0 ? "No sessions" : `${shownHosts.length} running`}
						</SidebarGroupLabel>
						<SidebarGroupAction
							title={`${newSessionLabel} (${shortcutKeys("newSession")})`}
							aria-label={newSessionLabel}
							aria-current={newSessionOpen ? "page" : undefined}
							onClick={onNewSession}
						>
							<Plus />
						</SidebarGroupAction>
						<SidebarMenu aria-label="Running omp sessions">
							{shownHosts.map(host => {
								const hostView: View = { kind: "live", instanceId: host.instanceId, agentId: null };
								return (
									<RowMenu
										key={host.instanceId}
										view={hostView}
										label={hostLabel(host)}
										isOpen={isOpen(hostView)}
										onOpen={onOpen}
										items={
											<>
												<SessionItems row={host} />
												{/* The server ends only what it controls: a dashboard session, or a terminal room shared writable. */}
												{host.control.phase === "live" && !host.control.readOnly && (
													<>
														<MenuSeparator />
														<MenuItem variant="destructive" onClick={() => onEnd(host.instanceId)}>
															<CircleStop />
															End session
														</MenuItem>
													</>
												)}
											</>
										}
									>
										<SidebarMenuButton
											isActive={isOpen(hostView)}
											onClick={event => onOpen(hostView, modeOf(event))}
											title={`${statusLabel(host.status)}\n${host.cwd}\npid ${host.pid} · ${host.source === "terminal" ? `${host.participants} participants${host.relayConnected ? "" : " · relay offline"}` : "started here"}`}
										>
											<StatusDot status={host.status} />
											<span className="flex min-w-0 flex-1 items-baseline gap-2">
												{project === null && host.sessionName !== null && <ProjectBadge cwdDisplay={host.cwdDisplay} />}
												<span className="truncate font-medium text-foreground">{hostLabel(host)}</span>
												<ShipStep ship={host.ship} />
												{(host.pullRequests.length > 0 || (host.source === "terminal" && !host.relayConnected)) && (
													<span className="shrink-0 text-xs text-muted-foreground">
														{[
															host.source === "terminal" && !host.relayConnected && "relay offline",
															host.pullRequests.map(pr => `#${pr.number}`).join(" "),
														]
															.filter(Boolean)
															.join(" · ")}
													</span>
												)}
												<span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{age(host.startedAt)}</span>
											</span>
										</SidebarMenuButton>
									</RowMenu>
								);
							})}
						</SidebarMenu>
					</SidebarGroup>
					{shownInterrupted.length > 0 && (
						<SidebarGroup collapsible>
							<SidebarGroupLabel>{`${shownInterrupted.length} interrupted`}</SidebarGroupLabel>
							{/* The group action's props carry no `disabled`, so it styles a native button that does. */}
							<SidebarGroupAction asChild className="disabled:pointer-events-none disabled:opacity-50">
								<button
									type="button"
									title={resumingAll ? "Resuming…" : "Resume all"}
									aria-label={resumingAll ? "Resuming interrupted sessions" : "Resume all interrupted sessions"}
									disabled={resumingAll || !connected}
									onClick={() => onResumeAll(shownInterrupted.map(session => session.sessionId))}
								>
									{resumingAll ? <Loader className="animate-spin" /> : <ListRestart />}
								</button>
							</SidebarGroupAction>
							{resumeAll?.phase === "failed" && (
								<p role="alert" className="mx-2 mb-1 flex items-start gap-2 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-600 dark:text-red-400">
									<span className="min-w-0 flex-1">{resumeAll.error}</span>
									<button type="button" className="shrink-0 underline-offset-2 hover:underline" onClick={onDismissResumeAll}>
										Dismiss
									</button>
								</p>
							)}
							<SidebarMenu aria-label="Interrupted omp sessions">
								{shownInterrupted.map(session =>
									pastRow(
										session,
										<MenuItem onClick={() => onDismissInterrupted(session.sessionId)}>
											<Archive />
											Move to past
										</MenuItem>,
									),
								)}
							</SidebarMenu>
						</SidebarGroup>
					)}
					<SidebarGroup collapsible>
						<SidebarGroupLabel>{shownEnded.length === 0 ? "No past sessions" : `${shownEnded.length} past`}</SidebarGroupLabel>
						<SidebarMenu aria-label="Past omp sessions">{shownEnded.map(session => pastRow(session))}</SidebarMenu>
					</SidebarGroup>
				</SidebarContent>
			</TabPanel>
			<TabPanel value="inbox" asChild>
				<SidebarContent>
					<InboxNav project={project} target={sectionTarget} onTarget={onSectionTarget} />
				</SidebarContent>
			</TabPanel>
			<TabPanel value="tickets" asChild>
				<SidebarContent>
					<TicketsNav target={sectionTarget} onTarget={onSectionTarget} />
				</SidebarContent>
			</TabPanel>
		</Tabs>
	);
}
