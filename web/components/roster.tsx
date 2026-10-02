import { Check, ChevronsUpDown, Columns2, Folder, Keyboard, Plus, Settings } from "lucide-react";
import { type MouseEvent, type ReactNode, useState } from "react";
import type { PastSession, RosterHost, View } from "../../src/shared";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	SidebarContent,
	SidebarGroup,
	SidebarGroupAction,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInput,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@/components/ui/sidebar";
import { TabItem, TabPanel, Tabs, TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useShortcuts } from "../shortcuts";
import type { Launch } from "../use-dashboard";
import { useInbox } from "../use-inbox";
import {
	hashForInbox,
	type InboxTarget,
	inboxRepoKey,
	inboxSectionId,
	inboxSections,
	MAX_PANES,
	matchesFilter,
	type OpenMode,
	sameView,
	workspaces,
} from "../view-model";
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

/** Cmd-click on macOS, Ctrl-click elsewhere, opens a row in a new pane. */
export const modeOf = (event: MouseEvent): OpenMode => (event.metaKey || event.ctrlKey ? "split" : "replace");

export function age(startedAt: number): string {
	const minutes = Math.max(0, Math.floor((Date.now() - startedAt) / 60_000));
	if (minutes < 60) return `${minutes}m`;
	if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
	return `${Math.floor(minutes / 1440)}d`;
}

/** The project a directory holds, its last segment: `~/code/webapp` reads `webapp`. */
export const projectName = (cwdDisplay: string): string | undefined => cwdDisplay.split("/").filter(Boolean).pop();

export const hostLabel = (host: RosterHost): string => host.sessionName ?? projectName(host.cwdDisplay) ?? host.cwdDisplay;

export const pastLabel = (session: PastSession): string => session.title ?? projectName(session.cwdDisplay) ?? "Untitled session";

interface NewSessionFormProps {
	launch: Exclude<Launch, { phase: "closed" }>;
	defaultCwd: string;
	connected: boolean;
	onCreate: (cwd: string) => void;
	onCancel: () => void;
}

