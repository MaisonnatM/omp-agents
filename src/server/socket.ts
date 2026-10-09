/** What the server does with each message a page sends over its socket. */
import { complete } from "../commands";
import { errorText } from "../json";
import { directoryOf } from "../paths";
import type { RoutineChange } from "../routines";
import type { NoticeOp } from "../shared/notices";
import type { PinChange } from "../shared/pins";
import type { ClientFrame, ClientMsg, ServerMsg } from "../shared/protocol";
import type { StartRequest, StartResult } from "../shared/sessions";
import type { UserTodoChange } from "../user-todos-shared";
import type { LiveSessions } from "./live-sessions";
import { type Socket, send, type Views, watching } from "./views";
import type { MsgOf } from "./wire";

export interface SocketEnv {
	sessions: LiveSessions;
	views: Views;
	start(request: StartRequest): Promise<StartResult>;
	/** End live session `instanceId` as **End session** does, then remove the git worktree it worked in. */
	end(instanceId: string): Promise<void>;
	/** Move interrupted session `sessionId` to the past sessions. */
	dismissInterrupted(sessionId: string): void;
	/** Whether interrupted session `sessionId` stopped while its turn ran. */
	stoppedMidTurn(sessionId: string): boolean;
	/** Apply `change` to the Todo page's list and send every socket the list after it, or, when it changes nothing, send `ws` the list it missed. */
	changeTodo(ws: Socket, change: UserTodoChange): void;
	/** Apply `change` to the routines and send every socket the routines after it, or, when it changes nothing, send `ws` the routines it missed. */
	changeRoutine(ws: Socket, change: Exclude<RoutineChange, { op: "run-now" }>): void;
	/** Run routine `id` now, whatever its schedule. */
	runRoutine(id: string): Promise<void>;
	/** Apply `change` to the pins; every socket then gets the pins as they are after, and `ws` gets them even when nothing changed. */
	changePins(ws: Socket, change: PinChange): void;
	/** Act on notices `ids`; every socket then gets the notices as they are after. */
	changeNotices(ids: string[], op: NoticeOp): Promise<void>;
}

/**
 * A reply that follows an await goes only to a socket still showing the session: it may have moved on, and
 * a late answer would land in a view that no longer expects it. Replies sent at once need no such check.
 */
function reply(ws: Socket, instanceId: string, msg: ServerMsg): void {
	if (watching(ws, instanceId)) send(ws, msg);
}

