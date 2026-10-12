/** What the server does with each message a page sends over its socket. */
import { complete } from "../commands";
import { errorText } from "../json";
import { directoryOf } from "../paths";
import type { NoticeOp } from "../shared/notices";
import type { ClientMsg, ServerMsg } from "../shared/protocol";
import type { StartRequest, StartResult } from "../shared/sessions";
import type { LiveSessions } from "./live-sessions";
import type { ListRegistry } from "./list-registry";
import type { ProjectSpec } from "./project-runner";
import type { Peer, Run } from "./request-ledger";
import type { Views } from "./views";
import type { MsgOf } from "./wire";

export interface SocketEnv {
	sessions: LiveSessions;
	views: Views;
	start(request: StartRequest): Promise<StartResult>;
	/** Create a project in `spec.cwd` and start its coordinator on `spec.prompt`, ready once the coordinator is. */
	createProject(spec: ProjectSpec): Promise<StartResult>;
	lists: ListRegistry;
	/** End live session `instanceId` as **End session** does, then remove the git worktree it worked in. */
	end(instanceId: string): Promise<void>;
	/** Move interrupted session `sessionId` to the past sessions. */
	dismissInterrupted(sessionId: string): void;
	/** Whether interrupted session `sessionId` stopped while its turn ran. */
	stoppedMidTurn(sessionId: string): boolean;
	/** Run routine `id` now, whatever its schedule. */
	runRoutine(id: string): Promise<void>;
	/** Send scheduled send `id` now, whatever its time, or try a failed one again. */
	sendScheduledNow(id: string): Promise<void>;
	/** Act on notices `ids`; every socket then gets the notices as they are after. */
	changeNotices(ids: string[], op: NoticeOp): Promise<void>;
}

