/** The URL hash: which page and which panes are open, and the pure changes to them. */
import type { PullRequest, RosterHost, View } from "../src/shared";

const PAST_PREFIX = "past/";
const SETTINGS = "settings";
const INBOX = "inbox";
const SESSION_PREFIX = "session/";
const NEW = "new";

/** The inbox page, and the pull request whose row it scrolls to and highlights; `null` for none. */
export interface InboxRoute {
	target: PullRequest | null;
}

/**
 * `#inbox` opens the inbox page, which lists the pull requests of the sidebar's project, and
 * `#inbox/<owner>/<repo>/<number>` opens it at that pull request's row. Any other `#inbox/…` opens the page alone.
 */
export function inboxFromHash(hash: string): InboxRoute | null {
	const raw = hash.replace(/^#/, "");
	if (raw !== INBOX && !raw.startsWith(`${INBOX}/`)) return null;
	const match = /^inbox\/([\w.-]+)\/([\w.-]+)\/(\d+)$/.exec(raw);
	return { target: match ? { owner: match[1]!, repo: match[2]!, number: Number(match[3]) } : null };
}

export const hashForInbox = (target: PullRequest | null): string =>
	target ? `#${INBOX}/${target.owner}/${target.repo}/${target.number}` : `#${INBOX}`;

/** `#session/<id>` names a session by its id, which outlives the host running it, for links from outside the page. */
export function sessionFromHash(hash: string): string | null {
	const raw = hash.replace(/^#/, "");
	return raw.startsWith(SESSION_PREFIX) && raw.length > SESSION_PREFIX.length ? decodeURIComponent(raw.slice(SESSION_PREFIX.length)) : null;
}

/** The view a session id opens: the live host that runs the session, else its saved transcript. */
export function viewForSession(sessionId: string, hosts: RosterHost[]): View {
	const host = hosts.find(h => h.sessionId === sessionId);
	return host ? { kind: "live", instanceId: host.instanceId, agentId: null } : { kind: "past", sessionId };
}

/** Where the settings page reads project files and config from; `null` for user-level only. */
export interface SettingsRoute {
	cwd: string | null;
}

/** `#settings` opens the settings page, `#settings/<cwd>` with that workspace's project files and config. */
export function settingsFromHash(hash: string): SettingsRoute | null {
	const raw = hash.replace(/^#/, "");
	if (raw === SETTINGS) return { cwd: null };
	return raw.startsWith(`${SETTINGS}/`) ? { cwd: decodeURIComponent(raw.slice(SETTINGS.length + 1)) } : null;
}

export const hashForSettings = (cwd: string | null): string =>
	cwd === null ? `#${SETTINGS}` : `#${SETTINGS}/${encodeURIComponent(cwd)}`;

/** The directory a new session starts in, as typed or displayed (`~/code/webapp`); `null` for {@link defaultCwd}. */
export interface NewSessionRoute {
	cwd: string | null;
}

/** `#new` opens the new-session draft, `#new/<cwd>` with that directory chosen. No omp runs until its first message. */
export function newSessionFromHash(hash: string): NewSessionRoute | null {
	const raw = hash.replace(/^#/, "");
	if (raw === NEW) return { cwd: null };
	return raw.startsWith(`${NEW}/`) ? { cwd: decodeURIComponent(raw.slice(NEW.length + 1)) } : null;
}

export const hashForNewSession = (cwd: string | null): string => (cwd === null ? `#${NEW}` : `#${NEW}/${encodeURIComponent(cwd)}`);

/** Panes the page splits into at most, as a 2x2 grid. */
export const MAX_PANES = 4;

/** The views on screen in grid order, and the focused one that plain clicks, new sessions, and forks open into. */
export interface Layout {
	/** Distinct views, at most {@link MAX_PANES}. */
	panes: View[];
	/** Index into `panes`; 0 when there are none. */
	focus: number;
	/** The focused pane fills the page with the others kept behind it; only ever true with 2+ panes. */
	maximized: boolean;
}

export const EMPTY_LAYOUT: Layout = { panes: [], focus: 0, maximized: false };

export const focusedView = (layout: Layout): View | null => layout.panes[layout.focus] ?? null;

/** `<instanceId>` for a live session, `<instanceId>/<agentId>` for one of its subagents, `past/<sessionId>` for a past session. */
function paneForView(view: View): string {
	if (view.kind === "past") return `${PAST_PREFIX}${encodeURIComponent(view.sessionId)}`;
	const session = encodeURIComponent(view.instanceId);
	return view.agentId === null ? session : `${session}/${encodeURIComponent(view.agentId)}`;
}

/** Instance ids are hex, so none reads as `past`, `settings`, `inbox`, `session`, or `new`. */
function viewFromPane(pane: string): View {
	if (pane.startsWith(PAST_PREFIX)) return { kind: "past", sessionId: decodeURIComponent(pane.slice(PAST_PREFIX.length)) };
	const slash = pane.indexOf("/");
	if (slash < 0) return { kind: "live", instanceId: decodeURIComponent(pane), agentId: null };
	return {
		kind: "live",
		instanceId: decodeURIComponent(pane.slice(0, slash)),
		agentId: decodeURIComponent(pane.slice(slash + 1)),
	};
}

export const hashForView = (view: View): string => `#${paneForView(view)}`;

export const sameView = (a: View | null, b: View | null): boolean =>
	(a && paneForView(a)) === (b && paneForView(b));

const MAXIMIZED = ";max";

/**
 * `#<pane>` for one pane, so single-view links from before split screen still open; `#<pane>,<pane>…@<focus>`
 * for more, with `@<focus>` left out when the first pane has focus, then `;max` when the focused pane is maximized.
 * Encoded ids hold no `,`, `@`, or `;`.
 */
export function hashForLayout({ panes, focus, maximized }: Layout): string {
	if (panes.length === 0) return "";
	return `#${panes.map(paneForView).join(",")}${focus > 0 ? `@${focus}` : ""}${maximized ? MAXIMIZED : ""}`;
}

/**
 * The layout a hash names, keeping the first {@link MAX_PANES} distinct views and focus on the view it named.
 * `null` for the settings, inbox, and new-session pages, which leave the panes behind them alone, and for a
 * `#session/<id>` link, which names no layout until the session lists show where that session runs.
 */
export function layoutFromHash(hash: string): Layout | null {
	if (settingsFromHash(hash) || inboxFromHash(hash) || newSessionFromHash(hash) || sessionFromHash(hash) !== null) return null;
	const marked = hash.replace(/^#/, "");
	const maximized = marked.endsWith(MAXIMIZED);
	const raw = maximized ? marked.slice(0, -MAXIMIZED.length) : marked;
	const at = raw.lastIndexOf("@");
	const named = (at < 0 ? raw : raw.slice(0, at)).split(",").filter(Boolean).map(viewFromPane);
	const focused = named[at < 0 ? 0 : Number(raw.slice(at + 1))] ?? named[0];
	const panes = named.filter((view, index) => named.findIndex(other => sameView(other, view)) === index).slice(0, MAX_PANES);
	return {
		panes,
		focus: Math.max(0, panes.findIndex(view => sameView(view, focused ?? null))),
		maximized: maximized && panes.length > 1,
	};
}

export type OpenMode = "replace" | "split";

/**
 * `view` in the focused pane, or in a new pane for `split`. A view already open gets focus instead of a second pane;
 * a split with {@link MAX_PANES} open replaces the focused pane. A plain open keeps a maximized pane maximized,
 * now showing the opened view; a split brings the split back.
 */
export function openView(layout: Layout, view: View, mode: OpenMode): Layout {
	const { panes, focus } = layout;
	const maximized = layout.maximized && mode === "replace";
	const open = panes.findIndex(pane => sameView(pane, view));
	if (open >= 0) return { panes, focus: open, maximized };
	if (panes.length === 0) return { panes: [view], focus: 0, maximized: false };
	if (mode === "split" && panes.length < MAX_PANES) return { panes: [...panes, view], focus: panes.length, maximized: false };
	return { panes: panes.with(focus, view), focus, maximized };
}

/**
 * The layout without pane `index`. Focus stays on its view, or moves to the pane taking the closed one's place.
 * Closing the maximized pane, or leaving one pane, brings the split back.
 */
export function closePane({ panes, focus, maximized }: Layout, index: number): Layout {
	const rest = panes.filter((_, i) => i !== index);
	return {
		panes: rest,
		focus: index < focus ? focus - 1 : Math.max(0, Math.min(focus, rest.length - 1)),
		maximized: maximized && index !== focus && rest.length > 1,
	};
}

/** The pane showing `from` shows `to` instead and takes focus; without such a pane, `to` opens in the focused pane. */
export function swapView(layout: Layout, from: View, to: View): Layout {
	const index = layout.panes.findIndex(pane => sameView(pane, from));
	if (index < 0) return openView(layout, to, "replace");
	return { ...layout, panes: layout.panes.with(index, to), focus: index };
}

/**
 * The layout once live session `instanceId` ends. Each pane showing it, or one of its subagents, shows the next
 * session in `listed` (the sidebar's running sessions, in order), else the previous, skipping sessions already open.
 * A pane left without one keeps the ended session.
 */
export function endSession(layout: Layout, instanceId: string, listed: string[]): Layout {
	const at = listed.indexOf(instanceId);
	if (at < 0) return layout;
	const neighbors = [...listed.slice(at + 1), ...listed.slice(0, at).reverse()]
		.map((id): View => ({ kind: "live", instanceId: id, agentId: null }))
		.filter(view => !layout.panes.some(pane => sameView(pane, view)));
	const panes = layout.panes.map(pane => (pane.kind === "live" && pane.instanceId === instanceId ? (neighbors.shift() ?? pane) : pane));
	return { ...layout, panes };
}

/**
 * The view `step` rows from the focused view's session in `listed` (the sidebar's sessions, in order), or `null` past
 * either end. A subagent stands for its session's row, and a view the sidebar does not list steps onto its first or last row.
 */
export function adjacentSession(listed: View[], current: View | null, step: 1 | -1): View | null {
	const row = current?.kind === "live" ? { ...current, agentId: null } : current;
	const at = listed.findIndex(view => sameView(view, row));
	if (at < 0) return (step > 0 ? listed[0] : listed.at(-1)) ?? null;
	return listed[at + step] ?? null;
}

/** Whether the hash names a page that covers the panes: settings, inbox, or the new-session draft. */
export const isPageHash = (hash: string): boolean => settingsFromHash(hash) !== null || inboxFromHash(hash) !== null || newSessionFromHash(hash) !== null;
