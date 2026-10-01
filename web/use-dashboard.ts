import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ClientMsg, GuestPhase, Item, PastSession, RosterHost, ServerMsg, View } from "../src/shared";
import { applyItems, hashForView, sameView, viewFromHash } from "./view-model";

/** The New session form: closed, open for a directory (with the last attempt's error), or waiting for the session to be listed. */
export type Launch = { phase: "closed" } | { phase: "editing"; error: string | null } | { phase: "starting" };

export interface DashboardState {
	connected: boolean;
	ompVersion: string | null;
	hosts: RosterHost[];
	rosterError: string | null;
	/** Sessions without a live host, newest first. */
	past: PastSession[];
	phases: Record<string, GuestPhase>;
	view: View | null;
	/** Last roster row seen for the selected live session, kept after it leaves the roster. */
	viewHost: RosterHost | null;
	/** Transcript of the selected view. */
	items: Item[];
	launch: Launch;
}

type Action =
	| { t: "connected"; connected: boolean }
	| { t: "server"; msg: ServerMsg }
	| { t: "select"; view: View | null }
	| { t: "launch"; launch: Launch };

const findHost = (hosts: RosterHost[], view: View | null): RosterHost | null =>
	view?.kind === "live" ? (hosts.find(host => host.instanceId === view.instanceId) ?? null) : null;

function reduce(state: DashboardState, action: Action): DashboardState {
	switch (action.t) {
		case "connected": {
			// The answer to a pending `create` went to the socket that just closed.
			const launch: Launch =
				!action.connected && state.launch.phase === "starting"
					? { phase: "editing", error: "Lost the dashboard server while the session was starting. It may still appear." }
					: state.launch;
			return { ...state, connected: action.connected, launch };
		}
		case "select":
			if (sameView(state.view, action.view)) return state;
			return { ...state, view: action.view, viewHost: findHost(state.hosts, action.view), items: [] };
		case "launch":
			return { ...state, launch: action.launch };
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
				case "phase":
					return { ...state, phases: { ...state.phases, [msg.instanceId]: msg.phase } };
				case "items":
					if (!sameView(msg.view, state.view)) return state;
					return { ...state, items: applyItems(state.items, msg.reset, msg.items) };
				case "created":
					if (state.launch.phase !== "starting") return state;
					return { ...state, launch: msg.result.ok ? { phase: "closed" } : { phase: "editing", error: msg.result.error } };
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
}

/** Live dashboard state over the server's WebSocket; selection lives in the URL hash. */
export function useDashboard(): Dashboard {
	const [state, dispatch] = useReducer(reduce, {
		connected: false,
		ompVersion: null,
		hosts: [],
		rosterError: null,
		past: [],
		phases: {},
		view: viewFromHash(location.hash),
		viewHost: null,
		items: [],
		launch: { phase: "closed" },
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
				if (msg.t === "created" && msg.result.ok) {
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

	return { state, send, select, setLaunchOpen, create };
}
