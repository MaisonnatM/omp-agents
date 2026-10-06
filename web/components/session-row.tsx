import { AppWindow, Archive, CircleStop, Columns2, Copy, Ellipsis, Folder, GitPullRequest, Pin, PinOff, Play, Settings } from "lucide-react";
import { memo, type ReactElement, type ReactNode, useState } from "react";
import { type PullRequest, pullRequestUrl } from "../../src/shared/github";
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
import { age, hostLabel, modeOf, pastLabel, projectName, pullRequestsLabel, SPLIT_CLICK } from "../labels";
import { PAGE_ICON } from "../page-icons";
import { hashForSettings, hashForTickets, type OpenMode } from "../routing";
import { useMinute } from "../use-minute";
import { useDashboardContext } from "./dashboard-context";
import { ShipStep } from "./ship-step";
import { StatusDot, statusLabel } from "./status-dot";

/** The muted facts after a session's name: the parts that apply, and a title listing its pull requests. */
function sessionFacts(parts: (string | false)[], pullRequests: PullRequest[]): { text: string; title?: string } | null {
	const text = parts.filter(part => part !== false).join(" · ");
	if (!text) return null;
	const title = pullRequests.map(pr => `${pr.repo}#${pr.number}`).join("\n");
	return { text, title: title || undefined };
}

/** How long ago `when` was, counting up each minute on the page's one timer. */
function Age({ when }: { when: number }) {
	useMinute();
	return <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{age(when)}</span>;
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
					<Age when={when} />
				</span>
			</SidebarMenuButton>
		</Tooltip>
	);
}

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
}

/** A sidebar row whose quick actions open on right-click and from its hover-revealed "More actions" button. */
function RowMenu({ view, label, isOpen, onOpen, children, items }: RowMenuProps) {
	const [menuOpen, setMenuOpen] = useState(false);
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
			<ContextMenuTrigger render={<SidebarMenuItem />}>
				{children}
				<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
					<Tooltip content="More actions" forceOpen={menuOpen ? false : undefined}>
						<DropdownMenuTrigger render={<SidebarMenuAction showOnHover aria-label={`More actions for ${label}`} />}>
							<Ellipsis />
						</DropdownMenuTrigger>
					</Tooltip>
					<DropdownMenuContent align="end">{menuItems}</DropdownMenuContent>
				</DropdownMenu>
			</ContextMenuTrigger>
			<ContextMenuContent>{menuItems}</ContextMenuContent>
		</ContextMenu>
	);
}

interface SessionItemsProps {
	row: { cwd: string; sessionId: string; pullRequests: PullRequest[]; tickets: string[] };
	pinned: boolean;
	onTogglePin: (sessionId: string) => void;
}

/** Items a running or past session's menu shares: pinning it, its pull requests and Linear issues, its workspace's settings, and copying its ids. */
function SessionItems({ row, pinned, onTogglePin }: SessionItemsProps) {
	return (
		<>
			<MenuItem onClick={() => onTogglePin(row.sessionId)}>
				{pinned ? <PinOff /> : <Pin />}
				{pinned ? "Unpin" : "Pin"}
			</MenuItem>
			<MenuSeparator />
			{row.pullRequests.map(pr => (
				<MenuLinkItem key={pullRequestUrl(pr)} href={pullRequestUrl(pr)} target="_blank" rel="noreferrer">
					<GitPullRequest />
					Open {pr.repo}#{pr.number}
				</MenuLinkItem>
			))}
			{row.tickets.map(id => (
				<MenuLinkItem key={id} href={hashForTickets(id)}>
					<PAGE_ICON.tickets />
					Open {id}
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
	/** All projects are listed, so a titled row names its project. */
	showProject: boolean;
	/** Pin the session, or unpin it when it is pinned. */
	onTogglePin: (sessionId: string) => void;
}

/** A past session's row, with Resume, and Move to past while it is interrupted. */
export const PastRow = memo(function PastRow({ session, pinned, open, showProject, onTogglePin }: RowProps<PastSession>) {
	const { open: onOpen, send, start, starts } = useDashboardContext();
	const { resume } = starts;
	const view: View = { kind: "past", sessionId: session.sessionId };
	const label = pastLabel(session);
	return (
		<RowMenu
			view={view}
			label={label}
			isOpen={open}
			onOpen={onOpen}
			items={
				<>
					{/* One resume runs at a time, as the pane's Resume button allows. */}
					<MenuItem
						disabled={resume?.phase === "starting"}
						onClick={() => {
							// The pane shows the resume's progress and failure, and the live session takes it over.
							onOpen(view, "replace");
							start({ kind: "resume", sessionId: session.sessionId });
						}}
					>
						<Play />
						{resume?.phase === "starting" && resume.op.sessionId === session.sessionId ? "Resuming…" : "Resume"}
					</MenuItem>
					{session.interrupted && (
						<MenuItem onClick={() => send({ t: "dismiss-interrupted", sessionId: session.sessionId })}>
							<Archive />
							Move to past
						</MenuItem>
					)}
					<SessionItems row={session} pinned={pinned} onTogglePin={onTogglePin} />
				</>
			}
		>
			<SessionButton
				view={view}
				label={label}
				title={`${session.cwd}\nlast active ${new Date(session.modifiedAt).toLocaleString()}`}
				badge={showProject && session.title !== null ? <ProjectBadge cwdDisplay={session.cwdDisplay} /> : null}
				ship={session.ship}
				facts={sessionFacts([pinned && session.interrupted && "interrupted", session.pullRequests.length > 0 && pullRequestsLabel(session.pullRequests)], session.pullRequests)}
				when={session.modifiedAt}
				open={open}
				onOpen={onOpen}
			/>
		</RowMenu>
	);
});

/** A running session's row, with its status dot, and End session where the server controls it. */
export const HostRow = memo(function HostRow({ session: host, pinned, open, showProject, onTogglePin }: RowProps<RosterHost>) {
	const { open: onOpen, end } = useDashboardContext();
	const view: View = { kind: "live", instanceId: host.instanceId, agentId: null };
	const label = hostLabel(host);
	return (
		<RowMenu
			view={view}
			label={label}
			isOpen={open}
			onOpen={onOpen}
			items={
				<>
					<SessionItems row={host} pinned={pinned} onTogglePin={onTogglePin} />
					{/* The server ends only what it controls: a dashboard session, or a terminal room shared writable. */}
					{host.control.phase === "live" && !host.control.readOnly && (
						<>
							<MenuSeparator />
							<MenuItem variant="destructive" onClick={() => end(host.instanceId)}>
								<CircleStop />
								End session
							</MenuItem>
						</>
					)}
				</>
			}
		>
			<SessionButton
				view={view}
				label={label}
				title={`${statusLabel(host.status)}\n${host.cwd}\npid ${host.pid} · ${host.source === "terminal" ? `${host.participants} participants${host.relayConnected ? "" : " · relay offline"}` : "started here"}`}
				badge={showProject && host.sessionName !== null ? <ProjectBadge cwdDisplay={host.cwdDisplay} /> : null}
				ship={host.ship}
				facts={sessionFacts([host.source === "terminal" && !host.relayConnected && "relay offline", host.pullRequests.length > 0 && pullRequestsLabel(host.pullRequests)], host.pullRequests)}
				when={host.startedAt}
				dot={<StatusDot status={host.status} />}
				open={open}
				onOpen={onOpen}
			/>
		</RowMenu>
	);
});
