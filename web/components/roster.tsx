import { Check, ChevronsUpDown, Folder, Plus, Settings } from "lucide-react";
import { useState } from "react";
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
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { Launch } from "../use-dashboard";
import { agentTree, hashForView, matchesFilter, workspaces } from "../view-model";
import { StatusDot, statusLabel } from "./status-dot";

/** Pixels of extra indent per nesting level below the first subagent level. */
const NEST_INDENT = 12;

/** The project the sidebar is scoped to, by `cwd`; absent for all projects. */
const PROJECT_KEY = "omp-agents.sidebar-project";

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

interface RosterProps {
	hosts: RosterHost[];
	past: PastSession[];
	view: View | null;
	connected: boolean;
	launch: Launch;
	defaultCwd: string;
	/** The settings page, for the open session's workspace. */
	settingsHref: string;
	settingsOpen: boolean;
	onSelect: (view: View) => void;
	onLaunchOpen: (open: boolean) => void;
	onCreate: (cwd: string) => void;
}

export function Roster({
	hosts,
	past,
	view,
	connected,
	launch,
	defaultCwd,
	settingsHref,
	settingsOpen,
	onSelect,
	onLaunchOpen,
	onCreate,
}: RosterProps) {
	const [runningOpen, setRunningOpen] = useState(true);
	const [filter, setFilter] = useState("");
	const [storedProject, setStoredProject] = useState(() => localStorage.getItem(PROJECT_KEY));
	const projects = workspaces(hosts, past);
	// A stored project with no sessions left, or not yet loaded, shows all of them.
	const project = projects.some(({ cwd }) => cwd === storedProject) ? storedProject : null;
	const pickProject = (cwd: string | null): void => {
		setStoredProject(cwd);
		if (cwd === null) localStorage.removeItem(PROJECT_KEY);
		else localStorage.setItem(PROJECT_KEY, cwd);
	};
	const inProject = (row: { cwd: string }): boolean => project === null || row.cwd === project;
	const shownHosts = hosts.filter(inProject);
	const shownPast = past.filter(session => inProject(session) && matchesFilter(session, pastLabel(session), filter));
	return (
		<>
			<SidebarHeader className="flex-row items-center justify-between gap-2 px-2 pt-4">
				<h1 className="sr-only">omp sessions</h1>
				<ProjectPicker projects={projects} current={project} onPick={pickProject} />
				<Button asChild variant="ghost" size="icon-compact" active={settingsOpen} className="shrink-0 text-muted-foreground">
					<a href={settingsHref} title="Settings" aria-label="Settings" aria-current={settingsOpen ? "page" : undefined}>
						<Settings />
					</a>
				</Button>
			</SidebarHeader>
			{!connected && (
				<p className="mx-3 rounded-md bg-red-500/10 px-3 py-1.5 text-xs text-red-600 dark:text-red-400">
					Lost the dashboard server. Retrying…
				</p>
			)}
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
						{shownHosts.map(host => (
							<SidebarMenuItem key={host.instanceId}>
								<SidebarMenuButton
									size="lg"
									isActive={view?.kind === "live" && view.instanceId === host.instanceId && view.agentId === null}
									onClick={() => onSelect({ kind: "live", instanceId: host.instanceId, agentId: null })}
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
												host.cwdDisplay,
												host.model ?? "no model",
												statusLabel(host.status),
												host.source === "terminal" && !host.relayConnected && "relay offline",
												host.pullRequests.map(pr => `#${pr.number}`).join(" "),
											]
												.filter(Boolean)
												.join(" · ")}
										</span>
									</span>
								</SidebarMenuButton>
								{host.agents.length > 0 && (
									<SidebarMenuSub aria-label={`Subagents of ${hostLabel(host)}`}>
										{agentTree(host.agents).map(({ agent, depth }) => {
											const agentView: View = { kind: "live", instanceId: host.instanceId, agentId: agent.id };
											return (
												<SidebarMenuSubItem key={agent.id}>
													<SidebarMenuSubButton
														href={hashForView(agentView)}
														isActive={view?.kind === "live" && view.instanceId === host.instanceId && view.agentId === agent.id}
														className="h-auto min-h-7 py-1"
														style={{ marginInlineStart: depth * NEST_INDENT }}
														title={agent.activity ?? undefined}
													>
														<StatusDot status={agent.status} />
														<span className="flex min-w-0 flex-1 flex-col">
															<span className="flex items-baseline gap-1.5">
																<span className="truncate text-foreground">{agent.id}</span>
																<span className="shrink-0 text-xs text-muted-foreground">
																	{agent.kind} · {statusLabel(agent.status)}
																</span>
															</span>
															{agent.activity && (
																<span className="truncate text-xs text-muted-foreground">{agent.activity}</span>
															)}
														</span>
													</SidebarMenuSubButton>
												</SidebarMenuSubItem>
											);
										})}
									</SidebarMenuSub>
								)}
							</SidebarMenuItem>
						))}
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
						{shownPast.map(session => (
							<SidebarMenuItem key={session.sessionId}>
								<SidebarMenuButton
									size="lg"
									isActive={view?.kind === "past" && view.sessionId === session.sessionId}
									onClick={() => onSelect({ kind: "past", sessionId: session.sessionId })}
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
										<span className="truncate text-xs text-muted-foreground">
											{[session.cwdDisplay || "unknown directory", session.pullRequests.map(pr => `#${pr.number}`).join(" ")]
												.filter(Boolean)
												.join(" · ")}
										</span>
									</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						))}
					</SidebarMenu>
				</SidebarGroup>
			</SidebarContent>
		</>
	);
}
