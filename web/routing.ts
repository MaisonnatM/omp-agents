/** The URL hash: which page and which panes are open, and the pure changes to them. */
import { IconAgentNetwork, IconAiBotHead, IconArrowRotateCounterClockwise, IconBlocks, IconBrain, IconBranch, IconChart3, IconCursorClick, IconDirection1, IconFileText, IconFolders, IconKey1, IconKeyboard, IconLaw, IconMerged, IconPhone, IconPlugin1, IconSettingsSliderHor, IconSparklesTwo, IconStorage, IconWidgets } from "central-icons";
import type { IconComponent } from "@/lib/icon-context";
import type { PullRequest } from "../src/shared/github";
import { hashForSession, type LiveView, type RosterHost, SESSION_HASH_PREFIX, type View } from "../src/shared/sessions";
import type { StartOp } from "./starts";
import { decodeSegment } from "./hash-segment";
import { PAGE_ICON } from "./page-icons";
import { isModulePage, isWebModuleId, MODULE_LIST, type ModulePage, moduleOf, modulePage, type PageAddresses, type WebModuleId } from "./modules";
import type { RoutineRoute } from "./components/board/module";

/** A sidebar tab's row: its label, its icon, and its `place` among the tabs, lowest first. */
export interface SidebarTabRow {
	value: SidebarTab;
	label: string;
	icon: IconComponent;
	place: number;
}

/** The core's tabs, which the modules' tabs join by `place`. */
const CORE_TABS = [
	{ value: "pull-requests", label: "Pull requests", icon: PAGE_ICON["pull-requests"], place: 10 },
] as const satisfies readonly { value: string; label: string; icon: IconComponent; place: number }[];

/**
 * The sidebar's tabs, in order, each a row of its page list. Settings is no tab: the row after them and the header's
 * button open it.
 */
export const SIDEBAR_TABS: readonly SidebarTabRow[] = [...CORE_TABS, ...MODULE_LIST.map(({ id, tab }) => ({ value: id, ...tab }))].sort((a, b) => a.place - b.place);

/** A sidebar tab, a row of the sidebar's page list; the module tabs go with their pages, the sessions and pull requests tabs with the panes. */
export type SidebarTab = (typeof CORE_TABS)[number]["value"] | WebModuleId;

const PAST_PREFIX = "past/";

/**
 * The pull request the Pull requests page shows: its details, or with `files` its changes page open
 * on the file at `path`, `null` for the first. A `null` target keeps the panes.
 */
export type PullRequestsRoute = { target: null } | { target: PullRequest; files: { path: string | null } | null };

/** What a workspace section's header says it shows: `workspace` with a workspace picked, `none` with all workspaces. */
const AS_LOADED = { workspace: "As a session in this workspace loads them", none: "Your user files only, for all workspaces" };

/** The settings sidebar's labelled groups, in its order. */
export const SETTINGS_GROUPS = [
	{ value: "usage", label: "Usage" },
	{ value: "general", label: "General" },
	{ value: "connections", label: "Connections" },
	{ value: "workspace", label: "This workspace" },
] as const;

export type SettingsGroup = (typeof SETTINGS_GROUPS)[number]["value"];

/** Each settings sidebar group's label. */
export const SETTINGS_GROUP_LABEL = Object.fromEntries(SETTINGS_GROUPS.map(group => [group.value, group.label])) as Record<SettingsGroup, string>;

/**
 * The settings page's sections, in the sidebar's order, each in the `group` that lists it, with `keywords` the command
 * menu also finds it by. A `workspace` section shows omp's files and config as a session in the chosen workspace loads
 * them, and its header says so in `meta`; a section of any other group is the same whatever the workspace.
 */
