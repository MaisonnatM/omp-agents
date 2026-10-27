/** What the page holds of the dashboard, and how the server's messages and the page's own actions change it. */
import { applyBot, type Bot, type BotChange, type BotId } from "../src/shared/bots";
import type { PlanUsage } from "../src/shared/models";
import type { QueuedMerge } from "../src/shared/merge-queue";
import type { Notice } from "../src/shared/notices";
import type { ServerMsg } from "../src/shared/protocol";
import type { ReviewDraft } from "../src/shared/review-drafts";
import { applyPins, type PinChange } from "../src/shared/pins";
import type { ScheduledSend } from "../src/shared/scheduled";
import { newestPastFirst, type PastSession, type RosterHost, type View } from "../src/shared/sessions";
import type { Workspace, WorkspaceList } from "../src/shared/workspaces";
import type { Routine } from "../src/routines";
import { applyUserNote } from "../src/user-notes";
import type { UserNoteChange, UserNoteList } from "../src/user-notes-shared";
import { applyUserTodo } from "../src/user-todos";
import type { UserTodoChange, UserTodoList } from "../src/user-todos-shared";
import { applyDelta } from "./keyed-list";
import type { Completions } from "./pane-store";
import { changePanes, DEFAULT_SPLIT_RATIOS, type PaneCommand, type PaneNavigation, type SplitRatios } from "./pane-navigation";
import type { ModelList } from "./reads";
import { EMPTY_LAYOUT, endSession, hashForLayout, hashForRoute, type Layout, type Page, type Route, sameView } from "./routing";
import { beginStart, dismissSettled, dropHidden, failStart, pendingStart, settleResumeAll, settleStart, type StartKind, type StartOp, type Starts } from "./starts";

export interface DashboardState extends PaneNavigation {
	connected: boolean;
	hosts: RosterHost[];
	rosterError: string | null;
	/** Sessions without a live host, newest first. */
	past: PastSession[];
	/** Whether the server has sent its session lists, the roster and then the past sessions, since the page loaded. */
	listed: boolean;
	/** What the URL hash shows over the panes: a page, or a `#session/<id>` link until the session lists show where it runs; `null` for the panes. */
	cover: Exclude<Route, { kind: "panes" }> | null;
	/** The last outbound URL instruction, a new object for each; incoming history never emits one. */
	historyWrite: { hash: string; mode: "push" | "replace" } | null;
	/** Last roster row seen for each open live session, by instance id, kept after it leaves the roster. */
	lastHosts: Map<string, RosterHost>;
	/** Starts of new, forked, resumed, and quick-action sessions, and of **Resume all**, by the `reqId` the server answers with. */
	starts: Starts;
	/** The server's last answer to the new-session draft's `complete`. */
	newSessionCompletions: Completions | null;
	/** The session this page last started, forked, or resumed, once it is ready. */
	started: { instanceId: string; cwd: string } | null;
	/** `null` until the server's first `omp usage` run finishes. */
	usage: { plans: PlanUsage[]; error: string | null } | null;
	/** Last model list the server sent for each open live session, by instance id. */
	models: Map<string, ModelList>;
	/** The Todo page's list, `null` until the server first sends it; a change shows here before the server answers. */
	userTodos: UserTodoList | null;
	/** The Notes page's list, `null` until the server first sends it; a change shows here before the server answers. */
	userNotes: UserNoteList | null;
	/** Every routine, empty until the server first sends them. */
	routines: Routine[];
	/** Every Bot, `null` until the server first sends them; a change shows here before the server answers. */
	bots: Bot[] | null;
	/** What each Bot remembers, as the server last read it. */
	botMemories: Record<BotId, string>;
	/** The messages and session starts that wait for a time, soonest first, empty until the server first sends them. */
	scheduled: ScheduledSend[];
	/** The directories Settings → Workspaces added and hid, empty until the server first sends them. */
	workspaceList: WorkspaceList<Workspace>;
	/** The pinned sessions' ids, empty until the server first sends them; a change shows here before the server answers. */
	pins: string[];
	/** What the bell lists, empty until the server first sends it. */
	notices: Notice[];
	/** The merges the server waits to make until GitHub allows them, empty until the server first sends them. */
	merges: QueuedMerge[];
	/** The review drafts the server keeps, posted ones too, empty until the server first sends them. */
	reviewDrafts: ReviewDraft[];
	/** The live sessions this page asked the server to end, by instance id, with the session each ran then, until the server answers. */
	ending: ReadonlyMap<string, string | null>;
}

