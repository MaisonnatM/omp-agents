import { Ellipsis, Loader } from "lucide-react";
import { Fragment, memo, type ReactElement, type ReactNode, useState } from "react";
import type { PullRequest } from "../../src/shared/github";
import type { PastSession, RosterHost, ShipProgress, View } from "../../src/shared/sessions";
import { Badge } from "@/components/ui/badge";
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
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import type { PaletteAction } from "../command-palette";
import { folderName, hostLabel, modeOf, pastLabel, pullRequestsLabel, SPLIT_CLICK } from "../labels";
import type { OpenMode } from "../routing";
import { sessionActions, type SessionEntry, type SessionRun } from "../session-actions";
import { Age } from "./age";
import { useDashboardActions, useDashboardStatus } from "./dashboard-context";
import { ShipStep } from "./ship-step";
import { StatusDot, statusLabel } from "./status-dot";

/** The muted facts after a session's name: the parts that apply, and a title listing its pull requests. */
function sessionFacts(parts: (string | false)[], pullRequests: PullRequest[]): { text: string; title?: string } | null {
	const text = parts.filter(part => part !== false).join(" · ");
	if (!text) return null;
	const title = pullRequests.map(pr => `${pr.repo}#${pr.number}`).join("\n");
	return { text, title: title || undefined };
}

interface SessionButtonProps {
	view: View;
	label: string;
	title: string;
	badge: ReactNode;
	ship: ShipProgress | null;
	/** Muted facts after the ship step, joined already; `title` is the fuller list, such as each pull request. */
	facts: { text: string; title?: string } | null;
	when: number;
	dot?: ReactNode;
	open: boolean;
	onOpen: (view: View, mode: OpenMode) => void;
}

function SessionButton({ view, label, title, badge, ship, facts, when, dot, open, onOpen }: SessionButtonProps) {
	return (
		<Tooltip content={`${label}. ${title}. ${SPLIT_CLICK} to open in a split`} side="right">
			<SidebarMenuButton isActive={open} onClick={event => onOpen(view, modeOf(event))}>
				{dot}
				<span className="flex min-w-0 flex-1 items-baseline gap-2">
					{badge}
					<span className="truncate font-medium text-foreground">{label}</span>
					<ShipStep ship={ship} />
					{facts && (
						<span className="shrink-0 text-xs text-muted-foreground" title={facts.title}>
							{facts.text}
						</span>
					)}
					<Age at={when} className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground" />
				</span>
			</SidebarMenuButton>
		</Tooltip>
	);
}

/** The workspace a titled row ran in, before its title, shown only under all workspaces. An untitled row's label is already the workspace's name. */
function WorkspaceBadge({ cwdDisplay }: { cwdDisplay: string }) {
	const name = folderName(cwdDisplay);
	return name ? <Badge size="compact" className="shrink-0 self-center">{name}</Badge> : null;
}

interface RowMenuProps {
	/** The row's name, which the "More actions" button is labelled after. */
	label: string;
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
function RowMenuItems({ entry, onScreen, pinned, onTogglePin }: Omit<RowMenuProps, "label" | "children">) {
	const { open, send, start, end } = useDashboardActions();
	const { starts: { resume }, ending } = useDashboardStatus();
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
	});
	return (
		<>
			{actions.map((group, index) => (
				<Fragment key={group[0].id}>
					{index > 0 && <MenuSeparator />}
					{group.map(action => (
						<ActionItem key={action.id} action={action} />
					))}
				</Fragment>
			))}
		</>
	);
}

/** A sidebar row whose {@link sessionActions} open on right-click and from its hover-revealed "More actions" button. */
function RowMenu({ label, entry, onScreen, pinned, onTogglePin, children }: RowMenuProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	const items = <RowMenuItems entry={entry} onScreen={onScreen} pinned={pinned} onTogglePin={onTogglePin} />;
	return (
		<ContextMenu>
			<ContextMenuTrigger render={<SidebarMenuItem />}>
				{children}
				<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
					<Tooltip content="More actions" forceOpen={menuOpen ? false : undefined}>
						<DropdownMenuTrigger render={<SidebarMenuAction showOnHover aria-label={`More actions for ${label}`} />}>
							<Ellipsis />
						</DropdownMenuTrigger>
					</Tooltip>
					<DropdownMenuContent align="end">{items}</DropdownMenuContent>
				</DropdownMenu>
			</ContextMenuTrigger>
			<ContextMenuContent>{items}</ContextMenuContent>
		</ContextMenu>
	);
}