export const SETTINGS_SECTIONS = [
	{ value: "analytics", label: "Analytics", icon: IconChart3, group: "usage", keywords: ["usage", "cost", "tokens", "spend"] },
	{ value: "activity", label: "Activity", icon: IconCursorClick, group: "usage", keywords: ["features", "used", "time"] },
	{ value: "preferences", label: "Preferences", icon: IconSettingsSliderHor, group: "general", keywords: ["theme", "dark mode", "notifications", "sound", "sidebar tabs", "transcript", "idle processes", "idle sessions"] },
	{ value: "keyboard", label: "Keyboard", icon: IconKeyboard, group: "general", keywords: ["shortcuts", "keys", "hotkeys", "keybindings"] },
	{ value: "modules", label: "Modules", icon: IconWidgets, group: "general", keywords: [...MODULE_LIST.map(({ tab }) => tab.label.toLowerCase()), "turn off", "enable", "disable", "add", "new"] },
	{ value: "workspaces", label: "Workspaces", icon: IconFolders, group: "general", keywords: ["directories", "folders", "hide"] },
	{ value: "sync", label: "Sync", icon: IconArrowRotateCounterClockwise, group: "general", keywords: ["git", "remote", "machines"] },
	{ value: "phone", label: "Phone access", icon: IconPhone, group: "general", keywords: ["tailscale", "mobile", "pair", "qr"] },
	{ value: "storage", label: "Storage", icon: IconStorage, group: "general", keywords: ["disk", "space", "gc", "cleanup", "archive", "compress", "sandboxes"] },
	{ value: "whats-new", label: "What's new", icon: IconSparklesTwo, group: "general", keywords: ["changelog", "update", "release notes"] },
	{ value: "providers", label: "Providers", icon: IconKey1, group: "connections", keywords: ["login", "sign in", "accounts", "api key", "quota"] },
	{ value: "integrations", label: "Integrations", icon: IconPlugin1, group: "connections", keywords: ["slack", "github", "connect"] },
	{ value: "mcp-servers", label: "MCP servers", icon: IconBlocks, group: "connections", keywords: ["mcp", "tools"] },
	{ value: "source-control", label: "Source control", icon: IconMerged, group: "connections", keywords: ["github", "gh", "pull", "merge"] },
	{ value: "models", label: "Models", icon: IconDirection1, group: "workspace", keywords: ["roles", "fallback", "retry"], meta: AS_LOADED },
	{ value: "agents", label: "Agents", icon: IconAiBotHead, group: "workspace", keywords: ["subagents", "delegation", "concurrency", "isolation"], meta: { workspace: "Preview of a new session in this workspace", none: "Preview of a new session with user defaults only" } },
	{ value: "omp", label: "omp settings", icon: IconSettingsSliderHor, group: "workspace", keywords: ["config", "thinking", "compaction", "advisor", "bash", "lsp", "tools"], meta: AS_LOADED },
	{ value: "omp-memory", label: "omp memory", icon: IconBrain, group: "workspace", keywords: ["memory", "remember", "recall", "auto-learn", "mnemopi", "hindsight", "sharpshooter"], meta: { ...AS_LOADED, none: "Your user settings only; memory is kept per workspace" } },
	{ value: "files", label: "Files", icon: IconFileText, group: "workspace", keywords: ["AGENTS.md", "config", "skills", "rules"], meta: AS_LOADED },
	{ value: "extensions", label: "Extensions", icon: IconBlocks, group: "workspace", meta: { none: "Packages installed for your user, all workspaces", workspace: "As a session in this workspace discovers them" }, keywords: ["plugins", "marketplaces", "registry skills", "contributions", "install"] },
	{ value: "workflows", label: "Workflows", icon: IconAgentNetwork, group: "workspace", keywords: ["workflow"], meta: { ...AS_LOADED, none: "Your user skills only, for all workspaces" } },
	{ value: "decisions", label: "Decisions", icon: IconLaw, group: "workspace", keywords: ["records", "adr"], meta: { workspace: "The repository's decision records, read-only", none: "Every workspace, grouped by workspace" } },
	{ value: "worktrees", label: "Worktrees", icon: IconBranch, group: "workspace", keywords: ["branches", "cleanup"], meta: AS_LOADED },
] as const satisfies readonly { value: string; label: string; icon: IconComponent; group: SettingsGroup; keywords: readonly string[]; meta?: { workspace: string; none: string } }[];

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["value"];

/** The settings section `segment` names, else Analytics, which bare `#settings`, an unknown section, and nothing remembered open. */
export const settingsSection = (segment: string | null): SettingsSection => SETTINGS_SECTIONS.find(({ value }) => value === segment)?.value ?? "analytics";

/** The sections that read one workspace, as a Board's Settings tab lists them. */
export const WORKSPACE_SECTIONS = SETTINGS_SECTIONS.filter(section => section.group === "workspace");

