import { useCallback, useEffect, useReducer, useRef } from "react";
import type { ClientMsg, ServerMsg, UserTodoChange, View } from "../src/shared";
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
	/** Change the Todo page's list, which shows at once and reaches the server and every other window. */
	changeTodo: (change: UserTodoChange) => void;
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
