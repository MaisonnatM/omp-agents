import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ClientMsg, GuestPhase, Item, RosterHost, ServerMsg, View } from "../src/shared";
import { applyItems, hashForView, sameView, viewFromHash } from "./view-model";

export interface DashboardState {
	connected: boolean;
	ompVersion: string | null;
	hosts: RosterHost[];
	rosterError: string | null;
	phases: Record<string, GuestPhase>;
	view: View | null;
	/** Last roster row seen for the selected session, kept after it leaves the roster. */
	viewHost: RosterHost | null;
	/** Transcript of the selected view. */
	items: Item[];
}

type Action = { t: "connected"; connected: boolean } | { t: "server"; msg: ServerMsg } | { t: "select"; view: View | null };

const findHost = (hosts: RosterHost[], view: View | null): RosterHost | null =>
	view ? (hosts.find(host => host.instanceId === view.instanceId) ?? null) : null;

function reduce(state: DashboardState, action: Action): DashboardState {
	switch (action.t) {
		case "connected":
			return { ...state, connected: action.connected };
		case "select":
			if (sameView(state.view, action.view)) return state;
			return { ...state, view: action.view, viewHost: findHost(state.hosts, action.view), items: [] };
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
				case "phase":
					return { ...state, phases: { ...state.phases, [msg.instanceId]: msg.phase } };
				case "items":
					if (!sameView(msg.view, state.view)) return state;
					return { ...state, items: applyItems(state.items, msg.reset, msg.items) };
			}
		}
	}
}

/** Dashboard state plus the two ways the page talks back. */
export interface Dashboard {
	state: DashboardState;
	send: (msg: ClientMsg) => void;
	select: (view: View) => void;
}

/** Live dashboard state over the server's WebSocket; selection lives in the URL hash. */
export function useDashboard(): Dashboard {
	const [state, dispatch] = useReducer(reduce, {
		connected: false,
		ompVersion: null,
		hosts: [],
		rosterError: null,
		phases: {},
		view: viewFromHash(location.hash),
		viewHost: null,
		items: [],
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
			ws.onmessage = event => dispatch({ t: "server", msg: JSON.parse(String(event.data)) as ServerMsg });
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

	return { state, send, select };
}