/** The workspace section `segment` names, else the first. */
export const workspaceSection = (segment: string | null): SettingsSection => WORKSPACE_SECTIONS.find(({ value }) => value === segment)?.value ?? WORKSPACE_SECTIONS[0]!.value;

/** The settings sidebar's groups holding a section whose label or a keyword contains `query`, ignoring case, each with those sections in the sidebar's order; `phone` drops Phone access, which a paired phone does not list. */
export const settingsMatching = (query: string, { phone }: { phone: boolean }) => {
	const needle = query.trim().toLowerCase();
	const sections = SETTINGS_SECTIONS.filter(
		entry => !(phone && entry.value === "phone") && (!needle || [entry.label, ...entry.keywords].some(text => text.toLowerCase().includes(needle))),
	);
	return SETTINGS_GROUPS.map(group => ({ group, entries: sections.filter(entry => entry.group === group.value) })).filter(({ entries }) => entries.length > 0);
};

/** The open section of the settings page; its workspace sections read the sidebar's workspace. */
export interface SettingsRoute {
	section: SettingsSection;
}

/** The directory a new session starts in, as typed or displayed (`~/code/webapp`); `null` for {@link defaultCwd}. */
export interface NewSessionRoute {
	cwd: string | null;
	/** The project the session joins as it starts; `null` for none. */
	projectId: string | null;
}

/** A scheduled new session's start, `id` of the scheduled sends, opened to view and edit; `null` names none. */
export interface ScheduledRoute {
	id: string | null;
}

/** A page of the core that covers the panes. */
export type CorePage =
	| { kind: "get-started" }
	| ({ kind: "settings" } & SettingsRoute)
	| ({ kind: "pull-requests" } & PullRequestsRoute)
	| { kind: "notifications" }
	| ({ kind: "new" } & NewSessionRoute)
	| ({ kind: "scheduled" } & ScheduledRoute);

/** A page that covers the panes: the core's, or a module's. */
export type Page = CorePage | ModulePage;

/** What the hash names: a page over the panes, a session by its id, or the panes themselves. */
export type Route = { kind: "page"; page: Page } | { kind: "session"; sessionId: string } | { kind: "panes"; layout: Layout };

type PageOf<K extends CorePage["kind"]> = Extract<CorePage, { kind: K }>;

/** The settings page and the new-session draft both name an optional directory, encoded so it keeps its slashes and tilde. */
const decodeCwd = (rest: string | null): string | null => (rest === null ? null : decodeSegment(rest));
const encodeCwd = (cwd: string | null): string | null => (cwd === null ? null : encodeURIComponent(cwd));

/**
 * Each page by its kind, which is its hash's first segment, reading what follows the next `/` (`null` without one) and
 * what follows a `?` after it.
 * - `#settings/<section>` opens that section of the settings page, whose workspace sections follow the sidebar's workspace.
 *   `#settings` and an unknown section open Analytics; a segment after the section is ignored.
 * - `#new` opens the new-session draft, `#new/<cwd>` with that directory chosen, and `?project=<id>` joining the session to
 *   that project as it starts. No omp runs until its first message.
 * - `#scheduled/<id>` opens scheduled send `id`, a new session's start, as an editable draft.
 * - `#pull-requests` shows the sidebar's Pull requests tab, which lists the pull requests of the sidebar's workspace, beside the panes,
 *   and `#pull-requests/<owner>/<repo>/<number>` shows that pull request's details in the main content.
 *   `#pull-requests/<owner>/<repo>/<number>/files` opens its changes page on the first file, and `…/files/<path>` on the file
 *   at that encoded path. Any other `#pull-requests/…` shows the tab alone.
 * - `#notifications` opens the Notifications page, every notice by source, unread first.
 * - A module's page, `#<id>`, reads the rest of its hash as its module's address does.
 */
