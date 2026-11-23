/**
 * omp-agents Board in a session: the `board` tool, which reads the Board with the changes its inbox still holds, and
 * leaves one change per call in that inbox for the dashboard, the one writer of `board.json`. It checks the change as
 * the dashboard will before it leaves it, so a refusal reaches the agent with its reason. The dashboard loads it with
 * `omp -e` into every session it starts, with the flags that name both paths, and wakes a session with a follow-up
 * when a Board message is for it.
 */
import { randomUUID } from "node:crypto";
import { inbox } from "../../templates/omp/agent/extensions/inbox/client";
import { parseJson } from "../json";
import { applyBoardChange, type BoardChange, type BoardState, LEASE_MS, parseBoardState, queueOf, sessionMemberId } from "../shared/board";
import { type ExtensionApi, type ExtensionTool, flagValue, readText, reply } from "./extension-kit";

/** The flags that name the Board's file and the inbox a session leaves its changes in. */
export const BOARD_FLAGS = {
	file: "omp-agents-board-file",
	inbox: "omp-agents-board-inbox",
} as const;

const ACTIONS = ["read", "create", "post", "claim", "review", "done", "progress"] as const;

interface BoardParams {
	action: (typeof ACTIONS)[number];
	thread?: string;
	channel?: string;
	title?: string;
	text?: string;
	message?: string;
	step?: number;
	state?: "running" | "done" | "failed";
}

const DESCRIPTION = [
	"The Board: channels and threads where the user, other people, remote agents, and omp sessions post. A Board message for you arrives as a follow-up naming its thread. Pick one action.",
	"- read: with `thread`, the whole thread; without, every thread with its task state, and the messages waiting for you.",
	"- create: opens a thread titled `title` in channel `channel` (its name, without #), posting `text` as its first message when given; answers the new thread's id.",
	"- post: posts `text` in `thread`. Mention a member with @name to wake them.",
	"- claim: takes `thread`'s task for an hour. review: marks it ready for review. done: settles it, which opens the threads waiting on it.",
	"- progress: sets `step` (from 0) of the workflow that message `message` runs to `state`: running, done, or failed.",
	"The dashboard applies each change, and while it is stopped the change waits for it.",
].join("\n");

function pathsOf(pi: ExtensionApi): { file: string; inbox: string } {
	const file = flagValue(pi, BOARD_FLAGS.file);
	const dir = flagValue(pi, BOARD_FLAGS.inbox);
	if (file === null || dir === null) throw new Error("The dashboard did not name the Board's files, so this session has no Board.");
	return { file, inbox: dir };
}

