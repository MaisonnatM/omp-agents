import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ClientMsg, LiveView, ModelOption, PastSession, PlanUsage, RosterHost, ServerMsg, UserTodo, UserTodoChange, View } from "../src/shared";
import { applyUserTodo } from "../src/user-todos";
import { applyPaneMessage, type Completions, retainPanes } from "./pane-store";
import {
	EMPTY_LAYOUT,
	hashForLayout,
	hashForPage,
	type Layout,
	layoutAfterResumeAll,
	layoutAfterStart,
	type OpenMode,
	openView,
	type Page,
	type Route,
	routeFromHash,
	sameView,
	viewForSession,
} from "./routing";
import {
	beginStart,
	dismissSettled,
	dropHidden,
	loseStarts,
	messageOf,
	pendingStart,
	settleResumeAll,
	settleStart,
	type StartKind,
	type StartOp,
	type Starts,
} from "./starts";

const NO_VIEWS: View[] = [];

export interface Models {
	models: ModelOption[];
	error: string | null;
}

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
	models: Map<string, Models>;
	/** The Todo tab's list, `null` until the server first sends it; a change shows here before the server answers. */
	userTodos: UserTodo[] | null;
}

/** The server messages the reducer takes as they come; the socket router sends the rest to the pane store. */
type ServerAction = Extract<ServerMsg, { t: "roster" | "past" | "started" | "resumed-all" | "usage" | "models" | "user-todos" }>;

type Action =
	| { t: "connected"; connected: boolean }
	| { t: "route"; route: Route }
	| { t: "start"; reqId: number; op: StartOp }
	/** A failed start's error, or a quick action's started session, goes away; a start under way keeps waiting for its answer. */
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

/** `next` with each item that is unchanged since `prev` kept as it was, so what renders from it can skip the update. */
function keepUnchanged<T extends { instanceId: string }>(prev: T[], next: T[]): T[] {
	return next.map(row => {
		const before = prev.find(other => other.instanceId === row.instanceId);
		return before && JSON.stringify(before) === JSON.stringify(row) ? before : row;
	});
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

function reduce(state: DashboardState, action: Action): DashboardState {
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
		case "roster":
			return {
				...state,
				hosts: keepUnchanged(state.hosts, action.hosts),
				rosterError: action.error,
				lastHosts: rememberHosts(state.lastHosts, action.hosts, state.layout),
			};
		case "past":
			return { ...state, past: action.sessions, listed: true };
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
			return { ...state, models: new Map(state.models).set(action.instanceId, { models: action.models, error: action.error }) };
		case "user-todos":
			return { ...state, userTodos: action.todos };
		case "user-todo":
			return state.userTodos ? { ...state, userTodos: applyUserTodo(state.userTodos, action.change) } : state;
		default: {
			const never: never = action;
			return never;
		}
	}
}

function initialState(): DashboardState {
	const route = routeFromHash(location.hash);
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
	};
}

/** Dashboard state plus the ways the page talks back. */
export interface Dashboard {
	state: DashboardState;
	/** The page covering the panes; `null` while the panes show. */
	page: Page | null;
	send: (msg: ClientMsg) => void;
	/** Show `view` in the focused pane, or in a new pane for `split`. */
	open: (view: View, mode: OpenMode) => void;
	focus: (index: number) => void;
	/** Show `layout`, as a new history entry. */
	show: (layout: Layout) => void;
	/** Show `page` over the panes, as a new history entry. */
	navigate: (page: Page) => void;
	/** Open the new-session draft in the default directory, clearing a failed start's error. */
	openNewSession: () => void;
	/** Forget the error of a failed start of `kind`, or the session a quick action started. */
	dismissStart: (kind: StartKind) => void;
	/**
	 * Start a session; it opens in the focused pane once ready, and a resumed one in the pane of the past session it
	 * continues. A quick action's session runs in the background, and the page stays where it is. A **Resume all** shows
	 * each session it resumes live in the pane that shows it.
	 */
	start: (op: StartOp) => void;
	/** Change the Todo tab's list, which shows at once and reaches the server and every other window. */
	changeTodo: (change: UserTodoChange) => void;
}

