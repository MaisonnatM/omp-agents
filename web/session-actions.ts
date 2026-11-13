import { IconArchive, IconFolder1, IconLayoutColumn, IconPin, IconPlay, IconPullRequest, IconSettingsGear1, IconSquareBehindSquare1, IconUnpin, IconWindowApp } from "central-icons";
import { pullRequestUrl } from "../src/shared/github";
import type { PastSession, RosterHost, View } from "../src/shared/sessions";
import type { ActionGroup, ActionRun } from "./command-palette";
import { CONFIRM_PRIVATE_END } from "./labels";
import { PAGE_ICON } from "./page-icons";
import { hashForTickets, type OpenMode } from "./routing";
import { isPrivateHost } from "./sessions";

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
	/** This live session is waiting for the server to finish ending it. */
	ending: boolean;
	open: (view: View, mode: OpenMode) => void;
	togglePin: (sessionId: string) => void;
	/** Start resuming past session `sessionId`. */
	resume: (sessionId: string) => void;
	/** Move interrupted session `sessionId` to the past sessions. */
	dismissInterrupted: (sessionId: string) => void;
	end: (instanceId: string) => void;
	/** Open the session's workspace in Settings, or `null` when the sidebar cannot pick that workspace. */
	workspaceSettings: (() => void) | null;
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
		{ id: "open", title: "Open", icon: IconWindowApp, run: { kind: "do", fn: () => context.open(view, "replace") } },
		...(context.onScreen ? [] : [{ id: "split", title: "Open in split", icon: IconLayoutColumn, run: { kind: "do", fn: () => context.open(view, "split") } } as const]),
		...(entry.kind === "past" && entry.session.source === "omp"
			? [
					{
						id: "resume",
						title: resuming ? "Resuming…" : "Resume",
						icon: IconPlay,
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
			? [{ id: "dismiss", title: "Move to past", icon: IconArchive, run: { kind: "do", fn: () => context.dismissInterrupted(sessionId) } } as const]
			: []),
		{
			id: "pin",
			title: context.pinned ? "Unpin" : "Pin",
			icon: context.pinned ? IconUnpin : IconPin,
			chord: { key: "p", mod: true, shift: true },
			run: { kind: "do", fn: () => context.togglePin(sessionId) },
		},
	];
	const links: ActionGroup<SessionRun> = [
		...row.pullRequests.map(pr => ({
			id: `pr:${pullRequestUrl(pr)}`,
			title: `Open ${pr.repo}#${pr.number}`,
			icon: IconPullRequest,
			run: { kind: "link", href: pullRequestUrl(pr), external: true } as const,
		})),
		...row.tickets.map(id => ({ id: `ticket:${id}`, title: `Open ${id}`, icon: PAGE_ICON.tickets, run: { kind: "link", href: hashForTickets(id) } as const })),
		...(context.workspaceSettings ? [{ id: "settings", title: "Workspace settings", icon: IconSettingsGear1, run: { kind: "do", fn: context.workspaceSettings } } as const] : []),
	];
	const copies: ActionGroup<SessionRun> = [
		{ id: "copy-path", title: "Copy path", icon: IconFolder1, chord: { key: "c", mod: true, shift: true }, run: { kind: "do", fn: () => void navigator.clipboard.writeText(row.cwd) } },
		{ id: "copy-id", title: "Copy session ID", icon: IconSquareBehindSquare1, run: { kind: "do", fn: () => void navigator.clipboard.writeText(sessionId) } },
	];
	if (entry.kind === "past" || entry.host.control.phase !== "live" || entry.host.control.readOnly) return [opening, links, copies];
	const { instanceId } = entry.host;
	return [
		opening,
		links,
		copies,
		[
			{
				id: "end",
				title: context.ending ? "Archiving…" : "Archive session",
				icon: IconArchive,
				disabled: context.ending,
				tone: "destructive",
				...(isPrivateHost(entry.host) ? { confirm: CONFIRM_PRIVATE_END } : {}),
				run: { kind: "do", fn: () => context.end(instanceId) },
			},
		],
	];
}