function boardTool(pi: ExtensionApi): ExtensionTool<BoardParams> {
	const { Type } = pi.typebox;
	return {
		name: "board",
		label: "Board",
		description: DESCRIPTION,
		parameters: Type.Object({
			action: Type.Union(
				ACTIONS.map(action => Type.Literal(action)),
				{ description: "What to do." },
			),
			thread: Type.Optional(Type.String({ description: "The thread id, such as the one the follow-up names." })),
			channel: Type.Optional(Type.String({ description: "create: the channel's name, without #." })),
			title: Type.Optional(Type.String({ description: "create: the new thread's title." })),
			text: Type.Optional(Type.String({ description: "post: the message. create: the thread's first message." })),
			message: Type.Optional(Type.String({ description: "progress: the id of the message whose workflow you report on." })),
			step: Type.Optional(Type.Integer({ description: "progress: the step, from 0.", minimum: 0 })),
			state: Type.Optional(Type.Union([Type.Literal("running"), Type.Literal("done"), Type.Literal("failed")], { description: "progress: the step's state." })),
		}),
		loadMode: "essential",
		approval: args => ((args as Partial<BoardParams> | null)?.action === "read" ? "read" : "write"),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const paths = pathsOf(pi);
			const changes = inbox<BoardChange>(paths.inbox);
			const written = parseBoardState(parseJson(readText(paths.file)));
			if (!written) throw new Error("The dashboard has not written the Board yet.");
			let state: BoardState = written;
			for (const change of changes.waiting()) {
				const applied = applyBoardChange(state, change);
				if ("ok" in applied) state = applied.ok;
			}
			const session = ctx.sessionManager.getSessionId();
			// A Bot's conversation is the Bot on the Board, which the dashboard posts its changes as.
			const me = state.extraMembers.find(member => member.botId && member.sessionId === session)?.id ?? sessionMemberId(session);
			const names = new Map(state.extraMembers.map(member => [member.id, member.name]));
			const nameOf = (id: string) => names.get(id) ?? (id === me ? "you" : id);
			const leave = (change: BoardChange, done: string) => {
				const applied = applyBoardChange(state, change);
				if ("error" in applied) throw new Error(`The Board refused it, so nothing was left for the dashboard: ${applied.error}`);
				changes.leave(change);
				state = applied.ok;
				return reply(done);
			};
			const thread = () => {
				const found = state.threads.find(item => item.id === params.thread);
				if (!found) throw new Error(`thread must be one of ${state.threads.map(item => item.id).join(", ")}.`);
				return found;
			};
			switch (params.action) {
				case "read": {
					if (params.thread !== undefined) {
						const { id, title, task } = thread();
						const lines = state.messages.filter(msg => msg.thread === id).map(msg => `[${msg.id}] ${nameOf(msg.author)}: ${msg.text}${msg.attachment ? ` (${JSON.stringify(msg.attachment)})` : ""}`);
						return reply([`${title} — ${task ?? "discussion"}`, ...lines].join("\n"));
					}
					const self = state.extraMembers.find(member => member.id === me);
					const waiting = self ? queueOf(state, self) : [];
					const threads = state.threads.map(item => `${item.id} #${state.channels.find(channel => channel.id === item.channel)?.name}: ${item.title} — ${item.task ?? "discussion"}${item.lease ? `, held by ${nameOf(item.lease.by)}` : ""}`);
					return reply([...threads, "", `Waiting for you: ${waiting.length === 0 ? "nothing" : waiting.map(msg => `[${msg.thread}] ${nameOf(msg.author)}: ${msg.text}`).join("\n")}`].join("\n"));
				}
				case "create": {
					const title = params.title?.trim();
					if (!title) throw new Error("create needs title.");
					const name = params.channel?.replace(/^#/, "");
					const channel = state.channels.find(item => item.name === name);
					if (!channel) throw new Error(`channel must be one of ${state.channels.map(item => item.name).join(", ")}.`);
					const id = `t-${randomUUID()}`;
					const created = leave({ op: "thread", thread: { id, channel: channel.id, title, task: null, lease: null, createdAt: Date.now() } }, `Opened ${id} in #${channel.name}.`);
					const text = params.text?.trim();
					return text ? leave({ op: "post", message: { id: randomUUID(), thread: id, author: me, at: Date.now(), text } }, `Opened ${id} in #${channel.name} and posted in it.`) : created;
				}
				case "post": {
					if (!params.text?.trim()) throw new Error("post needs text.");
					const { id } = thread();
					return leave({ op: "post", message: { id: randomUUID(), thread: id, author: me, at: Date.now(), text: params.text.trim() } }, `Posted in ${id}.`);
				}
				case "claim":
					return leave({ op: "task", thread: thread().id, task: "claimed", lease: { by: me, until: Date.now() + LEASE_MS } }, "Claimed for an hour.");
				case "review":
					return leave({ op: "task", thread: thread().id, task: "review", lease: null }, "Marked ready for review.");
				case "done":
					return leave({ op: "task", thread: thread().id, task: "done", lease: null }, "Settled.");
				case "progress":
					if (params.message === undefined || params.step === undefined || params.state === undefined) throw new Error("progress needs message, step, and state.");
					return leave({ op: "progress", message: params.message, step: params.step, state: params.state }, `Step ${params.step} is ${params.state}.`);
				default: {
					const never: never = params.action;
					throw new Error(`action must be one of ${ACTIONS.join(", ")}, not ${String(never)}.`);
				}
			}
		},
	};
}

export default function boardExtension(pi: ExtensionApi): void {
	pi.registerFlag(BOARD_FLAGS.file, { type: "string", description: "The omp-agents Board's file, which the board tool reads." });
	pi.registerFlag(BOARD_FLAGS.inbox, { type: "string", description: "The directory the board tool leaves its changes in for the dashboard." });
	pi.registerTool(boardTool(pi));
}
