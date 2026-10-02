import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import type { ClientMsg, CompletionItem, Item, LiveView, ModelOption, PastSession, PlanUsage, RosterHost, ServerMsg, View } from "../src/shared";
import {
	applyItems,
	EMPTY_LAYOUT,
	type ForkPoint,
	hashForLayout,
	hashForNewSession,
	hashForView,
	type Layout,
	layoutFromHash,
	type OpenMode,
	openView,
	sameView,
	sessionFromHash,
	swapView,
	viewForSession,
} from "./view-model";

const subscribeHash = (onChange: () => void): (() => void) => {
	window.addEventListener("hashchange", onChange);
	return () => window.removeEventListener("hashchange", onChange);
};

/** The URL hash, rendering again whenever it changes. */
export const useHash = (): string => useSyncExternalStore(subscribeHash, () => location.hash);

/** Starting a session from the new-session draft: none, waiting for omp to start and take the first message, or failed with the reason. */
export type Launch = { phase: "idle" } | { phase: "starting" } | { phase: "failed"; error: string };

/** A fork from a message of `view`: none, waiting for the forked session, or failed with the reason. One runs at a time. */
export type Fork =
	| { phase: "idle" }
	| { phase: "forking"; view: View; itemId: string; point: ForkPoint }
	| { phase: "failed"; view: View; itemId: string; error: string };

/** Resuming a past session: none, waiting for its omp, or failed with the reason. One runs at a time. */
export type Resume = { phase: "idle" } | { phase: "resuming"; sessionId: string } | { phase: "failed"; sessionId: string; error: string };

export interface Completions {
	reqId: number;
	items: CompletionItem[];
	error: string | null;
}

export interface Models {
	models: ModelOption[];
	error: string | null;
}

/** What the server sent for one open view. */
export interface PaneData {
	items: Item[];
	completions: Completions | null;
	/** The last texts the server took out of the view's queue, answering the composer's `dequeue` `reqId`. */
	dequeued: { reqId: number; texts: string[] } | null;
}

export const EMPTY_PANE: PaneData = { items: [], completions: null, dequeued: null };

export interface DashboardState {
	connected: boolean;
	hosts: RosterHost[];
	rosterError: string | null;
	/** Sessions without a live host, newest first. */
	past: PastSession[];
	/** Whether the server has sent its session lists, the roster and then the past sessions, since the page loaded. */
	listed: boolean;
	layout: Layout;
	/** Per open view, by {@link hashForView}. */
	panes: Map<string, PaneData>;
	/** Last roster row seen for each open live session, by instance id, kept after it leaves the roster. */
	lastHosts: Map<string, RosterHost>;
	launch: Launch;
	/** The server's last answer to the new-session draft's `complete`. */
	newSessionCompletions: Completions | null;
	fork: Fork;
	resume: Resume;
	/** Composer text for a forked session's first mount. */
	draft: { view: LiveView; text: string } | null;
	/** The session this page last started, forked, or resumed, once it is ready. */
	started: { instanceId: string; cwd: string } | null;
	/** `null` until the server's first `omp usage` run finishes. */
	usage: { plans: PlanUsage[]; error: string | null } | null;
	/** Last model list the server sent for each open live session, by instance id. */
	models: Map<string, Models>;
}

type Action =
	| { t: "connected"; connected: boolean }
	| { t: "server"; msg: ServerMsg }
	| { t: "layout"; layout: Layout }
	| { t: "launch"; launch: Launch }
	/** A failed start's error goes away with its draft; a start under way keeps waiting for its answer. */
	| { t: "dismiss-launch" }
	| { t: "fork"; fork: Fork }
	| { t: "resume"; resume: Resume };

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

const updatePane = (state: DashboardState, view: View, update: (pane: PaneData) => PaneData): DashboardState => {
	const key = hashForView(view);
	if (!state.layout.panes.some(pane => sameView(pane, view))) return state;
	return { ...state, panes: new Map(state.panes).set(key, update(state.panes.get(key) ?? EMPTY_PANE)) };
};

