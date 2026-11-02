// omp-agents Router Bots: the `start_task`, `follow`, and `finish_task` tools, which ask the dashboard to start a
// background session for a task, to route what happens on a pull request, Slack thread, or Linear issue to it, and to
// mark it, and the lines of the system prompt that list the Router's open tasks each turn.
// The dashboard loads it with `omp -e`, beside the Bot extension, for a Router Bot's session only
// (`Bots.join` in src/server/bots.ts), so no other session has these tools.
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseJson } from "../json";
import { type BotId, parseBotId } from "../shared/bots";
import { followKey, isOpenTask, MAX_TASK_NOTE, MAX_TASK_PROMPT, MAX_TASK_TITLE, parseRouterTasks, parseTaskFollow, type RouterChange, type RouterTaskChange, type TaskFollow } from "../shared/router";
import { type BotExtensionApi, flagValue, leave, readText, reply } from "./bot-extension";

/** The flags a Router's session starts with: its Bot's id, the directory its tools leave their requests in, and the tasks file it reads. */
export const ROUTER_FLAGS = {
	bot: "omp-agents-router",
	inbox: "omp-agents-router-inbox",
	tasks: "omp-agents-router-tasks",
} as const;

export const START_TOOL = "start_task";
export const FOLLOW_TOOL = "follow";
export const FINISH_TOOL = "finish_task";

export interface StartTaskParams {
	title: string;
	prompt: string;
	cwd?: string;
	follows?: TaskFollow[];
	quiet?: boolean;
}

export interface FollowParams {
	taskId: string;
	follows: TaskFollow[];
}

export interface FinishTaskParams {
	taskId: string;
	status: RouterTaskChange["status"];
	note?: string;
}

const RULES = [
	"You are a Router: you answer the user at once and hand real work to tasks, background sessions the dashboard runs for you.",
	`\`${START_TOOL}\` starts one task: its own session, in the Sessions tab, that works on its prompt alone, so the prompt must hold everything it needs. It returns the task's id at once; never wait for it in your turn.`,
	`\`${FOLLOW_TOOL}\` adds pull requests, Slack threads, or Linear issues a task listens to, so what happens there reaches the task that owns it.`,
	`When a task's session ends its turn, the dashboard marks it Needs your review and tells you in one line here, unless it is quiet. \`${FINISH_TOOL}\` marks it done, back to review, or stopped, which ends its session.`,
	"The tools only leave a request; when the dashboard refuses one, it tells you why in this conversation.",
].join("\n");

const isDirectory = (path: string): boolean => {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
};

/** `values` checked again as follows, which the tool's schema already checked, or an error naming the first that is not one. */
function follows(values: readonly TaskFollow[]): TaskFollow[] {
	return values.map(value => {
		const follow = parseTaskFollow(value);
		if (!follow) throw new Error(`${JSON.stringify(value)} is not a pull request, Slack thread, or Linear issue to follow.`);
		return follow;
	});
}