/** One session action as a menu item. Open in split names the click that also runs it from the row. */
function ActionItem({ action }: { action: PaletteAction<SessionRun> }) {
	const { icon: Icon, title, run } = action;
	if (run.kind === "link") {
		return (
			<MenuLinkItem href={run.href} target={run.external ? "_blank" : undefined} rel={run.external ? "noreferrer" : undefined}>
				<Icon />
				{title}
			</MenuLinkItem>
		);
	}
	return (
		<MenuItem variant={action.tone} disabled={action.disabled} aria-busy={(action.id === "end" && action.disabled) || undefined} onClick={run.fn}>
			<Icon />
			{title}
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
	/** The session is on screen. */
	open: boolean;
	/** All workspaces are listed, so a titled row names its workspace. */
	showWorkspace: boolean;
	/** Pin the session, or unpin it when it is pinned. */
	onTogglePin: (sessionId: string) => void;
	/** The session's role in the project whose group lists it, Coordinator or a worker's id; its badge replaces the workspace's. */
	role?: string;
	/** The title the coordinator gave the worker, which names the row in place of the session's own title. */
	roleTitle?: string;
}

/** A past session's row, with Resume, and Move to past while it is interrupted. */
export const PastRow = memo(function PastRow({ session, pinned, open, showWorkspace, onTogglePin, role, roleTitle }: RowProps<PastSession>) {
	const { open: onOpen } = useDashboardActions();
	const view: View = { kind: "past", sessionId: session.sessionId };
	const label = roleTitle ?? pastLabel(session);
	return (
		<RowMenu label={label} entry={{ kind: "past", session }} onScreen={open} pinned={pinned} onTogglePin={onTogglePin}>
			<SessionButton
				view={view}
				label={label}
				title={`${session.cwd}\nlast active ${new Date(session.modifiedAt).toLocaleString()}`}
				badge={role ? <Badge size="compact" className="shrink-0 self-center">{role}</Badge> : showWorkspace && session.title !== null ? <WorkspaceBadge cwdDisplay={session.cwdDisplay} /> : null}
				ship={session.ship}
				facts={sessionFacts([pinned && session.interrupted && "interrupted", session.pullRequests.length > 0 && pullRequestsLabel(session.pullRequests)], session.pullRequests)}
				when={session.modifiedAt}
				open={open}
				onOpen={onOpen}
			/>
		</RowMenu>
	);
});

function HostStatus({ host }: { host: RosterHost }) {
	const ending = useDashboardStatus().ending.has(host.instanceId);
	return ending
		? <span role="img" aria-label="Ending session" aria-busy className="flex h-4 w-1.5 shrink-0 items-center justify-center"><Loader className="size-3 shrink-0 animate-spin" /></span>
		: <StatusDot status={host.status} />;
}

/** A running session's row, with its status dot, and End session where the server controls it. */
export const HostRow = memo(function HostRow({ session: host, pinned, open, showWorkspace, onTogglePin, role, roleTitle }: RowProps<RosterHost>) {
	const { open: onOpen } = useDashboardActions();
	const view: View = { kind: "live", instanceId: host.instanceId, agentId: null };
	const label = roleTitle ?? hostLabel(host);
	return (
		<RowMenu label={label} entry={{ kind: "live", host }} onScreen={open} pinned={pinned} onTogglePin={onTogglePin}>
			<SessionButton
				view={view}
				label={label}
				title={`${statusLabel(host.status)}\n${host.cwd}\npid ${host.pid} · ${host.source === "terminal" ? `${host.participants} participants${host.relayConnected ? "" : " · relay offline"}` : "started here"}`}
				badge={role ? <Badge size="compact" className="shrink-0 self-center">{role}</Badge> : showWorkspace && host.sessionName !== null ? <WorkspaceBadge cwdDisplay={host.cwdDisplay} /> : null}
				ship={host.ship}
				facts={sessionFacts([host.source === "terminal" && !host.relayConnected && "relay offline", host.pullRequests.length > 0 && pullRequestsLabel(host.pullRequests)], host.pullRequests)}
				when={host.startedAt}
				dot={<HostStatus host={host} />}
				open={open}
				onOpen={onOpen}
			/>
		</RowMenu>
	);
});