const PAGES: { [K in CorePage["kind"]]: (rest: string | null, query: URLSearchParams) => PageOf<K> } = {
	"get-started": () => ({ kind: "get-started" }),
	settings: rest => ({ kind: "settings", section: settingsSection(rest?.split("/")[0] ?? null) }),
	new: (rest, query) => ({ kind: "new", cwd: decodeCwd(rest), projectId: query.get("project") || null }),
	scheduled: rest => ({ kind: "scheduled", id: rest ? decodeSegment(rest) : null }),
	"pull-requests": rest => {
		const match = rest === null ? null : /^([\w.-]+)\/([\w.-]+)\/(\d+)(\/files(?:\/(.+))?)?$/.exec(rest);
		if (!match) return { kind: "pull-requests", target: null };
		const files = match[4] ? { path: match[5] ? decodeSegment(match[5]) : null } : null;
		return { kind: "pull-requests", target: { owner: match[1]!, repo: match[2]!, number: Number(match[3]) }, files };
	},
	notifications: () => ({ kind: "notifications" }),
};

const isPageKind = (head: string): head is CorePage["kind"] => Object.hasOwn(PAGES, head);

/** What follows `#<kind>/` in `page`'s hash; `null` for the page alone. */
function restOfPage(page: CorePage): string | null {
	switch (page.kind) {
		case "settings":
			return page.section;
		case "new":
			return encodeCwd(page.cwd);
		case "pull-requests": {
			if (page.target === null) return null;
			const pr = `${page.target.owner}/${page.target.repo}/${page.target.number}`;
			if (page.files === null) return pr;
			return page.files.path === null ? `${pr}/files` : `${pr}/files/${encodeURIComponent(page.files.path)}`;
		}
		case "scheduled":
			return page.id === null ? null : encodeURIComponent(page.id);
		case "notifications":
		case "get-started":
			return null;
		default: {
			const never: never = page;
			return never;
		}
	}
}

/** The `?name=value` that follows `page`'s path: the project a new session starts with; `null` for none. */
function queryOfPage(page: CorePage): string | null {
	switch (page.kind) {
		case "new": {
			const query = new URLSearchParams();
			if (page.projectId !== null) query.set("project", page.projectId);
			return query.size === 0 ? null : query.toString();
		}
		case "settings":
		case "pull-requests":
		case "notifications":
		case "get-started":
		case "scheduled":
			return null;
		default: {
			const never: never = page;
			return never;
		}
	}
}

/** The page addresses a module's address may hold. */
const PAGE_ADDRESSES: PageAddresses = {
	page: hash => {
		const route = routeFromHash(hash);
		return route.kind === "page" ? route.page : null;
	},
	hash: page => hashForPage(page),
};

export function hashForPage(page: Page): string {
	const rest = isModulePage(page) ? moduleOf(page).address.rest(page, PAGE_ADDRESSES) : restOfPage(page);
	const query = isModulePage(page) ? moduleOf(page).address.query(page) : queryOfPage(page);
	return `#${page.kind}${rest === null ? "" : `/${rest}`}${query === null ? "" : `?${query}`}`;
}

/** How a link names a page: {@link hashForPage}, or, inside a Board's Workspace tab, that tab's address for the same page, which `usePageHash` in `web/page-hash.ts` reads. */
export type PageHash = (page: Page) => string;

export const hashForPullRequests = (target: PullRequest | null, to: PageHash = hashForPage): string => to(target ? { kind: "pull-requests", target, files: null } : { kind: "pull-requests", target: null });
export const hashForPullRequestFiles = (pr: PullRequest, path: string | null = null, to: PageHash = hashForPage): string => to({ kind: "pull-requests", target: pr, files: { path } });
/** Workspace `workspace`'s Routines tab, showing what `routine` names. */
export const hashForRoutines = (workspace: string, routine: RoutineRoute = { kind: "list" }): string =>
	hashForPage({ kind: "board", workspace, view: { tab: "routines", routine }, search: null, reply: null });
export const hashForNotifications = (): string => hashForPage({ kind: "notifications" });
export const hashForSettings = (section: SettingsSection): string => hashForPage({ kind: "settings", section });
export const hashForNewSession = ({ cwd = null, projectId = null }: Partial<NewSessionRoute> = {}): string => hashForPage({ kind: "new", cwd, projectId });
export const hashForScheduled = (id: string): string => hashForPage({ kind: "scheduled", id });
export const hashForProject = (open: string | null, to: PageHash = hashForPage): string => to({ kind: "projects", open });

/**
 * The route a hash names. A page's kind is its first segment. `#session/<id>` names a session by its id, which outlives
 * the host running it, for links from outside the page; it names no layout until the session lists show where that
 * session runs. Any other hash names the panes.
 */
