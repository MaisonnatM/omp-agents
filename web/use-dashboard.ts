import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import type { BotChange } from "../src/shared/bots";
import type { PinChange } from "../src/shared/pins";
import type { AckedFrame, ClientMsg, ResumeFrame, ServerMsg } from "../src/shared/protocol";
import type { View } from "../src/shared/sessions";
import type { UserNoteChange } from "../src/user-notes-shared";
import type { UserTodoChange } from "../src/user-todos-shared";
import { errorText } from "../src/json";
import { openSocket } from "./api";
import { openBotView } from "./bots-model";
import { clearDraft, liveDraftKey, newDraftKey, putDraft } from "./composer-drafts";
import { type DashboardState, initialState, reduce, type ServerAction } from "./dashboard-state";
import { applyDiscussionMessage, discussionDisconnected } from "./discussions";
import { applyPaneMessage, retainPanes, retainTrajectories, useShownTrajectories } from "./pane-store";
import { DEFAULT_SPLIT_RATIOS, type SplitAxis, type SplitRatios } from "./pane-navigation";
import {
	hashForView,
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
import { adoptPreferences, sendPreferencesThrough, storedNumber, storedPreferences, storeOrRemove } from "./stored-state";
import { flushActivity, installActivity, record, recordAction, viewOf } from "./activity";

const NO_VIEWS: View[] = [];

const SPLIT_STORAGE_KEYS: Record<SplitAxis, string> = { columns: "omp-agents.split-columns", rows: "omp-agents.split-rows" };

function readSplitRatios(): SplitRatios {
	const read = (axis: SplitAxis): number => storedNumber(SPLIT_STORAGE_KEYS[axis], value => value > 0 && value < 1, DEFAULT_SPLIT_RATIOS[axis]);
	return { columns: read("columns"), rows: read("rows") };
}

const PAGE_ID = crypto.randomUUID();

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
	/**
	 * Send `msg` and settle once the server has handled it: rejects with the server's error, or at once while
	 * disconnected. It waits across a reconnect, which sends it again for the server to answer, never to run twice.
	 */
	request: (msg: ClientMsg) => Promise<void>;
	/** End live session `instanceId`, which counts as ending until the server answers; rejects with why it could not. */
	end: (instanceId: string, listed: string[]) => Promise<void>;
	/** Select a session and its remembered split, or explicitly edit the current split. */
	open: (view: View, mode: OpenMode) => void;
	focus: (index: number) => void;
	/** Show `layout`, as a new history entry. */
	show: (layout: Layout) => void;
	close: (index: number) => void;
	resize: (axis: SplitAxis, ratio: number) => void;
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
	/** Change the Notes page's list, which shows at once and reaches the server and every other window. */
	changeNote: (change: UserNoteChange) => void;
	/** Pin or unpin sessions, which shows at once and reaches the server and every other window. */
	changePins: (change: PinChange) => void;
	/** Add, change, or delete a Bot, which shows at once and reaches the server and every other window. */
	changeBot: (change: Exclude<BotChange, { op: "message" }>) => void;
}

