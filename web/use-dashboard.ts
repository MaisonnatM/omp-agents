import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ClientMsg, CompletionItem, Item, LiveView, ModelOption, PastSession, PlanUsage, RosterHost, ServerMsg, View } from "../src/shared";
import {
	applyItems,
	EMPTY_LAYOUT,
	type ForkPoint,
	hashForLayout,
	hashForView,
	type Layout,
	layoutFromHash,
	type OpenMode,
	openView,
	sameView,
} from "./view-model";

/** The New session form: closed, open for a directory (with the last attempt's error), or waiting for the session to start. */
export type Launch = { phase: "closed" } | { phase: "editing"; error: string | null } | { phase: "starting" };

/** A fork from a message of `view`: none, waiting for the forked session, or failed with the reason. One runs at a time. */
export type Fork =
	| { phase: "idle" }
	| { phase: "forking"; view: View; itemId: string; point: ForkPoint }
	| { phase: "failed"; view: View; itemId: string; error: string };

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
}

export const EMPTY_PANE: PaneData = { items: [], completions: null };

export interface DashboardState {
	connected: boolean;
	ompVersion: string | null;
	hosts: RosterHost[];
	rosterError: string | null;
	/** Sessions without a live host, newest first. */
	past: PastSession[];
	layout: Layout;
	/** Per open view, by {@link hashForView}. */
	panes: Map<string, PaneData>;
	/** Last roster row seen for each open live session, by instance id, kept after it leaves the roster. */
	lastHosts: Map<string, RosterHost>;
	launch: Launch;
	fork: Fork;
	/** Composer text for a forked session's first mount. */
	draft: { view: LiveView; text: string } | null;
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
	| { t: "fork"; fork: Fork };

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
			// The answer to a pending `create` or `fork` went to the socket that just closed.
			const launch: Launch =
				!action.connected && state.launch.phase === "starting"
					? { phase: "editing", error: "Lost the dashboard server while the session was starting. It may still appear." }
					: state.launch;
			const fork: Fork =
				!action.connected && state.fork.phase === "forking"
					? { phase: "failed", view: state.fork.view, itemId: state.fork.itemId, error: "Lost the dashboard server while forking. The fork may still appear." }
					: state.fork;
			return { ...state, connected: action.connected, launch, fork };
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
				draft: state.draft && shown(state.draft.view) ? state.draft : null,
			};
		}
		case "launch":
			return { ...state, launch: action.launch };
		case "fork":
			return { ...state, fork: action.fork };
		case "server": {
			const msg = action.msg;
			switch (msg.t) {
				case "hello":
					return { ...state, ompVersion: msg.ompVersion };
				case "roster":
					return {
						...state,
						hosts: msg.hosts,
						rosterError: msg.error,
						lastHosts: rememberHosts(state.lastHosts, msg.hosts, state.layout),
					};
				case "past":
					return { ...state, past: msg.sessions };
				case "items":
					return updatePane(state, msg.view, pane => ({ ...pane, items: applyItems(pane.items, msg.reset, msg.items) }));
				case "created":
					if (state.launch.phase !== "starting") return state;
					return { ...state, launch: msg.result.ok ? { phase: "closed" } : { phase: "editing", error: msg.result.error } };
				case "forked": {
					const fork = state.fork;
					if (fork.phase !== "forking") return state;
					if (!msg.result.ok) return { ...state, fork: { phase: "failed", view: fork.view, itemId: fork.itemId, error: msg.result.error } };
					const view: LiveView = { kind: "live", instanceId: msg.result.instanceId, agentId: null };
					return { ...state, fork: { phase: "idle" }, draft: { view, text: fork.point.prefill ? msg.result.prompt : "" } };
				}
				case "completions":
					return updatePane(state, msg.view, pane => ({ ...pane, completions: { reqId: msg.reqId, items: msg.items, error: msg.error } }));
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
	/** Open or close the New session form. */
	setLaunchOpen: (open: boolean) => void;
	create: (cwd: string) => void;
	/** Fork `view` at a message's fork point; the forked session opens in the focused pane once ready. */
	fork: (view: View, itemId: string, point: ForkPoint) => void;
}

/** Live dashboard state over the server's WebSocket; the panes live in the URL hash. */
export function useDashboard(): Dashboard {
	const [state, dispatch] = useReducer(reduce, {
		connected: false,
		ompVersion: null,
		hosts: [],
		rosterError: null,
		past: [],
		layout: layoutFromHash(location.hash) ?? EMPTY_LAYOUT,
		panes: new Map(),
		lastHosts: new Map(),
		launch: { phase: "closed" },
		fork: { phase: "idle" },
		draft: null,
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
	}, [open]);

	useEffect(() => {
		const onHash = (): void => {
			const layout = layoutFromHash(location.hash);
			if (layout) dispatch({ t: "layout", layout });
		};
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);

	useEffect(() => {
		send({ t: "watch", views: state.layout.panes });
	}, [send, state.layout.panes]);

	const setLaunchOpen = useCallback((open: boolean) => {
		dispatch({ t: "launch", launch: open ? { phase: "editing", error: null } : { phase: "closed" } });
	}, []);

	const create = useCallback(
		(cwd: string) => {
			dispatch({ t: "launch", launch: { phase: "starting" } });
			send({ t: "create", cwd });
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

	return { state, send, open, focus, show, setLaunchOpen, create, fork };
}