export function routeFromHash(hash: string): Route {
	const full = hash.replace(/^#/, "");
	const mark = full.indexOf("?");
	const raw = mark < 0 ? full : full.slice(0, mark);
	const query = new URLSearchParams(mark < 0 ? "" : full.slice(mark + 1));
	const slash = raw.indexOf("/");
	const head = slash < 0 ? raw : raw.slice(0, slash);
	const rest = slash < 0 ? null : raw.slice(slash + 1);
	if (isPageKind(head)) return { kind: "page", page: PAGES[head](rest, query) };
	if (isWebModuleId(head)) return { kind: "page", page: modulePage(head, rest, query, PAGE_ADDRESSES) };
	if (`${head}/` === SESSION_HASH_PREFIX && rest) {
		const sessionId = decodeSegment(rest);
		return sessionId === null ? { kind: "panes", layout: EMPTY_LAYOUT } : { kind: "session", sessionId };
	}
	return { kind: "panes", layout: layoutFromPanes(raw) };
}

/** The hash that names `route`, the inverse of {@link routeFromHash}. */
export function hashForRoute(route: Route): string {
	if (route.kind === "page") return hashForPage(route.page);
	if (route.kind === "session") return hashForSession(route.sessionId);
	return hashForLayout(route.layout);
}

/** The view a session id opens: the live host that runs the session, else its saved transcript. */
export function viewForSession(sessionId: string, hosts: RosterHost[]): View {
	const host = hosts.find(h => h.sessionId === sessionId);
	return host ? { kind: "live", instanceId: host.instanceId, agentId: null } : { kind: "past", sessionId };
}

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

/** Instance ids are hex, so none reads as `past`, `settings`, `pull-requests`, `session`, or `new`. `null` for a pane whose ids do not decode. */
function viewFromPane(pane: string): View | null {
	if (pane.startsWith(PAST_PREFIX)) {
		const sessionId = decodeSegment(pane.slice(PAST_PREFIX.length));
		return sessionId === null ? null : { kind: "past", sessionId };
	}
	const slash = pane.indexOf("/");
	const instanceId = decodeSegment(slash < 0 ? pane : pane.slice(0, slash));
	const agentId = slash < 0 ? null : decodeSegment(pane.slice(slash + 1));
	if (instanceId === null || (slash >= 0 && agentId === null)) return null;
	return { kind: "live", instanceId, agentId };
}

export const hashForView = (view: View): string => `#${paneForView(view)}`;

export const sameView = (a: View | null, b: View | null): boolean => {
	if (a === null || b === null) return a === b;
	if (a.kind === "past") return b.kind === "past" && a.sessionId === b.sessionId;
	return b.kind === "live" && a.instanceId === b.instanceId && a.agentId === b.agentId;
};

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

/** The layout a hash's panes name, keeping the first {@link MAX_PANES} distinct views and focus on the view it named. */
function layoutFromPanes(marked: string): Layout {
	const maximized = marked.endsWith(MAXIMIZED);
	const raw = maximized ? marked.slice(0, -MAXIMIZED.length) : marked;
	const at = raw.lastIndexOf("@");
	const named = (at < 0 ? raw : raw.slice(0, at))
		.split(",")
		.filter(Boolean)
		.map(viewFromPane)
		.filter(view => view !== null);
	const focused = named[at < 0 ? 0 : Number(raw.slice(at + 1))] ?? named[0];
	const panes = named.filter((view, index) => named.findIndex(other => sameView(other, view)) === index).slice(0, MAX_PANES);
	return {
		panes,
		focus: Math.max(0, panes.findIndex(view => sameView(view, focused ?? null))),
		maximized: maximized && panes.length > 1,
	};
}

export type OpenMode = "replace" | "split" | "beside";

/**
 * `view` in the focused pane, or in a new pane for `split` and `beside`. A view already open gets focus instead of a
 * second pane. A split adds the last pane, and with {@link MAX_PANES} open replaces the focused pane. Beside, as a
 * subagent opens from its conversation, puts the pane right after the focused one, and with {@link MAX_PANES} open
 * replaces the other pane of the focused one's row, so the focused pane stays. A plain open keeps a maximized pane
 * maximized, now showing the opened view; a split brings the split back.
 */
export function openView(layout: Layout, view: View, mode: OpenMode): Layout {
	const { panes, focus } = layout;
	const maximized = layout.maximized && mode === "replace";
	const open = panes.findIndex(pane => sameView(pane, view));
	if (open >= 0) return { panes, focus: open, maximized };
	if (panes.length === 0) return { panes: [view], focus: 0, maximized: false };
	if (mode === "replace") return { panes: panes.with(focus, view), focus, maximized };
	if (panes.length < MAX_PANES) {
		const at = mode === "split" ? panes.length : focus + 1;
		return { panes: panes.toSpliced(at, 0, view), focus: at, maximized: false };
	}
	const at = mode === "split" ? focus : focus ^ 1;
	return { panes: panes.with(at, view), focus: at, maximized: false };
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
 * The layout once start `op` answers with live session `instanceId`, `null` to leave it: a resumed session takes the
 * pane of the past session it continues, a new session opens alone, a fork and a new pull request open in the focused
 * pane, and a quick action's session runs in the background.
 */
export function layoutAfterStart(layout: Layout, op: StartOp, instanceId: string): Layout | null {
	const live: LiveView = { kind: "live", instanceId, agentId: null };
	switch (op.kind) {
		case "resume":
			return swapView(layout, { kind: "past", sessionId: op.sessionId }, live);
		case "new":
			return { panes: [live], focus: 0, maximized: false };
		case "fork":
		case "pull-request-new":
			return openView(layout, live, "replace");
		case "quick":
		case "resume-all":
			return null;
		default: {
			const never: never = op;
			return never;
		}
	}
}

/** The layout once **Resume all** `started` these sessions: each pane showing one as past shows it live. `null` when no pane changes. */
export function layoutAfterResumeAll(layout: Layout, started: { sessionId: string; instanceId: string }[]): Layout | null {
	const panes = layout.panes.map((view): View => {
		const resumed = view.kind === "past" && started.find(({ sessionId }) => sessionId === view.sessionId);
		return resumed ? { kind: "live", instanceId: resumed.instanceId, agentId: null } : view;
	});
	return panes.some((view, index) => view !== layout.panes[index]) ? { ...layout, panes } : null;
}

function showsEnded(pane: View, instanceId: string): boolean {
	return pane.kind === "live" && pane.instanceId === instanceId;
}

/** One pane's replacement once its session ends. A single conversation stays a single conversation. */
function replaceEnded(layout: Layout, instanceId: string, listed: string[], eligible: ReadonlySet<string>): Layout {
	const at = listed.indexOf(instanceId);
	const neighbors = (at < 0 ? [] : [...listed.slice(at + 1), ...listed.slice(0, at).reverse()])
		.filter(id => eligible.has(id))
		.map((id): View => ({ kind: "live", instanceId: id, agentId: null }))
		.filter(view => !layout.panes.some(pane => sameView(pane, view)));
	const panes = layout.panes.map(pane => (showsEnded(pane, instanceId) ? (neighbors.shift() ?? pane) : pane));
	return panes.reduceRight((next, pane, index) => (showsEnded(pane, instanceId) ? closePane(next, index) : next), { ...layout, panes });
}

/**
 * The layout once live session `instanceId` ends. One pane shows the next session in `listed` (the sidebar's live
 * sessions before ending, in order), else the previous, skipping sessions absent from `eligible`. A split that shows
 * the ended session leaves the split: the focused pane stays when it is another session, otherwise the first other
 * pane stays, and when every pane was that session the next session opens alone.
 */
export function endSession(layout: Layout, instanceId: string, listed: string[], eligible: ReadonlySet<string>): Layout {
	const ended = layout.panes.some(pane => showsEnded(pane, instanceId));
	if (!ended || layout.panes.length < 2) return replaceEnded(layout, instanceId, listed, eligible);
	const focused = layout.panes[layout.focus];
	const stay = focused && !showsEnded(focused, instanceId) ? focused : layout.panes.find(pane => !showsEnded(pane, instanceId));
	if (stay) return { panes: [stay], focus: 0, maximized: false };
	return { ...replaceEnded({ panes: [layout.panes[0]!], focus: 0, maximized: false }, instanceId, listed, eligible), maximized: false };
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
