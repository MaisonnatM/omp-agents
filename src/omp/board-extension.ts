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
import {
	applyBoardChange,
	type BoardChange,
	type BoardState,
	channelName,
	isProjectChannel,
	LEASE_MS,
	openProjectChannels,
	type ProjectChannel,
	parseBoardState,
	planOf,
	projectOfSession,
	queueOf,
	sessionMemberId,
	stepNumbers,
} from "../shared/board";
import { type ExtensionApi, type ExtensionTool, flagValue, readText, reply } from "./extension-kit";

/** The flags that name the Board's file and the inbox a session leaves its changes in. */
export const BOARD_FLAGS = {
	file: "omp-agents-board-file",
	inbox: "omp-agents-board-inbox",
} as const;

const ACTIONS = ["read", "create", "post", "claim", "review", "done", "reopen", "progress", "projects", "project", "goal", "decide", "join", "leave", "step", "rename", "archive", "restore"] as const;

/** The actions that change nothing. */
const READS: readonly string[] = ["read", "projects"];

interface BoardParams {
	action: (typeof ACTIONS)[number];
	thread?: string;
	channel?: string;
	title?: string;
	text?: string;
	parent?: string;
	remove?: boolean;
	message?: string;
	step?: number;
	state?: "running" | "done" | "failed";
}

