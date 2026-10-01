import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ClientMsg, CompletionItem, Item, LiveView, ModelOption, PastSession, PlanUsage, RosterHost, ServerMsg, View } from "../src/shared";
import { applyItems, type ForkPoint, hashForView, sameView, viewFromHash } from "./view-model";

/** The New session form: closed, open for a directory (with the last attempt's error), or waiting for the session to start. */
export type Launch = { phase: "closed" } | { phase: "editing"; error: string | null } | { phase: "starting" };

/** A fork from a message of the selected view: none, waiting for the forked session, or failed with the reason. */
export type Fork =
	| { phase: "idle" }
	| { phase: "forking"; itemId: string; point: ForkPoint }
	| { phase: "failed"; itemId: string; error: string };

export interface DashboardState {
	connected: boolean;
	ompVersion: string | null;
	hosts: RosterHost[];
	rosterError: string | null;
	/** Sessions without a live host, newest first. */
	past: PastSession[];
	view: View | null;
	/** Last roster row seen for the selected live session, kept after it leaves the roster. */
	viewHost: RosterHost | null;
	/** Transcript of the selected view. */
	items: Item[];
	launch: Launch;
	fork: Fork;
	/** Composer text for a forked session's first mount. */
	draft: { view: LiveView; text: string } | null;
	completions: { reqId: number; items: CompletionItem[]; error: string | null } | null;
	/** `null` until the server's first `omp usage` run finishes. */
	usage: { plans: PlanUsage[]; error: string | null } | null;
	/** Last model list the server sent, for the session named by `instanceId`. */
	models: { instanceId: string; models: ModelOption[]; error: string | null } | null;
}

type Action =
	| { t: "connected"; connected: boolean }
	| { t: "server"; msg: ServerMsg }
	| { t: "select"; view: View | null }
	| { t: "launch"; launch: Launch }
	| { t: "fork"; fork: Fork };

const findHost = (hosts: RosterHost[], view: View | null): RosterHost | null =>
	view?.kind === "live" ? (hosts.find(host => host.instanceId === view.instanceId) ?? null) : null;

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
					? { phase: "failed", itemId: state.fork.itemId, error: "Lost the dashboard server while forking. The fork may still appear." }
					: state.fork;
			return { ...state, connected: action.connected, launch, fork };
		}
		case "select":
			if (sameView(state.view, action.view)) return state;
			return {
				...state,
				view: action.view,
				viewHost: findHost(state.hosts, action.view),
				items: [],
				completions: null,
				models: null,
				fork: state.fork.phase === "forking" ? state.fork : { phase: "idle" },
				draft: state.draft && sameView(state.draft.view, action.view) ? state.draft : null,
			};
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
						viewHost: findHost(msg.hosts, state.view) ?? state.viewHost,
					};
				case "past":
					return { ...state, past: msg.sessions };
				case "items":
					if (!sameView(msg.view, state.view)) return state;
					return { ...state, items: applyItems(state.items, msg.reset, msg.items) };
				case "created":
					if (state.launch.phase !== "starting") return state;
					return { ...state, launch: msg.result.ok ? { phase: "closed" } : { phase: "editing", error: msg.result.error } };
				case "forked": {
					const fork = state.fork;
					if (fork.phase !== "forking") return state;
					if (!msg.result.ok) return { ...state, fork: { phase: "failed", itemId: fork.itemId, error: msg.result.error } };
					const view: LiveView = { kind: "live", instanceId: msg.result.instanceId, agentId: null };
					return { ...state, fork: { phase: "idle" }, draft: { view, text: fork.point.prefill ? msg.result.prompt : "" } };
				}
				case "completions":
					return { ...state, completions: msg };
				case "usage":
					return { ...state, usage: { plans: msg.plans, error: msg.error } };
				case "models":
					return { ...state, models: msg };
			}
		}
	}
}

/** Dashboard state plus the ways the page talks back. */
export interface Dashboard {
	state: DashboardState;
	send: (msg: ClientMsg) => void;
	select: (view: View) => void;
	/** Open or close the New session form. */
	setLaunchOpen: (open: boolean) => void;
	create: (cwd: string) => void;
	/** Fork the selected view at a message's fork point; the forked session opens once ready. */
	fork: (itemId: string, point: ForkPoint) => void;
}

/** Live dashboard state over the server's WebSocket; selection lives in the URL hash. */
export function useDashboard(): Dashboard {
	const [state, dispatch] = useReducer(reduce, {
		connected: false,
		ompVersion: null,
		hosts: [],
		rosterError: null,
		past: [],
		view: viewFromHash(location.hash),
		viewHost: null,
		items: [],
		launch: { phase: "closed" },
		fork: { phase: "idle" },
		draft: null,
		completions: null,
		usage: null,
		models: null,
	});
	const socketRef = useRef<WebSocket | null>(null);
	const viewRef = useRef(state.view);
	viewRef.current = state.view;

	const send = useCallback((msg: ClientMsg) => {
		const ws = socketRef.current;
		if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
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
				ws.send(JSON.stringify({ t: "watch", view: viewRef.current } satisfies ClientMsg));
			};
			ws.onmessage = event => {
				const msg = JSON.parse(String(event.data)) as ServerMsg;
				dispatch({ t: "server", msg });
				if ((msg.t === "created" || msg.t === "forked") && msg.result.ok) {
					location.hash = hashForView({ kind: "live", instanceId: msg.result.instanceId, agentId: null });
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
	}, []);

	useEffect(() => {
		const onHash = (): void => dispatch({ t: "select", view: viewFromHash(location.hash) });
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);

	useEffect(() => {
		send({ t: "watch", view: state.view });
	}, [send, state.view]);

	const select = useCallback((view: View) => {
		location.hash = hashForView(view);
	}, []);

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
		(itemId: string, point: ForkPoint) => {
			const view = viewRef.current;
			if (!view) return;
			dispatch({ t: "fork", fork: { phase: "forking", itemId, point } });
			send({ t: "fork", view, entryId: point.entryId });
		},
		[send],
	);

	return { state, send, select, setLaunchOpen, create, fork };
}
