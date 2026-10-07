import { AppWindow, Archive, CircleStop, Columns2, Copy, Folder, GitPullRequest, Pin, PinOff, Play, Settings } from "lucide-react";
import { pullRequestUrl } from "../src/shared/github";
import type { PastSession, RosterHost, View } from "../src/shared/sessions";
import type { ActionGroup, ActionRun } from "./command-palette";
import { PAGE_ICON } from "./page-icons";
import { hashForSettings, hashForTickets, type OpenMode } from "./routing";

/** A session as a row lists it: running, or past. */
export type SessionEntry = { kind: "live"; host: RosterHost } | { kind: "past"; session: PastSession };

/** How a session action runs; none pushes a palette view, since a row's menu runs them too. */
export type SessionRun = Exclude<ActionRun, { kind: "push" }>;

export interface SessionActionContext {
	/** The session shows in a pane, which leaves out Open in split. */
	onScreen: boolean;
	pinned: boolean;
	/** The session a resume is starting for, or `null`. One resume runs at a time, as the pane's Resume button allows. */
	resuming: string | null;
	open: (view: View, mode: OpenMode) => void;
	togglePin: (sessionId: string) => void;
	/** Start resuming past session `sessionId`. */
	resume: (sessionId: string) => void;
	/** Move interrupted session `sessionId` to the past sessions. */
	dismissInterrupted: (sessionId: string) => void;
	end: (instanceId: string) => void;
}

export const viewOf = (entry: SessionEntry): View =>
	entry.kind === "live" ? { kind: "live", instanceId: entry.host.instanceId, agentId: null } : { kind: "past", sessionId: entry.session.sessionId };

/**
 * What a session's row menu and the command palette offer for it, in groups a separator sets apart. Open comes first,
 * so Enter runs it in the palette, and Open in split second, for ⌘Enter. The server ends only what it controls: a
 * dashboard session, or a terminal room shared writable.
 */
export function sessionActions(entry: SessionEntry, context: SessionActionContext): [ActionGroup<SessionRun>, ...ActionGroup<SessionRun>[]] {
	const row = entry.kind === "live" ? entry.host : entry.session;
	const { sessionId } = row;
	const view = viewOf(entry);
	const resuming = context.resuming === sessionId;
	const opening: ActionGroup<SessionRun> = [
		{ id: "open", title: "Open", icon: AppWindow, run: { kind: "do", fn: () => context.open(view, "replace") } },
		...(context.onScreen ? [] : [{ id: "split", title: "Open in split", icon: Columns2, run: { kind: "do", fn: () => context.open(view, "split") } } as const]),
		...(entry.kind === "past"
			? [
					{
						id: "resume",
						title: resuming ? "Resuming…" : "Resume",
						icon: Play,
						disabled: context.resuming !== null,
						run: {
							kind: "do",
							fn: () => {
								// The pane shows the resume's progress and failure, and the live session takes it over.
								context.open(view, "replace");
								context.resume(sessionId);
							},
						},
					} as const,
				]
			: []),
		...(entry.kind === "past" && entry.session.interrupted
			? [{ id: "dismiss", title: "Move to past", icon: Archive, run: { kind: "do", fn: () => context.dismissInterrupted(sessionId) } } as const]
			: []),
		{
			id: "pin",
			title: context.pinned ? "Unpin" : "Pin",
			icon: context.pinned ? PinOff : Pin,
			chord: { key: "p", mod: true, shift: true },
			run: { kind: "do", fn: () => context.togglePin(sessionId) },
		},
	];
	const links: ActionGroup<SessionRun> = [
		...row.pullRequests.map(pr => ({
			id: `pr:${pullRequestUrl(pr)}`,
			title: `Open ${pr.repo}#${pr.number}`,
			icon: GitPullRequest,
			run: { kind: "link", href: pullRequestUrl(pr), external: true } as const,
		})),
		...row.tickets.map(id => ({ id: `ticket:${id}`, title: `Open ${id}`, icon: PAGE_ICON.tickets, run: { kind: "link", href: hashForTickets(id) } as const })),
		{ id: "settings", title: "Workspace settings", icon: Settings, run: { kind: "link", href: hashForSettings(row.cwd) } },
	];
	const copies: ActionGroup<SessionRun> = [
		{ id: "copy-path", title: "Copy path", icon: Folder, chord: { key: "c", mod: true, shift: true }, run: { kind: "do", fn: () => void navigator.clipboard.writeText(row.cwd) } },
		{ id: "copy-id", title: "Copy session ID", icon: Copy, run: { kind: "do", fn: () => void navigator.clipboard.writeText(sessionId) } },
	];
	if (entry.kind === "past" || entry.host.control.phase !== "live" || entry.host.control.readOnly) return [opening, links, copies];
	const { instanceId } = entry.host;
	return [
		opening,
		links,
		copies,
		[{ id: "end", title: "End session", icon: CircleStop, tone: "destructive", chord: { key: "x", mod: true, shift: true }, run: { kind: "do", fn: () => context.end(instanceId) } }],
	];
}
