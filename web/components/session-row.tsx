/** `HostRow` and `PastRow`, a running or past session's row in the sidebar, with its status, age, and actions menu. */
import { IconCalendarClock, IconCircleX, IconClock, IconFlag1, IconFolderDelete, IconLayoutColumn, IconPause } from "central-icons";
import { Fragment, memo, type ReactElement, type ReactNode, useContext } from "react";
import { awaitsCi, awaitsScheduled, awaitsSubagents, type PastSession, type RosterHost, type View, type WatchedChecks } from "../../src/shared/sessions";
import { GENERAL_DISPLAY, type Workspace, workspaceName } from "../../src/shared/workspaces";
import { Badge } from "@/components/ui/badge";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, MenuItem, MenuLinkItem, MenuSeparator, MenuShortcut, MenuSubmenu, MenuSubmenuContent, MenuSubmenuTrigger } from "@/components/ui/menu";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { PrivateChip } from "./private-chip";
import { cn } from "@/lib/utils";
import type { PaletteAction } from "../command-palette";
import { hostLabel, modeOf, pastLabel, PRIVATE_NOTE, SOURCE_LABELS, SPLIT_CLICK } from "../labels";
import type { OpenMode } from "../routing";
import { sessionActions, type SessionEntry, type SessionRun } from "../session-actions";
import { isPrivateHost, type RowPlacement, workspaceCwd, workspaceOf } from "../sessions";
import { JobsContext } from "../jobs-context";
import { type InlineConfirm, useInlineConfirm } from "../use-inline-confirm";
import { Age } from "./age";
import { OpenProjectsContext, useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { Spinner } from "./spinner";
import { type RowStatus, StatusDot, statusLabel } from "./status-dot";

/** The muted facts after a session's name: the parts that apply. */
function sessionFacts(parts: (string | false)[]): { text: string } | null {
	const text = parts.filter(part => part !== false).join(" · ");
	return text ? { text } : null;
}

interface SessionButtonProps {
	view: View;
	label: string;
	title: string;
	badge: ReactNode;
	facts: { text: string } | null;
	when: number;
	dot?: ReactNode;
	placement: RowPlacement;
	onOpen: (view: View, mode: OpenMode) => void;
}

interface RowLineProps {
	dot?: ReactNode;
	badge?: ReactNode;
	label: string;
	facts: { text: string; title?: string; alert?: boolean } | null;
	/** Pinned to the row's right end with {@link ROW_END}, such as its age. */
	end: ReactNode;
}

/** The look of what ends a session row: muted, small, and pushed right. */
export const ROW_END = "ml-auto shrink-0 text-xs tabular-nums text-muted-foreground";

/** A sidebar session row's one line: its dot, label, and muted facts, then its badge and what ends it at the right. Scheduled sends share it. */
export function RowLine({ dot, badge, label, facts, end }: RowLineProps) {
	return (
		<span className="flex min-w-0 flex-1 items-baseline gap-2">
			{/* `contents` makes the dot itself the flex item, so a running session's `sr-only` label takes no gap. */}
			{dot && <span className="contents *:self-center">{dot}</span>}
			<span className="truncate text-foreground">{label}</span>
			{facts && (
				<span className={cn("shrink-0 text-xs", facts.alert ? "text-red-600 dark:text-red-400" : "text-muted-foreground")} title={facts.title}>
					{facts.text}
				</span>
			)}
			<span className="ml-auto flex shrink-0 items-baseline gap-2">
				{badge && <span className="flex shrink-0 self-center">{badge}</span>}
				{end}
			</span>
		</span>
	);
}

function SessionButton({ view, label, title, badge, facts, when, dot, placement, onOpen }: SessionButtonProps) {
	const split = placement === "split";
	const end = (
		<>
			{split && <IconLayoutColumn aria-hidden={false} aria-label="In a split" className="size-3 shrink-0 translate-y-0.5 text-muted-foreground/50" />}
			<Age at={when} compact className={cn(ROW_END, "w-7 text-right")} />
		</>
	);
	return (
		<Tooltip content={`${label}. ${title}. ${split ? "In a split." : `${SPLIT_CLICK} to open in a split`}`} side="right">
			<SidebarMenuButton isActive={placement !== "hidden"} size="short" onClick={event => onOpen(view, modeOf(event))}>
				<RowLine dot={dot} badge={badge} label={label} facts={facts} end={end} />
			</SidebarMenuButton>
		</Tooltip>
	);
}

/**
 * The badge before a row's age: under all workspaces, the workspace it counts in, on a titled row, and on an untitled one,
 * whose label is its directory's name, when that directory is not its workspace's, as a linked worktree's is not; in the
 * General workspace, the directory it ran in, such as `~/tmp` or `~`, unless that is General's own `~/code`.
 */
function rowBadge(row: { cwd: string; cwdDisplay: string; workspace: Workspace | null }, titled: boolean, showWorkspace: boolean): ReactNode {
	const workspace = workspaceOf(row);
	const text = showWorkspace ? (titled || workspace.cwd !== row.cwd ? workspaceName(workspace.cwdDisplay) : null) : workspace.cwdDisplay === GENERAL_DISPLAY && workspace.cwd !== row.cwd ? row.cwdDisplay : null;
	return text === null ? null : <Badge size="compact" className="shrink-0 self-center">{text}</Badge>;
}

interface RowMenuProps {
	entry: SessionEntry;
	/** The session shows in a pane. */
	onScreen: boolean;
	pinned: boolean;
	onTogglePin: (sessionId: string) => void;
	/** The row's `SidebarMenuButton`. */
	children: ReactElement;
}

/**
 * The actions of a row's menu. It reads the dashboard's actions and start state, which the menu's content mounts only
 * while it is open, so a row that keeps its menu closed renders for neither.
 */
function RowMenuItems({ entry, onScreen, pinned, onTogglePin }: Omit<RowMenuProps, "children">) {
	const { open, send, start, end, workspaceSettings } = useDashboardActions();
	const { starts: { resume }, ending } = useDashboardStatus();
	const confirm = useInlineConfirm(entry.kind === "live" ? `end:${entry.host.instanceId}` : "end");
	const actions = sessionActions(entry, {
		onScreen,
		pinned,
		resuming: resume?.phase === "starting" ? resume.op.sessionId : null,
		ending: entry.kind === "live" && ending.has(entry.host.instanceId),
		open,
		togglePin: onTogglePin,
		resume: sessionId => start({ kind: "resume", sessionId }),
		dismissInterrupted: sessionId => send({ t: "dismiss-interrupted", sessionId }),
		end,
		workspaceSettings: workspaceSettings(workspaceCwd(entry.kind === "live" ? entry.host : entry.session)),
	});
	return (
		<>
			{actions.map((group, index) => (
				<Fragment key={group[0].id}>
					{index > 0 && <MenuSeparator />}
					{group.map(action => (
						<ActionItem key={action.id} action={action} confirm={confirm} />
					))}
				</Fragment>
			))}
			<ProjectItems sessionId={entry.kind === "live" ? entry.host.sessionId : entry.session.sessionId} />
		</>
	);
}

/** Move to project, a submenu of the open projects the session is not in, and Remove from project while it is in one; nothing while Projects is off or no project is open. */
function ProjectItems({ sessionId }: { sessionId: string }) {
	const projects = useContext(OpenProjectsContext);
	const { changeModule } = useDashboardActions();
	const { connected } = useDashboardStatus();
	if (projects.length === 0) return null;
	const current = projects.find(project => project.sessionIds.includes(sessionId));
	const others = projects.filter(project => project !== current);
	return (
		<>
			<MenuSeparator />
			{others.length > 0 && (
				<MenuSubmenu>
					<MenuSubmenuTrigger disabled={!connected}>
						<IconFlag1 />
						Move to project
					</MenuSubmenuTrigger>
					<MenuSubmenuContent>
						{others.map(project => (
							<MenuItem key={project.id} onClick={() => changeModule("projects", { op: "join", projectId: project.id, sessionId })}>
								<IconFlag1 />
								<span className="truncate">{project.name}</span>
							</MenuItem>
						))}
					</MenuSubmenuContent>
				</MenuSubmenu>
			)}
			{current && (
				<MenuItem disabled={!connected} onClick={() => changeModule("projects", { op: "leave", sessionId })}>
					<IconFolderDelete />
					Remove from project
				</MenuItem>
			)}
		</>
	);
}

/** A sidebar row whose {@link sessionActions} open on right-click. */
function RowMenu({ entry, onScreen, pinned, onTogglePin, children }: RowMenuProps) {
	return (
		<ContextMenu>
			<ContextMenuTrigger render={<SidebarMenuItem />}>{children}</ContextMenuTrigger>
			<ContextMenuContent>
				<RowMenuItems entry={entry} onScreen={onScreen} pinned={pinned} onTogglePin={onTogglePin} />
			</ContextMenuContent>
		</ContextMenu>
	);
}

/**
 * One session action as a menu item. Open in split names the click that also runs it from the row. An action with a
 * `confirm` arms on the first click, which keeps the menu open and shows `confirm`, and runs on the second.
 */
function ActionItem({ action, confirm }: { action: PaletteAction<SessionRun>; confirm: InlineConfirm }) {
	const { icon: Icon, title, run } = action;
	if (run.kind === "link") {
		return (
			<MenuLinkItem href={run.href} target={run.external ? "_blank" : undefined} rel={run.external ? "noreferrer" : undefined}>
				<Icon />
				{title}
			</MenuLinkItem>
		);
	}
	const armed = action.confirm !== undefined && confirm.isArmed(action.id);
	return (
		<MenuItem
			variant={action.tone}
			disabled={action.disabled}
			aria-busy={(action.id === "end" && action.disabled) || undefined}
			{...(action.confirm !== undefined ? { closeOnSelect: armed, ...confirm.props(action.id, run.fn) } : { onClick: run.fn })}
		>
			<Icon />
			{armed ? action.confirm : title}
			{action.id === "split" && <MenuShortcut>{SPLIT_CLICK}</MenuShortcut>}
		</MenuItem>
	);
}

/**
 * What a session row takes. Every prop keeps its identity while the row's session is unchanged, so a roster push or a
 * keystroke in the search field re-renders only the rows it touches.
 */
interface RowProps<T> {
	session: T;
	/** The row is listed under Pinned, so its menu offers Unpin. */
	pinned: boolean;
	/** Where the session shows on screen. */
	placement: RowPlacement;
	/** All workspaces are listed, so a row names its workspace where its label does not. */
	showWorkspace: boolean;
	/** Pin the session, or unpin it when it is pinned. */
	onTogglePin: (sessionId: string) => void;
}

export const PastRow = memo(function PastRow({ session, pinned, placement, showWorkspace, onTogglePin }: RowProps<PastSession>) {
	const { open: onOpen } = useDashboardActions();
	const view: View = { kind: "past", sessionId: session.sessionId };
	const label = pastLabel(session);
	return (
		<RowMenu entry={{ kind: "past", session }} onScreen={placement !== "hidden"} pinned={pinned} onTogglePin={onTogglePin}>
			<SessionButton
				view={view}
				label={label}
				title={`${session.cwd}\nlast active ${new Date(session.modifiedAt).toLocaleString()}`}
				badge={rowBadge(session, session.title !== null, showWorkspace)}
				facts={sessionFacts([session.source !== "omp" && SOURCE_LABELS[session.source]])}
				when={session.modifiedAt}
				dot={session.interrupted ? <IconPause aria-hidden={false} aria-label="Interrupted" className="size-3 shrink-0 text-warning-foreground" /> : undefined}
				placement={placement}
				onOpen={onOpen}
			/>
		</RowMenu>
	);
});

/** How many background jobs the session runs, so a running job shows while its agent is idle; nothing while none runs. */
function RunningJobs({ instanceId }: { instanceId: string }) {
	const running = (useContext(JobsContext)[instanceId] ?? []).filter(job => job.state === "running").length;
	if (running === 0) return null;
	const label = `${running} background ${running === 1 ? "job" : "jobs"} running`;
	return (
		<Tooltip content={label}>
			<span role="img" aria-label={label} className="flex h-4 items-center gap-[3px] rounded-full bg-foreground/10 pr-[5px] pl-1 text-2xs font-medium tabular-nums text-foreground">
				<span aria-hidden className="size-2 rounded-full border-[1.5px] border-foreground/25 border-t-foreground motion-safe:animate-spin" />
				{running}
			</span>
		</Tooltip>
	);
}

function HostStatus({ host, status }: { host: RosterHost; status: RowStatus }) {
	const ending = useDashboardStatus().ending.has(host.instanceId);
	if (ending) return <span role="img" aria-label="Ending session" aria-busy className="flex h-4 w-1.5 shrink-0 items-center justify-center"><Spinner className="size-3" /></span>;
	// A session waiting on a scheduled send is not done, so it shows the clock it waits on instead of the idle dot; one waiting on CI shows its pull requests under its row instead.
	if (status === "awaiting-scheduled" && host.scheduledCheck?.kind === "send") return <IconCalendarClock aria-hidden={false} aria-label={statusLabel(status)} className="size-3 shrink-0 text-muted-foreground" />;
	return <StatusDot status={status} />;
}

/** How many pull requests a session in Waiting on CI watches still wait on checks, and how many fail, beside its title. */
function WatchedChecksCount({ prs }: { prs: WatchedChecks[] }) {
	const waiting = prs.filter(watched => watched.checks === null || watched.checks === "pending").length;
	const failing = prs.filter(watched => watched.checks === "failing").length;
	if (waiting === 0 && failing === 0) return null;
	return (
		<span className="flex h-4 items-center gap-1.5 text-2xs leading-none font-medium tabular-nums">
			{waiting > 0 && (
				<span role="img" aria-label={`${waiting} waiting on checks`} className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
					<IconClock aria-hidden className="size-3" />
					{waiting}
				</span>
			)}
			{failing > 0 && (
				<span role="img" aria-label={`${failing} failing checks`} className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
					<IconCircleX aria-hidden className="size-3" />
					{failing}
				</span>
			)}
		</span>
	);
}

/** A running session's row, with its status dot, and End session where the server controls it. */
export const HostRow = memo(function HostRow({ session: host, pinned, placement, showWorkspace, onTogglePin }: RowProps<RosterHost>) {
	const { open: onOpen } = useDashboardActions();
	const view: View = { kind: "live", instanceId: host.instanceId, agentId: null };
	const label = hostLabel(host);
	// A session waiting on its subagents or on a scheduled check needs nothing from you, so its row drops the idle dot that would say its work is done.
	const status = awaitsSubagents(host) ? "awaiting-subagents" : awaitsScheduled(host) ? "awaiting-scheduled" : host.status;
	const scheduledAt = status === "awaiting-scheduled" && host.scheduledCheck?.kind === "send" ? ` until ${new Date(host.scheduledCheck.at).toLocaleString()}` : "";
	const isPrivate = isPrivateHost(host);
	const workspace = rowBadge(host, host.sessionName !== null, showWorkspace);
	return (
		<RowMenu entry={{ kind: "live", host }} onScreen={placement !== "hidden"} pinned={pinned} onTogglePin={onTogglePin}>
			<>
				<SessionButton
					view={view}
					label={label}
					title={`${statusLabel(status)}${scheduledAt}\n${host.cwd}\npid ${host.pid} · ${host.source === "terminal" ? `${host.participants} participants${host.relayConnected ? "" : " · relay offline"}` : "started here"}${isPrivate ? `\n${PRIVATE_NOTE}` : ""}`}
					badge={
						<span className="flex items-center gap-1.5">
							<RunningJobs instanceId={host.instanceId} />
							{awaitsCi(host) && host.scheduledCheck?.kind === "pull-request" && <WatchedChecksCount prs={host.scheduledCheck.prs} />}
							{isPrivate && <PrivateChip />}
							{workspace}
						</span>
					}
					facts={sessionFacts([host.source === "terminal" && !host.relayConnected && "relay offline"])}
					when={host.startedAt}
					dot={<HostStatus host={host} status={status} />}
					placement={placement}
					onOpen={onOpen}
				/>
			</>
		</RowMenu>
	);
});
