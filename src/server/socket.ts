/** What the server does with each message a page sends over its socket. */
import { complete } from "../commands";
import { errorText } from "../json";
import { directoryOf } from "../paths";
import type { ClientMsg, ServerMsg, StartRequest, StartResult, UserTodoChange } from "../shared";
import type { LiveSessions } from "./live-sessions";
import { type Socket, send, type Views, watching } from "./views";
import type { MsgOf } from "./wire";

export interface SocketEnv {
	sessions: LiveSessions;
	views: Views;
	start(request: StartRequest): Promise<StartResult>;
	/** Move interrupted session `sessionId` to the past sessions. */
	dismissInterrupted(sessionId: string): void;
	/** Whether interrupted session `sessionId` stopped while its turn ran. */
	stoppedMidTurn(sessionId: string): boolean;
	/** Apply `change` to the Todo tab's list and send every socket the list after it, or, when it changes nothing, send `ws` the list it missed. */
	changeTodo(ws: Socket, change: UserTodoChange): void;
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
	async dequeue({ sessions }, ws, { view, messages, reqId }) {
		const session = sessions.get(view.instanceId);
		if (!session) return;
		// Every removal reaches the session before an abort sent right after this, so none of them runs after the interrupt.
		const taken = await Promise.all(messages.map(({ queue, text }) => session.dequeue(view.agentId, queue, text)));
		const texts = messages.filter((_, index) => taken[index]).map(({ text }) => text);
		if (texts.length > 0) reply(ws, view.instanceId, { t: "dequeued", view, reqId, texts });
	},
	async complete({ sessions }, ws, { scope, reqId, text, cursor }) {
		// A live view completes as its session; a draft as a session not started yet in its cwd.
		if (scope.kind === "new") {
			const cwd = directoryOf(scope.cwd);
			if (!cwd) {
				send(ws, { t: "completions", scope, reqId, items: [], error: `${scope.cwd.trim()} is not a directory.` });
				return;
			}
			try {
				send(ws, { t: "completions", scope, reqId, items: await complete(null, cwd, text, cursor), error: null });
			} catch (error) {
				send(ws, { t: "completions", scope, reqId, items: [], error: errorText(error) });
			}
			return;
		}
		const session = sessions.get(scope.view.instanceId);
		if (!session) return;
		try {
			const items = await complete(session.instanceId, session.cwd, text, cursor);
			reply(ws, session.instanceId, { t: "completions", scope, reqId, items, error: null });
		} catch (error) {
			reply(ws, session.instanceId, { t: "completions", scope, reqId, items: [], error: errorText(error) });
		}
	},
	abort: ({ sessions }, _ws, { instanceId }) => sessions.get(instanceId)?.abort(),
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
	async end({ sessions }, _ws, { instanceId }) {
		await sessions.get(instanceId)?.end();
	},
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
	answer: ({ sessions }, _ws, { instanceId, requestId, answer }) => sessions.get(instanceId)?.answer(requestId, answer),
	"user-todo": ({ changeTodo }, ws, { change }) => changeTodo(ws, change),
};

/** `t` keys the handler that takes `msg`; spelled apart so TypeScript pairs them. */
async function dispatch<T extends ClientMsg["t"]>(env: SocketEnv, ws: Socket, t: T, msg: MsgOf<T>): Promise<void> {
	await clientHandlers[t](env, ws, msg);
}

export function createClientHandler(env: SocketEnv): (ws: Socket, msg: ClientMsg) => Promise<void> {
	return (ws, msg) => dispatch(env, ws, msg.t, msg);
}