/** Live dashboard state over the server's WebSocket; the panes live in the URL hash. */
export function useDashboard(): Dashboard {
	const [state, dispatch] = useReducer(reduce, null, initialState);
	const socketRef = useRef<WebSocket | null>(null);
	const layoutRef = useRef(state.layout);
	layoutRef.current = state.layout;
	// What the page asked to start when the last answer was rendered; a server answer finds its start here before the render that settles it.
	const startsRef = useRef(state.starts);
	startsRef.current = state.starts;
	const page = state.cover?.kind === "page" ? state.cover.page : null;
	// A page covering the panes shows none of them, so the server stops streaming them until the panes return.
	const watched = page ? NO_VIEWS : state.layout.panes;
	const watchedRef = useRef(watched);
	watchedRef.current = watched;

	const send = useCallback((msg: ClientMsg) => {
		const ws = socketRef.current;
		if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
	}, []);

	// The hash is the source of truth; its `hashchange` dispatches the route.
	const show = useCallback((layout: Layout) => {
		location.hash = hashForLayout(layout);
	}, []);

	const navigate = useCallback((next: Page) => {
		location.hash = hashForPage(next);
	}, []);

	// Moving focus, or opening a session link, is not navigation, so it rewrites the current history entry.
	const replace = useCallback((layout: Layout) => {
		history.replaceState(null, "", hashForLayout(layout) || location.pathname + location.search);
		dispatch({ t: "route", route: { kind: "panes", layout } });
	}, []);

	const open = useCallback((view: View, mode: OpenMode) => show(openView(layoutRef.current, view, mode)), [show]);

	const focus = useCallback((index: number) => replace({ ...layoutRef.current, focus: index }), [replace]);

	useEffect(() => {
		// A start's answer settles it, then the panes follow the start as it was before.
		const answer = (msg: ServerAction, layout: Layout | null): void => {
			dispatch(msg);
			if (layout) show(layout);
		};
		let retryMs = 500;
		let timer: number | undefined;
		let disposed = false;
		const connect = (): void => {
			const ws = new WebSocket(`ws://${location.host}/ws`);
			socketRef.current = ws;
			ws.onopen = () => {
				retryMs = 500;
				dispatch({ t: "connected", connected: true });
				ws.send(JSON.stringify({ t: "watch", views: watchedRef.current } satisfies ClientMsg));
			};
			ws.onmessage = event => {
				const msg = JSON.parse(String(event.data)) as ServerMsg;
				switch (msg.t) {
					case "items":
					case "work":
					case "dequeued":
						applyPaneMessage(msg);
						return;
					case "completions":
						if (msg.scope.kind === "live") applyPaneMessage({ ...msg, scope: msg.scope });
						else dispatch({ t: "new-session-completions", completions: { reqId: msg.reqId, items: msg.items, error: msg.error } });
						return;
					case "started": {
						const start = pendingStart(startsRef.current, msg.reqId);
						answer(msg, start && msg.result.ok ? layoutAfterStart(layoutRef.current, start.op, msg.result.instanceId) : null);
						return;
					}
					case "resumed-all":
						answer(msg, pendingStart(startsRef.current, msg.reqId) && layoutAfterResumeAll(layoutRef.current, msg.started));
						return;
					case "roster":
					case "past":
					case "usage":
					case "models":
					case "user-todos":
						dispatch(msg);
						return;
					default: {
						const never: never = msg;
						return never;
					}
				}
			};
			ws.onclose = () => {
				if (disposed) return;
				dispatch({ t: "connected", connected: false });
				timer = window.setTimeout(connect, retryMs);
				retryMs = Math.min(retryMs * 2, 5000);
			};
		};
		connect();
		return () => {
			disposed = true;
			clearTimeout(timer);
			socketRef.current?.close();
		};
	}, [show]);

	useEffect(() => {
		const onHash = (): void => dispatch({ t: "route", route: routeFromHash(location.hash) });
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);

	// A `#session/<id>` link opens where that session runs, once the server has listed the sessions.
	const sessionLink = state.cover?.kind === "session" ? state.cover.sessionId : null;
	useEffect(() => {
		if (sessionLink === null || !state.listed) return;
		replace(openView(layoutRef.current, viewForSession(sessionLink, state.hosts), "replace"));
	}, [sessionLink, state.listed, state.hosts, replace]);

	// Declared before the watch, so a view's data is kept when its transcript arrives.
	useEffect(() => retainPanes(state.layout.panes), [state.layout.panes]);

	useEffect(() => {
		send({ t: "watch", views: watched });
	}, [send, watched]);

	const dismissStart = useCallback((kind: StartKind) => dispatch({ t: "dismiss-start", kind }), []);

	const openNewSession = useCallback(() => {
		dispatch({ t: "dismiss-start", kind: "new" });
		navigate({ kind: "new", cwd: null });
	}, [navigate]);

	const nextReqId = useRef(0);
	const start = useCallback(
		(op: StartOp) => {
			const reqId = nextReqId.current++;
			dispatch({ t: "start", reqId, op });
			send(messageOf(op, reqId));
		},
		[send],
	);
	const changeTodo = useCallback(
		(change: UserTodoChange) => {
			dispatch({ t: "user-todo", change });
			send({ t: "user-todo", change });
		},
		[send],
	);

	return { state, page, send, open, focus, show, navigate, openNewSession, dismissStart, start, changeTodo };
}