/** The server messages the reducer takes as they come; the socket router sends the rest to the pane store. */
export type ServerAction = Extract<ServerMsg, { t: "roster" | "past" | "started" | "resumed-all" | "usage" | "models" | "user-todos" | "user-notes" | "routines" | "bots" | "scheduled" | "workspaces" | "pins" | "notices" | "merges" | "review-drafts" }>;

export type Action =
	| { t: "connected"; connected: boolean }
	| { t: "route"; route: Route }
	| { t: "panes"; command: PaneCommand; replace?: boolean }
	| { t: "navigate"; page: Page }
	| { t: "end-success"; instanceId: string; listed: string[] }
	| { t: "start"; reqId: number; op: StartOp }
	/** Start `reqId` failed with no answer from the server: its request was refused or never sent. */
	| { t: "start-failed"; reqId: number; error: string }
	/** A failed start's error goes away; a start under way keeps waiting for its answer. */
	| { t: "dismiss-start"; kind: StartKind }
	/** The page asked the server to end live session `instanceId`. */
	| { t: "end"; instanceId: string }
	/** The server answered the page's end of `instanceId`, whether it ended or failed to. */
	| { t: "ended"; instanceId: string }
	| { t: "new-session-completions"; completions: Completions }
	| { t: "user-todo"; change: UserTodoChange }
	| { t: "user-note"; change: UserNoteChange }
	| { t: "pin"; change: PinChange }
	| { t: "bot"; change: Exclude<BotChange, { op: "message" }>; now: string }
	| ServerAction;

const liveIds = (layout: Layout): string[] => layout.panes.flatMap(view => (view.kind === "live" ? [view.instanceId] : []));

const pick = <V>(map: Map<string, V>, keys: string[]): Map<string, V> =>
	new Map(
		keys.flatMap(key => {
			const value = map.get(key);
			return value === undefined ? [] : [[key, value] as const];
		}),
	);

/** Each open live session's current roster row, else the one last seen. */
function rememberHosts(prev: Map<string, RosterHost>, hosts: RosterHost[], layout: Layout): Map<string, RosterHost> {
	const next = new Map<string, RosterHost>();
	for (const id of liveIds(layout)) {
		const host = hosts.find(row => row.instanceId === id) ?? prev.get(id);
		if (host) next.set(id, host);
	}
	return next;
}

/** `state` with `next` in its panes. */
function withLayout(state: DashboardState, next: Layout): DashboardState {
	if (hashForLayout(next) === hashForLayout(state.layout)) return state;
	// A view that stays open stays the same object, so its pane can skip the update.
	const layout = { ...next, panes: next.panes.map(view => state.layout.panes.find(pane => sameView(pane, view)) ?? view) };
	const shown = (view: View): boolean => layout.panes.some(pane => sameView(pane, view));
	return {
		...state,
		layout,
		lastHosts: rememberHosts(state.lastHosts, state.hosts, layout),
		models: pick(state.models, liveIds(layout)),
		starts: dropHidden(state.starts, shown),
	};
}

function withPanes(state: DashboardState, command: PaneCommand): DashboardState {
	const { layout, splits } = changePanes(state, command, state.hosts, state.lastHosts);
	const next = withLayout(state, layout);
	return next.splits === splits ? next : { ...next, splits };
}

/** The route the URL hash names for `state`: the page or session link over the panes, else the panes. */
export const routeOf = (state: Pick<DashboardState, "cover" | "layout">): Route => state.cover ?? { kind: "panes", layout: state.layout };

function writeRoute(state: DashboardState, next: DashboardState, mode: "push" | "replace"): DashboardState {
	const hash = hashForRoute(routeOf(next));
	if (hash === hashForRoute(routeOf(state))) return next;
	return { ...next, historyWrite: { hash, mode } };
}