/** Live dashboard state over the server's WebSocket; the panes live in the URL hash. */
export function useDashboard(): Dashboard {
	const [state, dispatch] = useReducer(reduce, null, () => initialState(routeFromHash(location.hash), readSplitRatios()));
	const socketRef = useRef<WebSocket | null>(null);
	const layoutRef = useRef(state.layout);
	layoutRef.current = state.layout;
	// What the page asked to start when the last answer was rendered; a server answer finds its start here before the render that settles it.
	const startsRef = useRef(state.starts);
	startsRef.current = state.starts;
	const page = state.cover?.kind === "page" ? state.cover.page : null;
	// A page covering the panes shows none of them, so the server streams only a Bot page's conversation until the panes return.
	const botConversation = openBotView(page, state.bots, state.hosts);
	// Keyed by its address, since openBotView builds a new view on each render.
	const botPane = botConversation && hashForView(botConversation);
	const watched = useMemo<View[]>(() => (!page ? state.layout.panes : botConversation ? [botConversation] : NO_VIEWS), [page, botPane, state.layout.panes]);
	const watchedRef = useRef(watched);
	watchedRef.current = watched;
	const shownTrajectories = useShownTrajectories();
	// A Trajectory streams only while its pane does.
	const trajectories = useMemo(() => {
		const shown = new Set(watched.map(hashForView));
		return shownTrajectories.filter(view => shown.has(hashForView(view)));
	}, [watched, shownTrajectories]);
	const trajectoriesRef = useRef(trajectories);
	trajectoriesRef.current = trajectories;

	const send = useCallback((msg: ClientMsg) => {
		const ws = socketRef.current;
		if (ws?.readyState !== WebSocket.OPEN) return;
		ws.send(JSON.stringify(msg));
		recordAction(msg);
	}, []);

	const outbox = useRef(new Map<number, { frame: AckedFrame; resolve: () => void; reject: (error: Error) => void }>());
	const nextAck = useRef(0);
	const request = useCallback((msg: ClientMsg) => {
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		const ws = socketRef.current;
		if (ws?.readyState !== WebSocket.OPEN) {
			reject(new Error("Not connected to the server."));
			return promise;
		}
		const ack = nextAck.current++;
		const frame: AckedFrame = { ...msg, ack, floor: Math.min(ack, ...outbox.current.keys()) };
		outbox.current.set(ack, { frame, resolve, reject });
		ws.send(JSON.stringify(frame));
		recordAction(msg);
		return promise;
	}, []);

	useEffect(() => installActivity({ connected: () => socketRef.current?.readyState === WebSocket.OPEN, send: batch => request(batch) }), [request]);
	useEffect(() => sendPreferencesThrough(change => send({ t: "preference", change })), [send]);
	const view = viewOf(state.cover, state.layout);
	useEffect(() => record("view", view), [view]);

	const end = useCallback(
		async (instanceId: string, listed: string[]) => {
			dispatch({ t: "end", instanceId });
			try {
				await request({ t: "end", instanceId });
				dispatch({ t: "end-success", instanceId, listed });
			} finally {
				dispatch({ t: "ended", instanceId });
			}
		},
		[request],
	);

	const show = useCallback((layout: Layout) => dispatch({ t: "panes", command: { kind: "edit", layout } }), []);
	const navigate = useCallback((next: Page) => dispatch({ t: "navigate", page: next }), []);
	const replace = useCallback((layout: Layout) => dispatch({ t: "panes", command: { kind: "edit", layout }, replace: true }), []);
	const open = useCallback((view: View, mode: OpenMode) => dispatch({ t: "panes", command: { kind: "select", view, mode } }), []);
	const focus = useCallback((index: number) => replace({ ...layoutRef.current, focus: index }), [replace]);
	const close = useCallback((index: number) => dispatch({ t: "panes", command: { kind: "close", index } }), []);
	const resize = useCallback((axis: SplitAxis, ratio: number) => dispatch({ t: "panes", command: { kind: "resize", axis, ratio } }), []);

	useLayoutEffect(() => {
		const write = state.historyWrite;
		if (!write || location.hash === write.hash) return;
		const url = write.hash || location.pathname + location.search;
		if (write.mode === "replace") history.replaceState(null, "", url);
		else history.pushState(null, "", url);
	}, [state.historyWrite]);

	useEffect(() => {
		for (const axis of ["columns", "rows"] as const) storeOrRemove(SPLIT_STORAGE_KEYS[axis], String(state.splits.ratios[axis]), String(DEFAULT_SPLIT_RATIOS[axis]));
	}, [state.splits.ratios]);

	useEffect(() => {
		// A start's answer settles it, then the panes follow the start as it was before.
		const answer = (msg: ServerAction, layout: Layout | null): void => {
			dispatch(msg);
			if (layout) show(layout);
		};
		let retryMs = 500;
		let timer: number | undefined;
		let disposed = false;
		/** The build of the server the page first reached; a later socket that reaches another build reloads the page into it. */
		let build: string | null = null;
		const connect = (): void => {
			const ws = openSocket(`/ws?page=${PAGE_ID}`);
			socketRef.current = ws;
			ws.onopen = () => {
				retryMs = 500;
				dispatch({ t: "connected", connected: true });
				ws.send(JSON.stringify({ t: "watch", views: watchedRef.current, trajectories: trajectoriesRef.current } satisfies ClientMsg));
				ws.send(JSON.stringify({ t: "resume", frames: [...outbox.current.values()].map(entry => entry.frame) } satisfies ResumeFrame));
				flushActivity();
			};
			ws.onmessage = event => {
				const msg = JSON.parse(String(event.data)) as ServerMsg;
				switch (msg.t) {
					case "build":
						if (build !== null && build !== msg.id) location.reload();
						build = msg.id;
						return;
					case "items":
					case "work":
					case "media":
					case "turns":
					case "withdrawn":
						applyPaneMessage(msg);
						return;
					case "completions":
						if (msg.scope.kind === "live") applyPaneMessage({ ...msg, scope: msg.scope });
						else dispatch({ t: "new-session-completions", completions: { reqId: msg.reqId, items: msg.items, error: msg.error } });
						return;
					case "started": {
						const start = pendingStart(startsRef.current, msg.reqId);
						if (start && msg.result.ok) {
							const { op } = start;
							// A fork's composer opens on the prompt it branched at, to edit, and a sent first message leaves the new-session draft.
							// Both are written before `answer` shows the layout, which mounts the fork's composer.
							if (op.kind === "fork" && op.point.prefill && msg.result.prompt) putDraft(liveDraftKey({ kind: "live", instanceId: msg.result.instanceId, agentId: null }), msg.result.prompt);
							if (op.kind === "new") clearDraft(newDraftKey(op.todoId));
						}
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
					case "user-notes":
					case "routines":
					case "bots":
					case "scheduled":
					case "workspaces":
					case "notices":
					case "merges":
					case "review-drafts":
						dispatch(msg);
						return;
					case "done": {
						const waiting = outbox.current.get(msg.ack);
						outbox.current.delete(msg.ack);
						if (msg.error === null) waiting?.resolve();
						else waiting?.reject(new Error(msg.error));
						return;
					}
					case "discussion":
						applyDiscussionMessage(msg);
						return;
					case "pins":
						dispatch(msg);
						sendStoredPins(ws);
						return;
					case "preferences":
						// A server that keeps none yet, as after an upgrade, takes what this browser kept; the first page to seed wins.
						if (msg.values === null) ws.send(JSON.stringify({ t: "preference", change: { op: "seed", values: storedPreferences() } } satisfies ClientMsg));
						else adoptPreferences(msg.values);
						return;
					default: {
						const never: never = msg;
						return never;
					}
				}
			};
			ws.onclose = () => {
				if (disposed) return;
				discussionDisconnected();
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
	useEffect(() => retainPanes([...state.layout.panes, ...watched]), [watched, state.layout.panes]);
	useEffect(() => retainTrajectories(trajectories), [trajectories]);

	useEffect(() => {
		send({ t: "watch", views: watched, trajectories });
	}, [send, watched, trajectories]);

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
			request(messageOf(op, reqId)).catch((error: unknown) => dispatch({ t: "start-failed", reqId, error: errorText(error) }));
		},
		[request],
	);
	const changeTodo = useCallback(
		(change: UserTodoChange) => {
			dispatch({ t: "user-todo", change });
			send({ t: "user-todo", change });
		},
		[send],
	);
	const changeNote = useCallback(
		(change: UserNoteChange) => {
			dispatch({ t: "user-note", change });
			send({ t: "user-note", change });
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
	const changeBot = useCallback(
		(change: Exclude<BotChange, { op: "message" }>) => {
			dispatch({ t: "bot", change, now: new Date().toISOString() });
			send({ t: "bot", change });
		},
		[send],
	);

	return { state, page, send, request, end, open, focus, show, close, resize, navigate, openNewSession, dismissStart, start, changeTodo, changeNote, changePins, changeBot };
}
