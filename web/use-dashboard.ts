import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import type { ClientMsg, LiveView, ModelOption, PastSession, PlanUsage, RosterHost, ServerMsg, View } from "../src/shared";
import { applyPaneMessage, type Completions, isPaneMsg, type PaneMsg, retainPanes } from "./pane-store";
import {
	EMPTY_LAYOUT,
	hashForLayout,
	hashForNewSession,
	isPageHash,
	type Layout,
	layoutFromHash,
	type OpenMode,
	openView,
	sameView,
	sessionFromHash,
	swapView,
	viewForSession,
} from "./routing";
import { beginStart, dismissFailed, dropHidden, loseStarts, requestOf, settleStart, type StartKind, type StartOp, type Starts } from "./starts";

const subscribeHash = (onChange: () => void): (() => void) => {
	window.addEventListener("hashchange", onChange);
	return () => window.removeEventListener("hashchange", onChange);
};

/** The URL hash, rendering again whenever it changes. */
export const useHash = (): string => useSyncExternalStore(subscribeHash, () => location.hash);

const NO_VIEWS: View[] = [];

export interface Models {
	models: ModelOption[];
	error: string | null;
}

/** The page's last **Resume all**: waiting for the server's answer, or failed for some of its sessions. One that resumed everything leaves no trace. */
export type ResumeAll = { phase: "starting"; reqId: number } | { phase: "failed"; error: string };

export interface DashboardState {
	connected: boolean;
	hosts: RosterHost[];
	rosterError: string | null;
	/** Sessions without a live host, newest first. */
	past: PastSession[];
	/** Whether the server has sent its session lists, the roster and then the past sessions, since the page loaded. */
	listed: boolean;
	layout: Layout;
	/** Last roster row seen for each open live session, by instance id, kept after it leaves the roster. */
	lastHosts: Map<string, RosterHost>;
	/** Starts of new, forked, and resumed sessions, by the `reqId` the server answers with. */
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
	resumeAll: ResumeAll | null;
}

type Action =
	| { t: "connected"; connected: boolean }
	/** Everything the server sends except what {@link isPaneMsg} says belongs to one view, which the pane store takes. */
	| { t: "server"; msg: Exclude<ServerMsg, PaneMsg> }
	| { t: "layout"; layout: Layout }
	| { t: "start"; reqId: number; op: StartOp }
	/** A failed start's error goes away; a start under way keeps waiting for its answer. */
	| { t: "dismiss-start"; kind: StartKind }
	| { t: "resume-all"; reqId: number }
	| { t: "dismiss-resume-all" };

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