/** Each socket message's handler, by its `t`, so a {@link ClientMsg} variant without one does not compile. A message naming a session that is gone does nothing. */
const clientHandlers: { [T in ClientMsg["t"]]: (env: SocketEnv, ws: Socket, msg: MsgOf<T>) => Promise<void> | void } = {
	watch: ({ views }, ws, msg) => views.watch(ws, msg.views),
	async prompt({ sessions }, ws, { view, text, images, delivery }) {
		try {
			await sessions.get(view.instanceId)?.prompt(view.agentId, text, images, delivery);
		} catch (error) {
			reply(ws, view.instanceId, {
				t: "items",
				view,
				reset: false,
				items: [{ id: `error:${Date.now()}`, kind: "notice", level: "error", text: `Could not prepare prompt: ${errorText(error)}` }],
			});
		}
	},
	async dequeue({ sessions }, ws, { view, reqId, queue, text }) {
		const message = await sessions.get(view.instanceId)?.dequeue(view.agentId, queue, text);
		if (message) reply(ws, view.instanceId, { t: "withdrawn", view, reqId, messages: [message] });
	},
	async promote({ sessions }, _ws, { view, text }) {
		await sessions.get(view.instanceId)?.promote(view.agentId, text);
	},
	async interrupt({ sessions }, ws, { view, reqId }) {
		const messages = (await sessions.get(view.instanceId)?.interrupt()) ?? [];
		if (messages.length > 0) reply(ws, view.instanceId, { t: "withdrawn", view, reqId, messages });
	},
	async complete({ sessions }, ws, { scope, reqId, text, cursor }) {
		// A live view completes as its session; a draft as a session not started yet in its cwd.
		let target: { instanceId: string | null; cwd: string };
		if (scope.kind === "new") {
			const cwd = directoryOf(scope.cwd);
			if (!cwd) {
				send(ws, { t: "completions", scope, reqId, items: [], error: `${scope.cwd.trim()} is not a directory.` });
				return;
			}
			target = { instanceId: null, cwd };
		} else {
			const session = sessions.get(scope.view.instanceId);
			if (!session) return;
			target = session;
		}
		const { instanceId, cwd } = target;
		const deliver = (msg: ServerMsg): void => (instanceId === null ? send(ws, msg) : reply(ws, instanceId, msg));
		try {
			deliver({ t: "completions", scope, reqId, items: await complete(instanceId, cwd, text, cursor), error: null });
		} catch (error) {
			deliver({ t: "completions", scope, reqId, items: [], error: errorText(error) });
		}
	},
	flush: ({ sessions }, _ws, { instanceId }) => sessions.get(instanceId)?.flush(),
	"edit-prompt": ({ sessions }, _ws, { instanceId, entryId, text }) => sessions.started(instanceId)?.editPrompt(entryId, text),
	"cancel-agent": ({ sessions }, _ws, { view }) => sessions.get(view.instanceId)?.cancelAgent(view.agentId),
	async start({ start }, ws, msg) {
		send(ws, { t: "started", reqId: msg.reqId, result: await start(msg) });
	},
	async "resume-all"({ sessions, start, stoppedMidTurn }, ws, { reqId, sessionIds }) {
		const results = await Promise.all(
			sessionIds.map(async sessionId => {
				// Read before the resume, which takes the session off the interrupted list.
				const midTurn = stoppedMidTurn(sessionId);
				const result = await start({ kind: "resume", sessionId });
				// omp records the cut-off turn as aborted on resume; a plain prompt picks the work back up.
				if (result.ok && midTurn) void sessions.get(result.instanceId)?.prompt(null, "continue", [], "steer");
				return { sessionId, result };
			}),
		);
		send(ws, {
			t: "resumed-all",
			reqId,
			started: results.flatMap(({ sessionId, result }) => (result.ok ? [{ sessionId, instanceId: result.instanceId }] : [])),
			errors: results.flatMap(({ result }) => (result.ok ? [] : [result.error])),
		});
	},
	"dismiss-interrupted": ({ dismissInterrupted }, _ws, { sessionId }) => dismissInterrupted(sessionId),
	end: ({ end }, _ws, { instanceId }) => end(instanceId),
	async "list-models"({ sessions }, ws, { instanceId }) {
		const session = sessions.started(instanceId);
		if (!session) {
			reply(ws, instanceId, { t: "models", instanceId, models: [], error: "Only sessions started from this dashboard can switch models." });
			return;
		}
		try {
			reply(ws, instanceId, { t: "models", instanceId, models: await session.models(), error: null });
		} catch (error) {
			reply(ws, instanceId, { t: "models", instanceId, models: [], error: errorText(error) });
		}
	},
	"set-model": ({ sessions }, _ws, { instanceId, model, thinking }) => sessions.started(instanceId)?.setModel(model, thinking),
	"set-thinking": ({ sessions }, _ws, { instanceId, level }) => sessions.started(instanceId)?.setThinking(level),
	"set-fast": ({ sessions }, _ws, { instanceId, enabled }) => sessions.started(instanceId)?.setFast(enabled),
	answer: ({ sessions }, _ws, { instanceId, requestId, answer }) => sessions.get(instanceId)?.answer(requestId, answer),
	"user-todo": ({ changeTodo }, ws, { change }) => changeTodo(ws, change),
	routine: ({ changeRoutine, runRoutine }, ws, { change }) => (change.op === "run-now" ? runRoutine(change.id) : changeRoutine(ws, change)),
	pin: ({ changePins }, ws, { change }) => changePins(ws, change),
	notice: ({ changeNotices }, _ws, { ids, op }) => changeNotices(ids, op),
};

/** `t` keys the handler that takes `msg`; spelled apart so TypeScript pairs them. */
async function dispatch<T extends ClientMsg["t"]>(env: SocketEnv, ws: Socket, t: T, msg: MsgOf<T>): Promise<void> {
	await clientHandlers[t](env, ws, msg);
}

/** Handles one message; one tagged `ack` then gets `done`, with the error when its handler threw, which it still throws for the server to log. */
export function createClientHandler(env: SocketEnv): (ws: Socket, frame: ClientFrame) => Promise<void> {
	return async (ws, frame) => {
		const { ack } = frame;
		if (ack === undefined) return dispatch(env, ws, frame.t, frame);
		try {
			await dispatch(env, ws, frame.t, frame);
		} catch (error) {
			send(ws, { t: "done", ack, error: errorText(error) });
			throw error;
		}
		send(ws, { t: "done", ack, error: null });
	};
}
