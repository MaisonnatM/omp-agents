/** `HostRow` and `PastRow`, a running or past session's row in the sidebar, with its status, age, and actions menu. */
import { Columns2, Loader } from "lucide-react";
import { Fragment, memo, type ReactElement, type ReactNode, useContext } from "react";
import { awaitsSubagents, type PastSession, type RosterHost, type View } from "../../src/shared/sessions";
import { Badge } from "@/components/ui/badge";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, MenuItem, MenuLinkItem, MenuSeparator, MenuShortcut } from "@/components/ui/menu";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { PrivateChip } from "./private-chip";
import { cn } from "@/lib/utils";
import type { PaletteAction } from "../command-palette";
import { hostLabel, modeOf, pastLabel, PRIVATE_NOTE, SOURCE_LABELS, SPLIT_CLICK, workspaceName } from "../labels";
import type { OpenMode } from "../routing";
import { sessionActions, type SessionEntry, type SessionRun } from "../session-actions";
import { isPrivateHost, type RowPlacement, workspaceCwd, workspaceOf } from "../sessions";
import { type InlineConfirm, useInlineConfirm } from "../use-inline-confirm";
import { Age } from "./age";
import { PersonalContext, useDashboardActions, useDashboardStatus } from "./dashboard-context";
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
			<span className="truncate font-medium text-foreground">{label}</span>
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
			{split && <Columns2 role="img" aria-label="In a split" className="size-3 shrink-0 translate-y-0.5 text-muted-foreground/50" />}
			<Age at={when} compact className={cn(ROW_END, "w-7 text-right")} />
		</>
	);
	return (
		<Tooltip content={`${label}. ${title}. ${split ? "In a split." : `${SPLIT_CLICK} to open in a split`}`} side="right">
			<SidebarMenuButton isActive={placement !== "hidden"} onClick={event => onOpen(view, modeOf(event))}>
				<RowLine dot={dot} badge={badge} label={label} facts={facts} end={end} />
			</SidebarMenuButton>
		</Tooltip>
	);
}

/**
 * The workspace a row counts in, before its label, shown only under all workspaces: on a titled row, and on an untitled one,
 * whose label is its directory's name, when that directory is not its workspace's, as a linked worktree's is not.
 */
export function WorkspaceBadge({ cwdDisplay }: { cwdDisplay: string }) {
	const personal = useContext(PersonalContext);
	const name = workspaceName(cwdDisplay, personal);
	return name ? <Badge size="compact" className="shrink-0 self-center">{name}</Badge> : null;
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
			{...(action.confirm !== undefined ? { closeOnClick: armed, ...confirm.props(action.id, run.fn) } : { onClick: run.fn })}
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
	/** The row is listed under Pinned; a pinned interrupted session says so, as its own group does not. */
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
				badge={showWorkspace && (session.title !== null || workspaceCwd(session) !== session.cwd) ? <WorkspaceBadge cwdDisplay={workspaceOf(session).cwdDisplay} /> : null}
				facts={sessionFacts([session.source !== "omp" && SOURCE_LABELS[session.source], pinned && session.interrupted && "interrupted"])}
				when={session.modifiedAt}
				placement={placement}
				onOpen={onOpen}
			/>
		</RowMenu>
	);
});

function HostStatus({ host, status }: { host: RosterHost; status: RowStatus }) {
	const ending = useDashboardStatus().ending.has(host.instanceId);
	return ending
		? <span role="img" aria-label="Ending session" aria-busy className="flex h-4 w-1.5 shrink-0 items-center justify-center"><Loader className="size-3 shrink-0 animate-spin" /></span>
		: <StatusDot status={status} />;
}

/** A running session's row, with its status dot, and End session where the server controls it. */
export const HostRow = memo(function HostRow({ session: host, pinned, placement, showWorkspace, onTogglePin }: RowProps<RosterHost>) {
	const { open: onOpen } = useDashboardActions();
	const view: View = { kind: "live", instanceId: host.instanceId, agentId: null };
	const label = hostLabel(host);
	// A session waiting on its subagents needs nothing from you, so its row drops the idle dot that would say its work is done.
	const status = awaitsSubagents(host) ? "awaiting-subagents" : host.status;
	const isPrivate = isPrivateHost(host);
	const workspace = showWorkspace && (host.sessionName !== null || workspaceCwd(host) !== host.cwd) ? <WorkspaceBadge cwdDisplay={workspaceOf(host).cwdDisplay} /> : null;
	return (
		<RowMenu entry={{ kind: "live", host }} onScreen={placement !== "hidden"} pinned={pinned} onTogglePin={onTogglePin}>
			<SessionButton
				view={view}
				label={label}
				title={`${statusLabel(status)}\n${host.cwd}\npid ${host.pid} · ${host.source === "terminal" ? `${host.participants} participants${host.relayConnected ? "" : " · relay offline"}` : "started here"}${isPrivate ? `\n${PRIVATE_NOTE}` : ""}`}
				badge={
					isPrivate ? (
						<span className="flex items-center gap-1.5">
							<PrivateChip />
							{workspace}
						</span>
					) : (
						workspace
					)
				}
				facts={sessionFacts([host.source === "terminal" && !host.relayConnected && "relay offline"])}
				when={host.startedAt}
				dot={<HostStatus host={host} status={status} />}
				placement={placement}
				onOpen={onOpen}
			/>
		</RowMenu>
	);
});