export function reduce(state: DashboardState, action: Action): DashboardState {
	switch (action.t) {
		case "connected":
			return { ...state, connected: action.connected };
		case "route": {
			const { route } = action;
			if (route.kind !== "panes") return { ...state, cover: route, historyWrite: null };
			const next = withPanes(state, { kind: "history", layout: route.layout });
			return next.cover === null && next.historyWrite === null ? next : { ...next, cover: null, historyWrite: null };
		}
		case "panes": {
			const next = withPanes(state, action.command);
			return writeRoute(state, next.cover === null ? next : { ...next, cover: null }, action.replace ? "replace" : "push");
		}
		case "navigate":
			return writeRoute(state, { ...state, cover: { kind: "page", page: action.page } }, "push");
		case "end-success": {
			const sessionId = state.ending.get(action.instanceId) ?? null;
			const forgotten = sessionId === null ? state : withPanes(state, { kind: "forget-session", sessionId });
			const eligible = new Set(state.hosts.filter(host => !state.ending.has(host.instanceId)).map(host => host.instanceId));
			const layout = endSession(state.layout, action.instanceId, action.listed, eligible);
			const cover = state.cover?.kind === "page" ? state.cover : null;
			return writeRoute(state, { ...withPanes(forgotten, { kind: "edit", layout }), cover }, "push");
		}
		case "start":
			return { ...state, starts: beginStart(state.starts, action.reqId, action.op) };
		case "start-failed": {
			const starts = failStart(state.starts, action.reqId, action.error);
			return starts === state.starts ? state : { ...state, starts };
		}
		case "dismiss-start":
			return { ...state, starts: dismissSettled(state.starts, action.kind) };
		case "end": {
			if (state.ending.has(action.instanceId)) return state;
			const sessionId = state.hosts.find(host => host.instanceId === action.instanceId)?.sessionId ?? state.lastHosts.get(action.instanceId)?.sessionId ?? null;
			return { ...state, ending: new Map(state.ending).set(action.instanceId, sessionId) };
		}
		case "ended": {
			if (!state.ending.has(action.instanceId)) return state;
			const ending = new Map(state.ending);
			ending.delete(action.instanceId);
			return { ...state, ending };
		}
		case "new-session-completions":
			return { ...state, newSessionCompletions: action.completions };
		case "roster": {
			const hosts = applyDelta(state.hosts, action.reset, action.hosts, host => host.instanceId, action.removed);
			return { ...state, hosts, rosterError: action.error, lastHosts: rememberHosts(state.lastHosts, hosts, state.layout) };
		}
		case "past":
			return { ...state, past: applyDelta(state.past, action.reset, action.sessions, session => session.sessionId, action.removed).sort(newestPastFirst), listed: true };
		case "started": {
			if (!pendingStart(state.starts, action.reqId)) return state;
			const starts = settleStart(state.starts, action.reqId, action.result);
			if (!action.result.ok) return { ...state, starts };
			const { instanceId, cwd } = action.result;
			return { ...state, starts, started: { instanceId, cwd } };
		}
		case "resumed-all": {
			const starts = settleResumeAll(state.starts, action.reqId, action.errors);
			return starts === state.starts ? state : { ...state, starts };
		}
		case "usage":
			return { ...state, usage: { plans: action.plans, error: action.error } };
		case "models":
			if (!liveIds(state.layout).includes(action.instanceId)) return state;
			return { ...state, models: new Map(state.models).set(action.instanceId, { data: { models: action.models }, error: action.error }) };
		case "user-todos":
			return { ...state, userTodos: action.list };
		case "user-notes":
			return { ...state, userNotes: action.list };
		case "routines":
			return { ...state, routines: action.routines };
		case "bots":
			return { ...state, bots: action.bots, botMemories: action.memories };
		case "bot":
			return state.bots ? { ...state, bots: applyBot(state.bots, action.change, action.now) } : state;
		case "scheduled":
			return { ...state, scheduled: action.sends };
		case "workspaces":
			return { ...state, workspaceList: action.list };
		case "pins":
			return { ...state, pins: action.sessionIds };
		case "notices":
			return { ...state, notices: action.list };
		case "merges":
			return { ...state, merges: action.list };
		case "review-drafts":
			return { ...state, reviewDrafts: action.list };
		case "user-todo":
			return state.userTodos ? { ...state, userTodos: applyUserTodo(state.userTodos, action.change) } : state;
		case "user-note":
			return state.userNotes ? { ...state, userNotes: applyUserNote(state.userNotes, action.change) } : state;
		case "pin": {
			const pins = applyPins(state.pins, action.change);
			return pins === state.pins ? state : { ...state, pins };
		}
		default: {
			const never: never = action;
			return never;
		}
	}
}

/** The state of a page that has just loaded at `route`. */
export function initialState(route: Route, ratios: SplitRatios = DEFAULT_SPLIT_RATIOS): DashboardState {
	return {
		connected: false,
		hosts: [],
		rosterError: null,
		past: [],
		listed: false,
		cover: route.kind === "panes" ? null : route,
		layout: route.kind === "panes" ? route.layout : EMPTY_LAYOUT,
		splits: { ratios, groups: [] },
		historyWrite: null,
		lastHosts: new Map(),
		starts: new Map(),
		newSessionCompletions: null,
		started: null,
		usage: null,
		models: new Map(),
		userTodos: null,
		userNotes: null,
		routines: [],
		bots: null,
		botMemories: {},
		scheduled: [],
		workspaceList: { added: [], hidden: [] },
		pins: [],
		notices: [],
		merges: [],
		reviewDrafts: [],
		ending: new Map(),
	};
}