export default function routerExtension(pi: BotExtensionApi): void {
	pi.registerFlag(ROUTER_FLAGS.bot, { type: "string", description: "The omp-agents Router Bot this session is." });
	pi.registerFlag(ROUTER_FLAGS.inbox, { type: "string", description: "The directory its tools leave their requests in." });
	pi.registerFlag(ROUTER_FLAGS.tasks, { type: "string", description: "The file the dashboard keeps every Router's tasks in." });

	/** Leaves `change` for the dashboard, from this session's Router. */
	const ask = (change: RouterChange): void => {
		const botId = parseBotId(flagValue(pi, ROUTER_FLAGS.bot));
		const inbox = flagValue(pi, ROUTER_FLAGS.inbox);
		if (!botId || !inbox) throw new Error("This session is not an omp-agents Router.");
		leave(inbox, { botId, change });
	};

	/** This Router's open tasks as lines of the system prompt, each its id, title, status, and follows. */
	const openTasks = (botId: BotId): string => {
		const path = flagValue(pi, ROUTER_FLAGS.tasks);
		const open = (path === null ? null : parseRouterTasks(parseJson(readText(path))))?.filter(task => task.botId === botId && isOpenTask(task)) ?? [];
		if (open.length === 0) return "You have no open tasks.";
		const lines = open.map(({ id, title, status, follows }) => `- ${JSON.stringify({ id, title, status, follows: follows.map(followKey) })}`);
		return ["Your open tasks:", ...lines].join("\n");
	};

	pi.on("before_agent_start", (event, ctx) => {
		const botId = parseBotId(flagValue(pi, ROUTER_FLAGS.bot));
		return ctx.agent.kind === "sub" || !botId ? undefined : { systemPrompt: [...event.systemPrompt, RULES, openTasks(botId)] };
	});

	const { Type } = pi.typebox;
	const follow = Type.Union(
		[
			Type.Object({ kind: Type.Literal("pull-request"), owner: Type.String({ minLength: 1 }), repo: Type.String({ minLength: 1 }), number: Type.Integer({ minimum: 1 }) }),
			Type.Object({ kind: Type.Literal("slack-thread"), channel: Type.String({ minLength: 1 }), ts: Type.String({ minLength: 1, description: "The thread's parent message timestamp." }) }),
			Type.Object({ kind: Type.Literal("linear"), id: Type.String({ minLength: 1, description: "The issue's key, such as ENG-123." }) }),
		],
		{ description: "A pull request, Slack thread, or Linear issue." },
	);
	const taskId = Type.String({ minLength: 1, description: `The task's id, as \`${START_TOOL}\` returned it.` });

	pi.registerTool<StartTaskParams>({
		name: START_TOOL,
		label: "Start task",
		description: "Asks the dashboard to start a background session that does one piece of work, and returns the task's id at once. Use it for any real work instead of doing it yourself.",
		parameters: Type.Object({
			title: Type.String({ minLength: 1, maxLength: MAX_TASK_TITLE, description: "A few words that name the task in the Tasks tab and the Sessions tab." }),
			prompt: Type.String({ minLength: 1, maxLength: MAX_TASK_PROMPT, description: "The task session's first message: everything it needs, since it never sees this conversation." }),
			cwd: Type.Optional(Type.String({ minLength: 1, description: "The absolute directory it works in; your own workspace when left out." })),
			follows: Type.Optional(Type.Array(follow, { description: "What the task listens to." })),
			quiet: Type.Optional(Type.Boolean({ description: "Finish without telling you here; false when left out." })),
		}),
		loadMode: "essential",
		approval: "write",
		async execute(_toolCallId, { title, prompt, cwd, follows: wanted = [], quiet = false }, _signal, _onUpdate, ctx) {
			const workspace = cwd ?? ctx.cwd;
			if (!isAbsolute(workspace) || !isDirectory(workspace)) throw new Error(`cwd ${workspace} is not the absolute path of a directory.`);
			const id = randomUUID();
			ask({ op: "start", task: { id, title: title.trim(), prompt, cwd: workspace, follows: follows(wanted), quiet } });
			return reply(`Asked the dashboard to start task ${id}, "${title.trim()}", in ${workspace}. It shows in the Tasks tab once the dashboard starts it.`);
		},
	});

	pi.registerTool<FollowParams>({
		name: FOLLOW_TOOL,
		label: "Follow",
		description: "Asks the dashboard to route what happens on more pull requests, Slack threads, or Linear issues to one of your tasks.",
		parameters: Type.Object({ taskId, follows: Type.Array(follow, { minItems: 1, description: "What the task listens to from now on, beside what it already does." }) }),
		loadMode: "essential",
		approval: "write",
		async execute(_toolCallId, { taskId: id, follows: wanted }) {
			const added = follows(wanted);
			if (added.length === 0) throw new Error("follows names nothing to follow.");
			ask({ op: "follow", id, follows: added });
			return reply(`Asked the dashboard to route ${added.map(followKey).join(", ")} to task ${id}.`);
		},
	});

	pi.registerTool<FinishTaskParams>({
		name: FINISH_TOOL,
		label: "Finish task",
		description: "Asks the dashboard to mark one of your tasks: done once the user has what they need, review while it waits on them, or stopped, which ends its session.",
		parameters: Type.Object({
			taskId,
			status: Type.Union([Type.Literal("review"), Type.Literal("done"), Type.Literal("stopped")], { description: "What the task is now." }),
			note: Type.Optional(Type.String({ maxLength: MAX_TASK_NOTE, description: "Why, in one line." })),
		}),
		loadMode: "essential",
		approval: "write",
		async execute(_toolCallId, { taskId: id, status, note }) {
			ask({ op: "finish", id, status, note: note ?? null });
			return reply(`Asked the dashboard to mark task ${id} ${status}.`);
		},
	});
}
