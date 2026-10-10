import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { PinChange } from "../src/shared/pins";
import type { ClientFrame, ClientMsg, ServerMsg } from "../src/shared/protocol";
import type { View } from "../src/shared/sessions";
import type { UserTodoChange } from "../src/user-todos-shared";
import { socketUrl } from "./api";
import { type DashboardState, initialState, reduce, type ServerAction } from "./dashboard-state";
import { applyPaneMessage, retainPanes } from "./pane-store";
import {
	hashForLayout,
	hashForPage,
	type Layout,
	layoutAfterResumeAll,
	layoutAfterStart,
	type OpenMode,
	openView,
	type Page,
	routeFromHash,
	viewForSession,
} from "./routing";
import { messageOf, pendingStart, type StartKind, type StartOp } from "./starts";

const NO_VIEWS: View[] = [];

const CONNECTION_LOST = "Lost the connection to the server before it answered.";

/** Where an older page kept the pins, in each browser's localStorage, before the server kept them. */
const STORED_PINS_KEY = "omp-agents.pinned-sessions";

/** Hands the server the pins this browser kept, then forgets them; pinning twice pins once, so two windows doing it at once agree. */
function sendStoredPins(ws: WebSocket): void {
	const raw = localStorage.getItem(STORED_PINS_KEY);
	if (raw === null) return;
	let stored: unknown = null;
	try {
		stored = JSON.parse(raw);
	} catch {
	}
	const sessionIds = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string" && id !== "") : [];
	if (sessionIds.length > 0) ws.send(JSON.stringify({ t: "pin", change: { op: "pin", sessionIds } } satisfies ClientMsg));
	localStorage.removeItem(STORED_PINS_KEY);
}

/** Dashboard state plus the ways the page talks back. */
export interface Dashboard {
	state: DashboardState;
	/** The page covering the panes; `null` while the panes show. */
	page: Page | null;
	send: (msg: ClientMsg) => void;
	/** Send `msg` and settle once the server has handled it: rejects with the server's error, or at once while disconnected. */
	request: (msg: ClientMsg) => Promise<void>;
	/** End live session `instanceId`, which counts as ending until the server answers; rejects with why it could not. */
	end: (instanceId: string) => Promise<void>;
	/** Show `view` in the focused pane, or in a new pane for `split`. */
	open: (view: View, mode: OpenMode) => void;
	focus: (index: number) => void;
	/** Show `layout`, as a new history entry. */
	show: (layout: Layout) => void;
	/** Show `page` over the panes, as a new history entry. */
	navigate: (page: Page) => void;
	/** Open the new-session draft in the default directory, clearing a failed start's error. */
	openNewSession: () => void;
	/** Forget the error of a failed start of `kind`. */
	dismissStart: (kind: StartKind) => void;
	/**
	 * Start a session; it opens in the focused pane once ready, and a resumed one in the pane of the past session it
	 * continues. A quick action's session runs in the background, and the page stays where it is. A **Resume all** shows
	 * each session it resumes live in the pane that shows it.
	 */
	start: (op: StartOp) => void;
	/** Change the Todo page's list, which shows at once and reaches the server and every other window. */
	changeTodo: (change: UserTodoChange) => void;
	/** Pin or unpin sessions, which shows at once and reaches the server and every other window. */
	changePins: (change: PinChange) => void;
}

/** Live dashboard state over the server's WebSocket; the panes live in the URL hash. */
export function useDashboard(): Dashboard {
	const [state, dispatch] = useReducer(reduce, null, () => initialState(routeFromHash(location.hash)));
	const socketRef = useRef<WebSocket | null>(null);
	const layoutRef = useRef(state.layout);
	layoutRef.current = state.layout;
	// What the page asked to start when the last answer was rendered; a server answer finds its start here before the render that settles it.
	const startsRef = useRef(state.starts);
	startsRef.current = state.starts;
	const page = state.cover?.kind === "page" ? state.cover.page : null;
	// A page covering the panes shows none of them, so the server stops streaming them until the panes return. The
	// Changes page of a live session watches that session, whose `work` tells the page when its calls changed a file.
	const changesOf = page?.kind === "changes" ? (state.hosts.find(host => host.sessionId === page.sessionId)?.instanceId ?? null) : null;
	const watched = useMemo<View[]>(
		() => (changesOf !== null ? [{ kind: "live", instanceId: changesOf, agentId: null }] : page ? NO_VIEWS : state.layout.panes),
		[changesOf, page, state.layout.panes],
	);
	const watchedRef = useRef(watched);
	watchedRef.current = watched;

	const send = useCallback((msg: ClientMsg) => {
		const ws = socketRef.current;
		if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
	}, []);

	const acks = useRef(new Map<number, { resolve: () => void; reject: (error: Error) => void }>());
	const nextAck = useRef(0);
	const request = useCallback(
		(msg: ClientMsg) =>
			new Promise<void>((resolve, reject) => {
				const ws = socketRef.current;
				if (ws?.readyState !== WebSocket.OPEN) {
					reject(new Error("Not connected to the server."));
					return;
				}
				const ack = nextAck.current++;
				acks.current.set(ack, { resolve, reject });
				ws.send(JSON.stringify({ ...msg, ack } satisfies ClientFrame));
			}),
		[],
	);

	const end = useCallback(
		async (instanceId: string) => {
			dispatch({ t: "end", instanceId });
			try {
				await request({ t: "end", instanceId });
			} finally {
				dispatch({ t: "ended", instanceId });
			}
		},
		[request],
	);

	const show = useCallback((layout: Layout) => {
		location.hash = hashForLayout(layout);
		dispatch({ t: "route", route: { kind: "panes", layout } });
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
		const pending = acks.current;
		const abandon = (): void => {
			for (const { reject } of pending.values()) reject(new Error(CONNECTION_LOST));
			pending.clear();
		};
		// A start's answer settles it, then the panes follow the start as it was before.
		const answer = (msg: ServerAction, layout: Layout | null): void => {
			dispatch(msg);
			if (layout) show(layout);
		};
		let retryMs = 500;
		let timer: number | undefined;
		let disposed = false;
		const connect = (): void => {
			const ws = new WebSocket(socketUrl("/ws"));
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
					case "media":
					case "withdrawn":
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
					case "routines":
					case "workspaces":
					case "projects":
					case "notices":
						dispatch(msg);
						return;
					case "done": {
						const waiting = pending.get(msg.ack);
						pending.delete(msg.ack);
						if (msg.error === null) waiting?.resolve();
						else waiting?.reject(new Error(msg.error));
						return;
					}
					case "pins":
						dispatch(msg);
						sendStoredPins(ws);
						return;
					default: {
						const never: never = msg;
						return never;
					}
				}
			};
			ws.onclose = () => {
				if (disposed) return;
				abandon();
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
			abandon();
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
	useEffect(() => retainPanes([...state.layout.panes, ...watched]), [watched, state.layout.panes]);

	useEffect(() => {
		send({ t: "watch", views: watched });
	}, [send, watched]);

	const dismissStart = useCallback((kind: StartKind) => dispatch({ t: "dismiss-start", kind }), []);

	const openNewSession = useCallback(() => {
		dispatch({ t: "dismiss-start", kind: "new" });
		navigate({ kind: "new", cwd: null, todoId: null });
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
	const changePins = useCallback(
		(change: PinChange) => {
			dispatch({ t: "pin", change });
			send({ t: "pin", change });
		},
		[send],
	);

	return { state, page, send, request, end, open, focus, show, navigate, openNewSession, dismissStart, start, changeTodo, changePins };
}
