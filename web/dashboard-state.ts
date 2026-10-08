/** What the page holds of the dashboard, and how the server's messages and the page's own actions change it. */
import type { PlanUsage } from "../src/shared/models";
import type { Notice } from "../src/shared/notices";
import type { ServerMsg } from "../src/shared/protocol";
import type { Project, ProjectList } from "../src/shared/projects";
import { type LiveView, newestPastFirst, type PastSession, type RosterHost, type View } from "../src/shared/sessions";
import type { Routine } from "../src/routines";
import { applyUserTodo } from "../src/user-todos";
import type { UserTodoChange, UserTodoList } from "../src/user-todos-shared";
import { applyDelta } from "./keyed-list";
import type { Completions } from "./pane-store";
import type { ModelList } from "./reads";
import { EMPTY_LAYOUT, hashForLayout, type Layout, type Route, sameView } from "./routing";
import { beginStart, dismissSettled, dropHidden, loseStarts, pendingStart, settleResumeAll, settleStart, type StartKind, type StartOp, type Starts } from "./starts";

export interface DashboardState {
	connected: boolean;
	hosts: RosterHost[];
	rosterError: string | null;
	/** Sessions without a live host, newest first. */
	past: PastSession[];
	/** Whether the server has sent its session lists, the roster and then the past sessions, since the page loaded. */
	listed: boolean;
	/** What the URL hash shows over the panes: a page, or a `#session/<id>` link until the session lists show where it runs; `null` for the panes. */
	cover: Exclude<Route, { kind: "panes" }> | null;
	/** The panes, kept as they were behind a page that covers them. */
	layout: Layout;
	/** Last roster row seen for each open live session, by instance id, kept after it leaves the roster. */
	lastHosts: Map<string, RosterHost>;
	/** Starts of new, forked, resumed, and quick-action sessions, and of **Resume all**, by the `reqId` the server answers with. */
	starts: Starts;
	/** The server's last answer to the new-session draft's `complete`. */
	newSessionCompletions: Completions | null;
	/** Composer text for a forked session's first mount. */
	draft: { view: LiveView; text: string } | null;
	/** The session this page last started, forked, or resumed, once it is ready. */
	started: { instanceId: string; cwd: string } | null;
	/** `null` until the server's first `omp usage` run finishes. */
	usage: { plans: PlanUsage[]; error: string | null } | null;
	/** Last model list the server sent for each open live session, by instance id. */
	models: Map<string, ModelList>;
	/** The Todo page's list, `null` until the server first sends it; a change shows here before the server answers. */
	userTodos: UserTodoList | null;
	/** Every routine, empty until the server first sends them. */
	routines: Routine[];
	/** The directories Settings → Projects added and hid, empty until the server first sends them. */
	projectList: ProjectList<Project>;
	/** What the bell lists, empty until the server first sends it. */
	notices: Notice[];
}

/** The server messages the reducer takes as they come; the socket router sends the rest to the pane store. */
export type ServerAction = Extract<ServerMsg, { t: "roster" | "past" | "started" | "resumed-all" | "usage" | "models" | "user-todos" | "routines" | "projects" | "notices" }>;

export type Action =
	| { t: "connected"; connected: boolean }
	| { t: "route"; route: Route }
	| { t: "start"; reqId: number; op: StartOp }
	/** A failed start's error goes away; a start under way keeps waiting for its answer. */
	| { t: "dismiss-start"; kind: StartKind }
	| { t: "new-session-completions"; completions: Completions }
	| { t: "user-todo"; change: UserTodoChange }
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
		draft: state.draft && shown(state.draft.view) ? state.draft : null,
	};
}

export function reduce(state: DashboardState, action: Action): DashboardState {
	switch (action.t) {
		case "connected":
			return { ...state, connected: action.connected, starts: action.connected ? state.starts : loseStarts(state.starts) };
		case "route": {
			const { route } = action;
			if (route.kind !== "panes") return { ...state, cover: route };
			const next = withLayout(state, route.layout);
			return next.cover === null ? next : { ...next, cover: null };
		}
		case "start":
			return { ...state, starts: beginStart(state.starts, action.reqId, action.op) };
		case "dismiss-start":
			return { ...state, starts: dismissSettled(state.starts, action.kind) };
		case "new-session-completions":
			return { ...state, newSessionCompletions: action.completions };
		case "roster": {
			const hosts = applyDelta(state.hosts, action.reset, action.hosts, host => host.instanceId, action.removed);
			return { ...state, hosts, rosterError: action.error, lastHosts: rememberHosts(state.lastHosts, hosts, state.layout) };
		}
		case "past":
			return { ...state, past: applyDelta(state.past, action.reset, action.sessions, session => session.sessionId, action.removed).sort(newestPastFirst), listed: true };
		case "started": {
			const start = pendingStart(state.starts, action.reqId);
			if (!start) return state;
			const starts = settleStart(state.starts, action.reqId, action.result);
			if (!action.result.ok) return { ...state, starts };
			const { instanceId, cwd, prompt } = action.result;
			// A fork's composer starts with the prompt it branched at, to edit; forking a reply starts it empty.
			const draft: DashboardState["draft"] =
				start.op.kind === "fork"
					? { view: { kind: "live", instanceId, agentId: null }, text: start.op.point.prefill ? (prompt ?? "") : "" }
					: state.draft;
			return { ...state, starts, draft, started: { instanceId, cwd } };
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
		case "routines":
			return { ...state, routines: action.routines };
		case "projects":
			return { ...state, projectList: action.list };
		case "notices":
			return { ...state, notices: action.list };
		case "user-todo":
			return state.userTodos ? { ...state, userTodos: applyUserTodo(state.userTodos, action.change) } : state;
		default: {
			const never: never = action;
			return never;
		}
	}
}

/** The state of a page that has just loaded at `route`. */
export function initialState(route: Route): DashboardState {
	return {
		connected: false,
		hosts: [],
		rosterError: null,
		past: [],
		listed: false,
		cover: route.kind === "panes" ? null : route,
		layout: route.kind === "panes" ? route.layout : EMPTY_LAYOUT,
		lastHosts: new Map(),
		starts: new Map(),
		newSessionCompletions: null,
		draft: null,
		started: null,
		usage: null,
		models: new Map(),
		userTodos: null,
		routines: [],
		projectList: { added: [], hidden: [] },
		notices: [],
	};
}