function reduce(state: DashboardState, action: Action): DashboardState {
	switch (action.t) {
		case "connected":
			return {
				...state,
				connected: action.connected,
				starts: action.connected ? state.starts : loseStarts(state.starts),
				resumeAll:
					!action.connected && state.resumeAll?.phase === "starting"
						? { phase: "failed", error: "Lost the dashboard server while resuming. The sessions may still appear." }
						: state.resumeAll,
			};
		case "layout": {
			if (hashForLayout(action.layout) === hashForLayout(state.layout)) return state;
			// A view that stays open stays the same object, so its pane can skip the update.
			const layout = { ...action.layout, panes: action.layout.panes.map(view => state.layout.panes.find(pane => sameView(pane, view)) ?? view) };
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
		case "start":
			return { ...state, starts: beginStart(state.starts, action.reqId, action.op) };
		case "dismiss-start":
			return { ...state, starts: dismissFailed(state.starts, action.kind) };
		case "resume-all":
			return { ...state, resumeAll: { phase: "starting", reqId: action.reqId } };
		case "dismiss-resume-all":
			return state.resumeAll?.phase === "failed" ? { ...state, resumeAll: null } : state;
		case "server": {
			const msg = action.msg;
			switch (msg.t) {
				case "roster":
					return {
						...state,
						hosts: keepUnchanged(state.hosts, msg.hosts),
						rosterError: msg.error,
						lastHosts: rememberHosts(state.lastHosts, msg.hosts, state.layout),
					};
				case "past":
					return { ...state, past: msg.sessions, listed: true };
				case "started": {
					const start = state.starts.get(msg.reqId);
					if (start?.phase !== "starting") return state;
					const starts = settleStart(state.starts, msg.reqId, msg.result);
					if (!msg.result.ok) return { ...state, starts };
					const { instanceId, cwd, prompt } = msg.result;
					// A fork's composer starts with the prompt it branched at, to edit; forking a reply starts it empty.
					const draft: DashboardState["draft"] =
						start.op.kind === "fork"
							? { view: { kind: "live", instanceId, agentId: null }, text: start.op.point.prefill ? (prompt ?? "") : "" }
							: state.draft;
					return { ...state, starts, draft, started: { instanceId, cwd } };
				}
				case "resumed-all": {
					if (state.resumeAll?.phase !== "starting" || state.resumeAll.reqId !== msg.reqId) return state;
					const [first] = msg.errors;
					if (first === undefined) return { ...state, resumeAll: null };
					const count = msg.errors.length === 1 ? "1 session" : `${msg.errors.length} sessions`;
					return { ...state, resumeAll: { phase: "failed", error: `Could not resume ${count}. ${first}` } };
				}
				case "completions":
					return { ...state, newSessionCompletions: { reqId: msg.reqId, items: msg.items, error: msg.error } };
				case "usage":
					return { ...state, usage: { plans: msg.plans, error: msg.error } };
				case "models":
					if (!liveIds(state.layout).includes(msg.instanceId)) return state;
					return { ...state, models: new Map(state.models).set(msg.instanceId, { models: msg.models, error: msg.error }) };
			}
		}
	}
}

/** Dashboard state plus the ways the page talks back. */
export interface Dashboard {
	state: DashboardState;
	send: (msg: ClientMsg) => void;
	/** Show `view` in the focused pane, or in a new pane for `split`. */
	open: (view: View, mode: OpenMode) => void;
	focus: (index: number) => void;
	/** Show `layout`, as a new history entry. */
	show: (layout: Layout) => void;
	/** Open the new-session draft in the default directory, clearing a failed start's error. */
	openNewSession: () => void;
	/** Forget the error of a failed start of `kind`. */
	dismissStart: (kind: StartKind) => void;
	/** Start a session; it opens in the focused pane once ready (a quick action's in the pane its mode says), and a resumed one in the pane of the past session it continues. */
	start: (op: StartOp) => void;
	/** Resume these interrupted sessions; a pane that shows one of them shows it live once it runs. */
	resumeAll: (sessionIds: string[]) => void;
	/** Forget why the last **Resume all** failed. */
	dismissResumeAll: () => void;
}

/** Live dashboard state over the server's WebSocket; the panes live in the URL hash. */
export function useDashboard(): Dashboard {
	const [state, dispatch] = useReducer(reduce, {
		connected: false,
		hosts: [],
		rosterError: null,
		past: [],
		listed: false,
		layout: layoutFromHash(location.hash) ?? EMPTY_LAYOUT,
		lastHosts: new Map(),
		starts: new Map(),
		newSessionCompletions: null,
		draft: null,
		started: null,
		usage: null,
		models: new Map(),
		resumeAll: null,
	});
	const socketRef = useRef<WebSocket | null>(null);
	const layoutRef = useRef(state.layout);
	layoutRef.current = state.layout;
	// What the page asked to start when the last answer was rendered; a `started` message finds its start here before the render that settles it.
	const startsRef = useRef(state.starts);
	startsRef.current = state.starts;
	// A page covering the panes shows none of them, so the server stops streaming them until the panes return.
	const hash = useHash();
	const watched = isPageHash(hash) ? NO_VIEWS : state.layout.panes;
	const watchedRef = useRef(watched);
	watchedRef.current = watched;

	const send = useCallback((msg: ClientMsg) => {
		const ws = socketRef.current;
		if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
	}, []);

	// The hash is the source of truth; its `hashchange` dispatches the layout.
	const show = useCallback((layout: Layout) => {
		location.hash = hashForLayout(layout);
	}, []);

	const open = useCallback((view: View, mode: OpenMode) => show(openView(layoutRef.current, view, mode)), [show]);

	// Moving focus is not navigation, so it rewrites the current history entry.
	const focus = useCallback((index: number) => {
		const layout = { ...layoutRef.current, focus: index };
		history.replaceState(null, "", hashForLayout(layout) || location.pathname + location.search);
		dispatch({ t: "layout", layout });
	}, []);

	useEffect(() => {
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
				if (isPaneMsg(msg)) applyPaneMessage(msg);
				else dispatch({ t: "server", msg });
				if (msg.t === "started" && msg.result.ok) {
					const op = startsRef.current.get(msg.reqId)?.op;
					const live: LiveView = { kind: "live", instanceId: msg.result.instanceId, agentId: null };
					if (op?.kind === "resume") show(swapView(layoutRef.current, { kind: "past", sessionId: op.sessionId }, live));
					else if (op) open(live, op.kind === "quick" ? op.mode : "replace");
				}
				if (msg.t === "resumed-all") {
					const layout = layoutRef.current;
					const panes = layout.panes.map(view => {
						const started = view.kind === "past" && msg.started.find(({ sessionId }) => sessionId === view.sessionId);
						return started ? { kind: "live" as const, instanceId: started.instanceId, agentId: null } : view;
					});
					if (panes.some((view, index) => view !== layout.panes[index])) show({ ...layout, panes });
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
	}, [open, show]);

	useEffect(() => {
		const onHash = (): void => {
			const layout = layoutFromHash(location.hash);
			if (layout) dispatch({ t: "layout", layout });
		};
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);

	// A `#session/<id>` link opens where that session runs, once the server has listed the sessions.
	useEffect(() => {
		const sessionId = sessionFromHash(location.hash);
		if (sessionId === null || !state.listed) return;
		const layout = openView(layoutRef.current, viewForSession(sessionId, state.hosts), "replace");
		history.replaceState(null, "", hashForLayout(layout));
		dispatch({ t: "layout", layout });
	}, [hash, state.listed, state.hosts]);

	// Declared before the watch, so a view's data is kept when its transcript arrives.
	useEffect(() => retainPanes(state.layout.panes), [state.layout.panes]);

	useEffect(() => {
		send({ t: "watch", views: watched });
	}, [send, watched]);

	const dismissStart = useCallback((kind: StartKind) => dispatch({ t: "dismiss-start", kind }), []);

	const openNewSession = useCallback(() => {
		dispatch({ t: "dismiss-start", kind: "new" });
		location.hash = hashForNewSession(null);
	}, []);

	const nextReqId = useRef(0);
	const start = useCallback(
		(op: StartOp) => {
			const reqId = nextReqId.current++;
			dispatch({ t: "start", reqId, op });
			send({ t: "start", reqId, ...requestOf(op) });
		},
		[send],
	);

	const resumeAll = useCallback(
		(sessionIds: string[]) => {
			const reqId = nextReqId.current++;
			dispatch({ t: "resume-all", reqId });
			send({ t: "resume-all", reqId, sessionIds });
		},
		[send],
	);
	const dismissResumeAll = useCallback(() => dispatch({ t: "dismiss-resume-all" }), []);

	return { state, send, open, focus, show, openNewSession, dismissStart, start, resumeAll, dismissResumeAll };
}