function NewSessionForm({ launch, defaultCwd, connected, onCreate, onCancel }: NewSessionFormProps) {
	const [cwd, setCwd] = useState(defaultCwd);
	const starting = launch.phase === "starting";
	return (
		<form
			className="mx-2 mb-2 flex flex-col gap-2 rounded-md border border-border p-2"
			aria-label="New session"
			onSubmit={event => {
				event.preventDefault();
				if (cwd.trim()) onCreate(cwd);
			}}
		>
			<label className="flex flex-col gap-1 text-xs text-muted-foreground">
				Working directory
				<SidebarInput
					value={cwd}
					onChange={event => setCwd(event.target.value)}
					disabled={starting}
					autoFocus
					spellCheck={false}
					className="font-mono text-xs"
				/>
			</label>
			{launch.phase === "editing" && launch.error && (
				<p className="text-xs text-red-600 dark:text-red-400" role="alert">
					{launch.error}
				</p>
			)}
			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" size="compact" onClick={onCancel} disabled={starting}>
					Cancel
				</Button>
				<Button type="submit" size="compact" disabled={starting || !connected || !cwd.trim()}>
					{starting ? "Starting…" : "Start"}
				</Button>
			</div>
		</form>
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

interface InboxNavProps {
	project: string | null;
	target: InboxTarget | null;
	onTarget: (target: InboxTarget) => void;
}

/** The inbox page's sections with their pull request counts, per repository, each a link to its section on the page. */
function InboxNav({ project, target, onTarget }: InboxNavProps) {
	const { read, error } = useInbox(project, false);
	const note = (text: string) => <p className="px-2 py-1 text-xs text-muted-foreground">{text}</p>;
	if (!read) return <SidebarGroup>{note(error ? `Cannot load the inbox: ${error}` : "Asking GitHub for pull requests…")}</SidebarGroup>;
	const { repos } = read.inbox;
	if (repos.length === 0) return <SidebarGroup>{note("No session ran in a GitHub repository.")}</SidebarGroup>;
	return repos.map(repo => {
		const name = `${repo.owner}/${repo.repo}`;
		const key = inboxRepoKey(repo);
		const sections = "error" in repo ? [] : inboxSections(repo.pullRequests);
		let body: ReactNode;
		if ("error" in repo) body = note(`Cannot read ${name} from GitHub.`);
		else if (sections.length === 0) body = note("No open pull requests and no reviews waiting.");
		else
			body = (
				<SidebarMenu aria-label={repos.length > 1 ? `Inbox sections of ${name}` : "Inbox sections"}>
					{sections.map(({ title, pullRequests: { length } }) => {
						const chosen = target?.repo === key && target.title === title;
						return (
							<SidebarMenuItem key={title}>
								<SidebarMenuButton asChild isActive={chosen}>
									<a
										href={hashForInbox(null)}
										aria-controls={inboxSectionId({ repo: key, title })}
										aria-current={chosen ? "location" : undefined}
										aria-label={`${title}, ${length} pull request${length === 1 ? "" : "s"}`}
										onClick={event => {
											// Modified and middle clicks keep the link's own new-tab behavior.
											if (event.button !== 0 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
											event.preventDefault();
											onTarget({ repo: key, title });
										}}
									>
										{title}
									</a>
								</SidebarMenuButton>
								<SidebarMenuBadge aria-hidden>{length}</SidebarMenuBadge>
							</SidebarMenuItem>
						);
					})}
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

interface RosterProps {
	hosts: RosterHost[];
	past: PastSession[];
	/** Views on screen, highlighted in the list. */
	open: View[];
	connected: boolean;
	launch: Launch;
	defaultCwd: string;
	/** The settings page, for the open session's workspace. */
	settingsHref: string;
	settingsOpen: boolean;
	/** The inbox page is open, which selects the sidebar's Inbox tab. */
	inboxOpen: boolean;
	onInboxOpen: (open: boolean) => void;
	/** The inbox section a sidebar link last chose. */
	inboxTarget: InboxTarget | null;
	onInboxTarget: (target: InboxTarget) => void;
	/** The selected project's `cwd`, or `null` for all projects. */
	project: string | null;
	onPickProject: (cwd: string | null) => void;
	onOpen: (view: View, mode: OpenMode) => void;
	onLaunchOpen: (open: boolean) => void;
	onCreate: (cwd: string) => void;
	onShowShortcuts: () => void;
}

export function Roster({
	hosts,
	past,
	open,
	connected,
	launch,
	defaultCwd,
	settingsHref,
	settingsOpen,
	inboxOpen,
	onInboxOpen,
	inboxTarget,
	onInboxTarget,
	project,
	onPickProject,
	onOpen,
	onLaunchOpen,
	onCreate,
	onShowShortcuts,
}: RosterProps) {
	const [runningOpen, setRunningOpen] = useState(true);
	const [filter, setFilter] = useState("");
	const projects = workspaces(hosts, past);
	const inProject = (row: { cwd: string }): boolean => project === null || row.cwd === project;
	const shownHosts = hosts.filter(inProject);
	const shownPast = past.filter(session => inProject(session) && matchesFilter(session, pastLabel(session), filter));
	const isOpen = (view: View): boolean => open.some(pane => sameView(pane, view));
	const splitAction = (view: View, name: string) =>
		!isOpen(view) && (
			<SidebarMenuAction
				showOnHover
				aria-label={`Open ${name} in split`}
				title={open.length < MAX_PANES ? "Open in split (⌘-click)" : `Open in the focused pane: ${MAX_PANES} panes is the most`}
				onClick={() => onOpen(view, "split")}
			>
				<Columns2 />
			</SidebarMenuAction>
		);
	return (
		<Tabs value={inboxOpen ? "inbox" : "sessions"} onValueChange={value => onInboxOpen(value === "inbox")} className="flex min-h-0 flex-1 flex-col">
			<SidebarHeader className="flex-row items-center justify-between gap-2 px-2 pt-4">
				<h1 className="sr-only">omp sessions</h1>
				<ProjectPicker projects={projects} current={project} onPick={onPickProject} />
				<Button variant="ghost" size="icon-compact" className="ml-auto shrink-0 text-muted-foreground" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={onShowShortcuts}>
					<Keyboard />
				</Button>

				<Button asChild variant="ghost" size="icon-compact" active={settingsOpen} className="shrink-0 text-muted-foreground">
					<a href={settingsHref} title="Settings" aria-label="Settings" aria-current={settingsOpen ? "page" : undefined}>
						<Settings />
					</a>
				</Button>
			</SidebarHeader>
			<TabsList aria-label="Sidebar" className="mx-2 flex">
				{(["Inbox", "Sessions"] as const).map(label => (
					<TabItem key={label} value={label.toLowerCase()} label={label} className="flex-1 justify-center" />
				))}
			</TabsList>
			{!connected && (
				<p className="mx-3 mt-2 rounded-md bg-red-500/10 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">
					Lost the dashboard server. Retrying…
				</p>
			)}
			{/* SidebarContent puts `hidden` on its inner element, so the class hides its scroll frame too. */}
			<TabPanel value="sessions" forceMount asChild className={inboxOpen ? "hidden" : undefined}>
				<SidebarContent>
					<SidebarGroup collapsible open={runningOpen} onOpenChange={setRunningOpen}>
						<SidebarGroupLabel>
							{hosts.length === 0
								? "No sessions"
								: project
									? `${shownHosts.length} of ${hosts.length} running`
									: `${hosts.length} running`}
						</SidebarGroupLabel>
						<SidebarGroupAction
							title="New session"
							aria-label="New session"
							aria-expanded={launch.phase !== "closed"}
							onClick={() => {
								if (launch.phase === "closed") setRunningOpen(true);
								onLaunchOpen(launch.phase === "closed");
							}}
						>
							<Plus />
						</SidebarGroupAction>
						{launch.phase !== "closed" && (
							<NewSessionForm
								launch={launch}
								defaultCwd={defaultCwd}
								connected={connected}
								onCreate={onCreate}
								onCancel={() => onLaunchOpen(false)}
							/>
						)}
						<SidebarMenu aria-label="Running omp sessions">
							{shownHosts.map(host => {
								const hostView: View = { kind: "live", instanceId: host.instanceId, agentId: null };
								return (
									<SidebarMenuItem key={host.instanceId}>
										<SidebarMenuButton
											size="lg"
											isActive={isOpen(hostView)}
											onClick={event => onOpen(hostView, modeOf(event))}
											title={`${host.cwd}\npid ${host.pid} · ${host.source === "terminal" ? `${host.participants} participants${host.relayConnected ? "" : " · relay offline"}` : "started here"}`}
										>
											<StatusDot status={host.status} />
											<span className="flex min-w-0 flex-1 flex-col gap-0.5">
												<span className="flex items-baseline gap-2">
													<span className="truncate font-medium text-foreground">{hostLabel(host)}</span>
													<span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{age(host.startedAt)}</span>
												</span>
												<span className="truncate text-xs text-muted-foreground">
													{[
														statusLabel(host.status),
														host.source === "terminal" && !host.relayConnected && "relay offline",
														host.pullRequests.map(pr => `#${pr.number}`).join(" "),
													]
														.filter(Boolean)
														.join(" · ")}
												</span>
											</span>
										</SidebarMenuButton>
										{splitAction(hostView, hostLabel(host))}
									</SidebarMenuItem>
								);
							})}
						</SidebarMenu>
					</SidebarGroup>
					<SidebarGroup collapsible>
						<SidebarGroupLabel>
							{past.length === 0
								? "No past sessions"
								: filter.trim() || project
									? `${shownPast.length} of ${past.length} past`
									: `${past.length} past`}
						</SidebarGroupLabel>
						{past.length > 0 && (
							<div className="px-2 pb-2">
								<SidebarInput
									type="search"
									value={filter}
									onChange={event => setFilter(event.target.value)}
									placeholder="Filter, or paste a PR link"
									aria-label="Filter past sessions"
									spellCheck={false}
									className="text-xs"
								/>
							</div>
						)}
						<SidebarMenu aria-label="Past omp sessions">
							{shownPast.map(session => {
								const pastView: View = { kind: "past", sessionId: session.sessionId };
								return (
									<SidebarMenuItem key={session.sessionId}>
										<SidebarMenuButton
											size="lg"
											isActive={isOpen(pastView)}
											onClick={event => onOpen(pastView, modeOf(event))}
											title={`${session.cwd}\nlast active ${new Date(session.modifiedAt).toLocaleString()}`}
										>
											<span className="size-4 shrink-0" aria-hidden />
											<span className="flex min-w-0 flex-1 flex-col gap-0.5">
												<span className="flex items-baseline gap-2">
													<span className="truncate font-medium text-foreground">{pastLabel(session)}</span>
													<span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
														{age(session.modifiedAt)}
													</span>
												</span>
												{session.pullRequests.length > 0 && (
													<span className="truncate text-xs text-muted-foreground">
														{session.pullRequests.map(pr => `#${pr.number}`).join(" ")}
													</span>
												)}
											</span>
										</SidebarMenuButton>
										{splitAction(pastView, pastLabel(session))}
									</SidebarMenuItem>
								);
							})}
						</SidebarMenu>
					</SidebarGroup>
				</SidebarContent>
			</TabPanel>
			<TabPanel value="inbox" asChild>
				<SidebarContent>
					<InboxNav project={project} target={inboxTarget} onTarget={onInboxTarget} />
				</SidebarContent>
			</TabPanel>
		</Tabs>
	);
}