/** Each socket message's handler, by its `t`, so a {@link ClientMsg} variant without one does not compile. A message naming a session that is gone does nothing. */
const clientHandlers: { [T in ClientMsg["t"]]: (env: SocketEnv, peer: Peer, msg: MsgOf<T>) => Promise<void> | void } = {
	watch: ({ views }, peer, msg) => views.watch(peer.socket, msg.views),
	async prompt({ sessions }, peer, { view, text, images, delivery }) {
		try {
			await sessions.get(view.instanceId)?.prompt(view.agentId, text, images, delivery);
		} catch (error) {
			peer.reply(view.instanceId, {
				t: "items",
				view,
				reset: false,
				items: [{ id: `error:${Date.now()}`, kind: "notice", level: "error", text: `Could not prepare prompt: ${errorText(error)}` }],
				removed: [],
			});
		}
	},
	async dequeue({ sessions }, peer, { view, reqId, queue, text }) {
		const message = await sessions.get(view.instanceId)?.dequeue(view.agentId, queue, text);
		if (message) peer.reply(view.instanceId, { t: "withdrawn", view, reqId, messages: [message] });
	},
	async promote({ sessions }, _peer, { view, text }) {
		await sessions.get(view.instanceId)?.promote(view.agentId, text);
	},
	async interrupt({ sessions }, peer, { view, reqId }) {
		const messages = (await sessions.get(view.instanceId)?.interrupt()) ?? [];
		if (messages.length > 0) peer.reply(view.instanceId, { t: "withdrawn", view, reqId, messages });
	},
	async complete({ sessions }, peer, { scope, reqId, text, cursor }) {
		// A live view completes as its session; a draft as a session not started yet in its cwd.
		let target: { instanceId: string | null; cwd: string };
		if (scope.kind === "new") {
			const cwd = await directoryOf(scope.cwd);
			if (!cwd) {
				peer.send({ t: "completions", scope, reqId, items: [], error: `${scope.cwd.trim()} is not a directory.` });
				return;
			}
			target = { instanceId: null, cwd };
		} else {
			const session = sessions.get(scope.view.instanceId);
			if (!session) return;
			target = session;
		}
		const { instanceId, cwd } = target;
		const deliver = (msg: ServerMsg): void => (instanceId === null ? peer.send(msg) : peer.reply(instanceId, msg));
		try {
			deliver({ t: "completions", scope, reqId, items: await complete(instanceId, cwd, text, cursor), error: null });
		} catch (error) {
			deliver({ t: "completions", scope, reqId, items: [], error: errorText(error) });
		}
	},
	flush: ({ sessions }, _peer, { instanceId }) => sessions.get(instanceId)?.flush(),
	"edit-prompt": ({ sessions }, _peer, { instanceId, entryId, text }) => sessions.started(instanceId)?.editPrompt(entryId, text),
	"cancel-agent": ({ sessions }, _peer, { view }) => sessions.get(view.instanceId)?.cancelAgent(view.agentId),
	async start({ start }, peer, msg) {
		peer.send({ t: "started", reqId: msg.reqId, result: await start(msg) });
	},
	async "project-create"({ createProject }, peer, { reqId, name, cwd, prompt, model, thinking }) {
		peer.send({ t: "started", reqId, result: await createProject({ name, cwd, prompt, model, thinking }) });
	},
	async "resume-all"({ sessions, start, stoppedMidTurn }, peer, { reqId, sessionIds }) {
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
		peer.send({
			t: "resumed-all",
			reqId,
			started: results.flatMap(({ sessionId, result }) => (result.ok ? [{ sessionId, instanceId: result.instanceId }] : [])),
			errors: results.flatMap(({ result }) => (result.ok ? [] : [result.error])),
		});
	},
	"dismiss-interrupted": ({ dismissInterrupted }, _peer, { sessionId }) => dismissInterrupted(sessionId),
	end: ({ end }, _peer, { instanceId }) => end(instanceId),
	async "list-models"({ sessions }, peer, { instanceId }) {
		const session = sessions.started(instanceId);
		if (!session) {
			peer.reply(instanceId, { t: "models", instanceId, models: [], error: "Only sessions started from this dashboard can switch models." });
			return;
		}
		try {
			peer.reply(instanceId, { t: "models", instanceId, models: await session.models(), error: null });
		} catch (error) {
			peer.reply(instanceId, { t: "models", instanceId, models: [], error: errorText(error) });
		}
	},
	"set-model": ({ sessions }, _peer, { instanceId, model, thinking }) => sessions.started(instanceId)?.setModel(model, thinking),
	"set-thinking": ({ sessions }, _peer, { instanceId, level }) => sessions.started(instanceId)?.setThinking(level),
	"set-fast": ({ sessions }, _peer, { instanceId, enabled }) => sessions.started(instanceId)?.setFast(enabled),
	answer: ({ sessions }, _peer, { instanceId, requestId, answer }) => sessions.get(instanceId)?.answer(requestId, answer),
	"user-todo": ({ lists }, peer, { change }) => void lists.apply("user-todos", change, peer),
	routine: ({ lists, runRoutine }, peer, { change }) => (change.op === "run-now" ? runRoutine(change.id) : void lists.apply("routines", change, peer)),
	schedule: ({ lists, sendScheduledNow }, peer, { change }) => (change.op === "send-now" ? sendScheduledNow(change.id) : void lists.apply("scheduled", change, peer)),
	pin: ({ lists }, peer, { change }) => void lists.apply("pins", change, peer),
	project: ({ lists }, peer, { change }) => void lists.apply("projects", change, peer),
	notice: ({ changeNotices }, _peer, { ids, op }) => changeNotices(ids, op),
};

/** `t` keys the handler that takes `msg`; spelled apart so TypeScript pairs them. */
async function dispatch<T extends ClientMsg["t"]>(env: SocketEnv, peer: Peer, t: T, msg: MsgOf<T>): Promise<void> {
	await clientHandlers[t](env, peer, msg);
}

/** Runs each message's handler over `env`. */
export const createClientHandler =
	(env: SocketEnv): Run =>
	(peer, msg) =>
		dispatch(env, peer, msg.t, msg);