function reduce(state: DashboardState, action: Action): DashboardState {
	switch (action.t) {
		case "connected": {
			// The answer to a pending `create`, `fork`, or `resume` went to the socket that just closed.
			const launch: Launch =
				!action.connected && state.launch.phase === "starting"
					? { phase: "failed", error: "Lost the dashboard server while the session was starting. It may still appear." }
					: state.launch;
			const fork: Fork =
				!action.connected && state.fork.phase === "forking"
					? { phase: "failed", view: state.fork.view, itemId: state.fork.itemId, error: "Lost the dashboard server while forking. The fork may still appear." }
					: state.fork;
			const resume: Resume =
				!action.connected && state.resume.phase === "resuming"
					? { phase: "failed", sessionId: state.resume.sessionId, error: "Lost the dashboard server while resuming. The session may still appear." }
					: state.resume;
			return { ...state, connected: action.connected, launch, fork, resume };
		}
		case "layout": {
			const { layout } = action;
			if (hashForLayout(layout) === hashForLayout(state.layout)) return state;
			const shown = (view: View): boolean => layout.panes.some(pane => sameView(pane, view));
			return {
				...state,
				layout,
				// Views that stay open keep their transcript: the server streams only new views from the start.
				panes: pick(state.panes, layout.panes.map(hashForView)),
				lastHosts: rememberHosts(state.lastHosts, state.hosts, layout),
				models: pick(state.models, liveIds(layout)),
				fork: state.fork.phase === "failed" && !shown(state.fork.view) ? { phase: "idle" } : state.fork,
				resume: state.resume.phase === "failed" && !shown({ kind: "past", sessionId: state.resume.sessionId }) ? { phase: "idle" } : state.resume,
				draft: state.draft && shown(state.draft.view) ? state.draft : null,
			};
		}
		case "launch":
			return { ...state, launch: action.launch };
		case "dismiss-launch":
			return state.launch.phase === "failed" ? { ...state, launch: { phase: "idle" } } : state;
		case "fork":
			return { ...state, fork: action.fork };
		case "resume":
			return { ...state, resume: action.resume };
		case "server": {
			const msg = action.msg;
			switch (msg.t) {
				case "roster":
					return {
						...state,
						hosts: msg.hosts,
						rosterError: msg.error,
						lastHosts: rememberHosts(state.lastHosts, msg.hosts, state.layout),
					};
				case "past":
					return { ...state, past: msg.sessions, listed: true };
				case "items":
					return updatePane(state, msg.view, pane => ({ ...pane, items: applyItems(pane.items, msg.reset, msg.items) }));
				case "created":
					if (state.launch.phase !== "starting") return state;
					if (!msg.result.ok) return { ...state, launch: { phase: "failed", error: msg.result.error } };
					return { ...state, launch: { phase: "idle" }, started: { instanceId: msg.result.instanceId, cwd: msg.result.cwd } };
				case "forked": {
					const fork = state.fork;
					if (fork.phase !== "forking") return state;
					if (!msg.result.ok) return { ...state, fork: { phase: "failed", view: fork.view, itemId: fork.itemId, error: msg.result.error } };
					const view: LiveView = { kind: "live", instanceId: msg.result.instanceId, agentId: null };
					return {
						...state,
						fork: { phase: "idle" },
						draft: { view, text: fork.point.prefill ? msg.result.prompt : "" },
						started: { instanceId: msg.result.instanceId, cwd: msg.result.cwd },
					};
				}
				case "resumed": {
					const { resume } = state;
					if (resume.phase !== "resuming" || resume.sessionId !== msg.sessionId) return state;
					if (!msg.result.ok) return { ...state, resume: { phase: "failed", sessionId: msg.sessionId, error: msg.result.error } };
					return { ...state, resume: { phase: "idle" }, started: { instanceId: msg.result.instanceId, cwd: msg.result.cwd } };
				}
				case "completions": {
					const completions = { reqId: msg.reqId, items: msg.items, error: msg.error };
					return msg.scope.kind === "new"
						? { ...state, newSessionCompletions: completions }
						: updatePane(state, msg.scope.view, pane => ({ ...pane, completions }));
				}
				case "usage":
					return { ...state, usage: { plans: msg.plans, error: msg.error } };
				case "models":
					if (!liveIds(state.layout).includes(msg.instanceId)) return state;
					return { ...state, models: new Map(state.models).set(msg.instanceId, { models: msg.models, error: msg.error }) };
				case "dequeued":
					return updatePane(state, msg.view, pane => ({ ...pane, dequeued: { reqId: msg.reqId, texts: msg.texts } }));
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
	/** Start omp in `cwd` with `prompt` as its first message; the session opens in the focused pane once ready. */
	create: (cwd: string, prompt: string) => void;
	/** Fork `view` at a message's fork point; the forked session opens in the focused pane once ready. */
	fork: (view: View, itemId: string, point: ForkPoint) => void;
	/** Continue past session `sessionId`; its panes show the live session once omp is ready. */
	resume: (sessionId: string) => void;
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
		panes: new Map(),
		lastHosts: new Map(),
		launch: { phase: "idle" },
		newSessionCompletions: null,
		fork: { phase: "idle" },
		resume: { phase: "idle" },
		draft: null,
		started: null,
		usage: null,
		models: new Map(),
	});
	const socketRef = useRef<WebSocket | null>(null);
	const layoutRef = useRef(state.layout);
	layoutRef.current = state.layout;

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
				ws.send(JSON.stringify({ t: "watch", views: layoutRef.current.panes } satisfies ClientMsg));
			};
			ws.onmessage = event => {
				const msg = JSON.parse(String(event.data)) as ServerMsg;
				dispatch({ t: "server", msg });
				if ((msg.t === "created" || msg.t === "forked") && msg.result.ok) {
					open({ kind: "live", instanceId: msg.result.instanceId, agentId: null }, "replace");
				}
				if (msg.t === "resumed" && msg.result.ok) {
					show(swapView(layoutRef.current, { kind: "past", sessionId: msg.sessionId }, { kind: "live", instanceId: msg.result.instanceId, agentId: null }));
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
	const hash = useHash();
	useEffect(() => {
		const sessionId = sessionFromHash(location.hash);
		if (sessionId === null || !state.listed) return;
		const layout = openView(layoutRef.current, viewForSession(sessionId, state.hosts), "replace");
		history.replaceState(null, "", hashForLayout(layout));
		dispatch({ t: "layout", layout });
	}, [hash, state.listed, state.hosts]);

	useEffect(() => {
		send({ t: "watch", views: state.layout.panes });
	}, [send, state.layout.panes]);

	const openNewSession = useCallback(() => {
		dispatch({ t: "dismiss-launch" });
		location.hash = hashForNewSession(null);
	}, []);

	const create = useCallback(
		(cwd: string, prompt: string) => {
			dispatch({ t: "launch", launch: { phase: "starting" } });
			send({ t: "create", cwd, prompt });
		},
		[send],
	);

	const fork = useCallback(
		(view: View, itemId: string, point: ForkPoint) => {
			dispatch({ t: "fork", fork: { phase: "forking", view, itemId, point } });
			send({ t: "fork", view, entryId: point.entryId });
		},
		[send],
	);

	const resume = useCallback(
		(sessionId: string) => {
			dispatch({ t: "resume", resume: { phase: "resuming", sessionId } });
			send({ t: "resume", sessionId });
		},
		[send],
	);

	return { state, send, open, focus, show, openNewSession, create, fork, resume };
}
