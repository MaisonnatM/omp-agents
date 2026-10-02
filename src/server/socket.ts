/** What the server does with each message a page sends over its socket. */
import { complete } from "../commands";
import { errorText } from "../json";
import { directoryOf } from "../paths";
import type { ClientMsg, ServerMsg, StartRequest, StartResult } from "../shared";
import type { LiveSessions } from "./live-sessions";
import { type Socket, send, type Views, watching } from "./views";

export interface SocketEnv {
	sessions: LiveSessions;
	views: Views;
	start(request: StartRequest): Promise<StartResult>;
	/** Move interrupted session `sessionId` to the past sessions. */
	dismissInterrupted(sessionId: string): void;
}

/**
 * A reply that follows an await goes only to a socket still showing the session: it may have moved on, and
 * a late answer would land in a view that no longer expects it. Replies sent at once need no such check.
 */
function reply(ws: Socket, instanceId: string, msg: ServerMsg): void {
	if (watching(ws, instanceId)) send(ws, msg);
}

/** The handler of one socket message. A message naming a session that is gone does nothing. */
export function createClientHandler({ sessions, views, start, dismissInterrupted }: SocketEnv): (ws: Socket, msg: ClientMsg) => Promise<void> {
	return async (ws, msg) => {
		switch (msg.t) {
			case "watch":
				views.watch(ws, msg.views);
				return;
			case "complete": {
				const { scope, reqId } = msg;
				// A live view completes as its session; a draft as a session not started yet in its cwd.
				if (scope.kind === "new") {
					const cwd = directoryOf(scope.cwd);
					if (!cwd) {
						send(ws, { t: "completions", scope, reqId, items: [], error: `${scope.cwd.trim()} is not a directory.` });
						return;
					}
					try {
						send(ws, { t: "completions", scope, reqId, items: await complete(null, cwd, msg.text, msg.cursor), error: null });
					} catch (error) {
						send(ws, { t: "completions", scope, reqId, items: [], error: errorText(error) });
					}
					return;
				}
				const session = sessions.get(scope.view.instanceId);
				if (!session) return;
				try {
					const items = await complete(session.instanceId, session.cwd, msg.text, msg.cursor);
					reply(ws, session.instanceId, { t: "completions", scope, reqId, items, error: null });
				} catch (error) {
					reply(ws, session.instanceId, { t: "completions", scope, reqId, items: [], error: errorText(error) });
				}
				return;
			}
			case "prompt": {
				const { view } = msg;
				try {
					await sessions.get(view.instanceId)?.prompt(view.agentId, msg.text, msg.delivery);
				} catch (error) {
					reply(ws, view.instanceId, {
						t: "items",
						view,
						reset: false,
						items: [{ id: `error:${Date.now()}`, kind: "notice", level: "error", text: `Could not prepare prompt: ${errorText(error)}` }],
					});
				}
				return;
			}
			case "dequeue": {
				const { view, messages } = msg;
				const session = sessions.get(view.instanceId);
				if (!session) return;
				// Every removal reaches the session before an abort sent right after this, so none of them runs after the interrupt.
				const taken = await Promise.all(messages.map(({ queue, text }) => session.dequeue(view.agentId, queue, text)));
				const texts = messages.filter((_, index) => taken[index]).map(({ text }) => text);
				if (texts.length > 0) reply(ws, view.instanceId, { t: "dequeued", view, reqId: msg.reqId, texts });
				return;
			}
			case "abort":
				sessions.get(msg.instanceId)?.abort();
				return;
			case "cancel-agent":
				sessions.get(msg.view.instanceId)?.cancelAgent(msg.view.agentId);
				return;
			case "start":
				send(ws, { t: "started", reqId: msg.reqId, result: await start(msg) });
				return;
			case "resume-all": {
				const results = await Promise.all(msg.sessionIds.map(async sessionId => ({ sessionId, result: await start({ kind: "resume", sessionId }) })));
				send(ws, {
					t: "resumed-all",
					reqId: msg.reqId,
					started: results.flatMap(({ sessionId, result }) => (result.ok ? [{ sessionId, instanceId: result.instanceId }] : [])),
					errors: results.flatMap(({ result }) => (result.ok ? [] : [result.error])),
				});
				return;
			}
			case "dismiss-interrupted":
				dismissInterrupted(msg.sessionId);
				return;
			case "end":
				await sessions.get(msg.instanceId)?.end();
				return;
			case "list-models": {
				const { instanceId } = msg;
				const session = sessions.get(instanceId);
				if (!session?.models) {
					reply(ws, instanceId, { t: "models", instanceId, models: [], error: "Only sessions started from this dashboard can switch models." });
					return;
				}
				try {
					reply(ws, instanceId, { t: "models", instanceId, models: await session.models(), error: null });
				} catch (error) {
					reply(ws, instanceId, { t: "models", instanceId, models: [], error: errorText(error) });
				}
				return;
			}
			case "set-model":
				sessions.get(msg.instanceId)?.setModel?.(msg.model);
				return;
			case "set-thinking":
				sessions.get(msg.instanceId)?.setThinking?.(msg.level);
				return;
			case "answer":
				sessions.get(msg.instanceId)?.answer(msg.requestId, msg.answer);
				return;
		}
	};
}