const DESCRIPTION = [
	"The Board: channels and threads where the user, other people, remote agents, and omp sessions post. A Board message for you arrives as a follow-up naming its thread. Pick one action.",
	"- read: with `thread`, the whole thread; without, every thread with its task state, and the messages waiting for you.",
	"- create: opens a thread titled `title` in channel `channel` (its name, without #), posting `text` as its first message when given; answers the new thread's id.",
	"- post: posts `text` in `thread`. Mention a member with @name to wake them. Post in a project's threads to log what you did or found.",
	"- claim: takes `thread`'s task for an hour. review: marks it ready for review. done: settles it, which ticks a plan step. reopen: opens it again.",
	"- progress: sets `step` (from 0) of the workflow that message `message` runs to `state`: running, done, or failed.",
	"Projects are channels with a goal, decisions, and a plan whose steps are task threads. The project actions below act on `channel` or, without it, on the project you are in.",
	"- projects: every open project with its goal, numbered plan, and decisions.",
	"- project: makes project `title` with goal `text` and puts you in it. join: puts you in `channel` (out of any other). leave: takes you out.",
	"- step: adds plan step `title`, under step thread `parent` when given. goal: sets the goal to `text`. decide: records decision `text`, or removes it with `remove`.",
	"- rename: renames the project `title`. archive / restore: archives or reopens the project.",
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
			channel: Type.Optional(Type.String({ description: "create, step, join, and the project actions: the channel's name, without #." })),
			title: Type.Optional(Type.String({ description: "create: the new thread's title. project, rename: the project's name. step: the step's text." })),
			text: Type.Optional(Type.String({ description: "post: the message. create: the thread's first message. project, goal: the goal. decide: the decision." })),
			parent: Type.Optional(Type.String({ description: "step: the step thread the new step goes under." })),
			remove: Type.Optional(Type.Boolean({ description: "decide: removes the decision instead." })),
			message: Type.Optional(Type.String({ description: "progress: the id of the message whose workflow you report on." })),
			step: Type.Optional(Type.Integer({ description: "progress: the step, from 0.", minimum: 0 })),
			state: Type.Optional(Type.Union([Type.Literal("running"), Type.Literal("done"), Type.Literal("failed")], { description: "progress: the step's state." })),
		}),
		loadMode: "essential",
		approval: args => (READS.includes((args as Partial<BoardParams> | null)?.action ?? "") ? "read" : "write"),
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
			const projectNames = () => openProjectChannels(state).map(item => `#${item.name}`).join(", ") || "none yet";
			/** The project `channel` names, or the one this session is in. */
			const project = (): ProjectChannel => {
				if (params.channel === undefined) {
					const mine = projectOfSession(state, session);
					if (!mine) throw new Error(`You are in no project, so name one in channel. Open projects: ${projectNames()}.`);
					return mine;
				}
				const name = params.channel.replace(/^#/, "");
				const found = state.channels.find(item => item.name === name);
				if (!found || !isProjectChannel(found)) throw new Error(`#${name} is no project. Open projects: ${projectNames()}.`);
				return found;
			};
			const required = (value: string | undefined, what: string) => {
				const trimmed = value?.trim();
				if (!trimmed) throw new Error(`${params.action} needs ${what}.`);
				return trimmed;
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
				case "reopen":
					return leave({ op: "task", thread: thread().id, task: "open", lease: null }, "Reopened.");
				case "progress":
					if (params.message === undefined || params.step === undefined || params.state === undefined) throw new Error("progress needs message, step, and state.");
					return leave({ op: "progress", message: params.message, step: params.step, state: params.state }, `Step ${params.step} is ${params.state}.`);
				case "projects": {
					const mine = projectOfSession(state, session)?.id;
					const blocks = openProjectChannels(state).map(item => {
						const plan = planOf(state, item.id);
						const numbers = stepNumbers(plan);
						return [
							`#${item.name}${item.id === mine ? " (you are in it)" : ""}: ${item.project.goal || "no goal yet"}`,
							...plan.map(step => `  [${step.task === "done" ? "x" : " "}] ${numbers.get(step.id)} ${step.title} (${step.id}${step.task === "claimed" || step.task === "review" ? `, ${step.task}` : ""})`),
							...(item.project.decisions.length === 0 ? [] : [`  Decisions: ${item.project.decisions.join("; ")}`]),
						].join("\n");
					});
					return reply(blocks.length === 0 ? "No open projects." : blocks.join("\n\n"));
				}
				case "project": {
					const title = required(params.title, "title, the project's name");
					const id = `c-project-${randomUUID()}`;
					const name = channelName(state, title);
					const goal = params.text?.trim() ?? "";
					return leave(
						{
							op: "all",
							changes: [
								{ op: "channel", channel: { id, name, about: "", project: { goal, decisions: [], sessionIds: [], createdAt: Date.now() } } },
								{ op: "join", channel: id, sessionId: session },
							],
						},
						`Made project #${name} and put you in it.`,
					);
				}
				case "goal": {
					const { id, name } = project();
					return leave({ op: "set-goal", channel: id, goal: required(params.text, "text, the goal") }, `Set #${name}'s goal.`);
				}
				case "decide": {
					const { id, name } = project();
					const remove = params.remove === true;
					return leave({ op: "decision", channel: id, text: required(params.text, "text, the decision"), remove }, `${remove ? "Removed the decision from" : "Recorded the decision in"} #${name}.`);
				}
				case "join": {
					if (params.channel === undefined) throw new Error(`join needs channel. Open projects: ${projectNames()}.`);
					const { id, name } = project();
					return leave({ op: "join", channel: id, sessionId: session }, `You are in #${name}.`);
				}
				case "leave":
					return leave({ op: "leave", sessionId: session }, "You are in no project.");
				case "step": {
					const title = required(params.title, "title, the step's text");
					const parent = params.parent === undefined ? undefined : state.threads.find(item => item.id === params.parent);
					if (params.parent !== undefined && !parent) throw new Error(`No step thread ${params.parent}.`);
					const channel = parent ? parent.channel : project().id;
					const id = `t-${randomUUID()}`;
					return leave(
						{ op: "thread", thread: { id, channel, title, task: "open", lease: null, createdAt: Date.now(), ...(parent ? { parent: parent.id } : {}) } },
						`Added step ${id}.`,
					);
				}
				case "rename": {
					const { id, name } = project();
					const next = channelName({ ...state, channels: state.channels.filter(item => item.id !== id) }, required(params.title, "title, the new name"));
					return leave({ op: "rename", channel: id, name: next }, `Renamed #${name} to #${next}.`);
				}
				case "archive": {
					const { id, name } = project();
					return leave({ op: "archive", channel: id, at: Date.now() }, `Archived #${name}.`);
				}
				case "restore": {
					const { id, name } = project();
					return leave({ op: "archive", channel: id, at: null }, `Restored #${name}.`);
				}
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
