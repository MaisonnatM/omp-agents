/**
 * Router Bots: the tasks a Router hands to background sessions, what its `start_task`, `follow`, and `finish_task`
 * tools ask of the server, and the job and routine a new one starts with.
 */
import { isNonEmpty, isObject, isSafeInteger, parseAll, type Parsed } from "../json";
import type { RoutineSpec } from "../routines";
import { type Bot, type BotId, parseBotId } from "./bots";
import { parsePullRequest } from "./github";
import type { SessionFacts } from "./sessions";

export const ROUTER_NAME = "Atlas";

export const ROUTER_JOB = [
	"Be my one conversation for getting work done, and answer at once.",
	"Hand any real work, such as code changes, investigations, reviews, or anything longer than a quick answer, to a task with `start_task`; never do it in your own turn.",
	"Give each task a short title and a prompt that holds everything it needs, since it never sees this conversation.",
	"When a task works on a pull request, a Slack thread, or a Linear issue, name it in `follows`, so what happens there reaches that task.",
	"When a task finishes, tell me in one line what it did and what it needs from me, then mark it with `finish_task`.",
	"Stay quiet on events that need nothing from me.",
	"When an event reports a bug nobody answered, start a quiet task (`quiet: true`) that follows its thread and looks into it, and tell it in its prompt to post in that thread only once it has a result, such as a cause or a fix.",
	"Ask me only for decisions, never for what a task can find out itself.",
].join("\n");

/** The routine a new Router starts with: a run whenever a Slack message waits on you or a pull request becomes your move. */
export const routerRoutine = (botId: BotId): RoutineSpec => ({
	id: `${botId}-events`,
	botId,
	name: "Team events",
	schedules: [],
	triggers: [{ kind: "slack" }, { kind: "pull-request" }],
	task: { kind: "prompt", prompt: "Read the events this run names, and hand each that needs work to a task, as your job says; say nothing about the ones that need nothing from me." },
	enabled: true,
});

/** Something a task listens to, so what happens there reaches the task that owns it. */
export type TaskFollow =
	| { kind: "pull-request"; owner: string; repo: string; number: number }
	| { kind: "slack-thread"; channel: string; ts: string }
	| { kind: "linear"; id: string };

/** Where a task stands: its session works, it waits for you, you marked it done, or it was stopped. */
export const TASK_STATUSES = ["working", "review", "done", "stopped"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/** How the Tasks tab names each status. */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = { working: "Working", review: "Needs your review", done: "Done", stopped: "Stopped" };

/** A piece of work a Router handed to a background session of its own. */
export interface RouterTask {
	/** Minted by the tool that starts it, so a request read twice starts it once. */
	id: string;
	botId: BotId;
	/** The session doing the work, `null` until it starts. */
	sessionId: string | null;
	title: string;
	/** The directory its session runs in. */
	cwd: string;
	/** What its session was asked, its first message. */
	prompt: string;
	follows: TaskFollow[];
	status: TaskStatus;
	/** A quiet task finishes without telling the Router. */
	quiet: boolean;
	/** Epoch milliseconds. */
	startedAt: number;
	/** Epoch milliseconds of its last change. */
	updatedAt: number;
	/** How many times its session started again. */
	restarts: number;
	/** Why it finished or stopped, `null` without a reason. */
	note: string | null;
}

/** A task's open statuses: the ones the Router still tracks. */
export const isOpenTask = ({ status }: RouterTask): boolean => status === "working" || status === "review";

const NO_LINKS: Pick<SessionFacts, "pullRequests" | "tickets"> = { pullRequests: [], tickets: [] };

/**
 * `facts` of session `sessionId`, without its pull requests and Linear issues when it is the conversation of one of `bots`
 * that is a Router. The events it reads name them, and its workspace's branch may head one, but it hands their work to
 * tasks: it never claims one, so its tasks can start on it, and never counts as the agent on one, so its events still fire.
 */
export function routerLinks(bots: readonly Pick<Bot, "kind" | "sessionId">[], sessionId: string, facts: SessionFacts): SessionFacts {
	if (!bots.some(bot => bot.kind === "router" && bot.sessionId === sessionId)) return facts;
	return facts.pullRequests.length === 0 && facts.tickets.length === 0 ? facts : { ...facts, ...NO_LINKS };
}

/** The longest title, prompt, or note a task keeps. */
export const MAX_TASK_TITLE = 120;
export const MAX_TASK_PROMPT = 20_000;
export const MAX_TASK_NOTE = 2_000;

/** A task id names a request file, so it holds no path separator or dot. */
export const parseTaskId = (value: unknown): string | null => (typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null);

const parseTitle = (value: unknown): string | null => (isNonEmpty(value) && value.length <= MAX_TASK_TITLE ? value.trim() : null);

/** A Slack id or timestamp: letters, digits, and dots, as Slack writes them. */
const SLACK_PART = /^[A-Za-z0-9.]{1,64}$/;

/** A Linear issue key such as `ENG-123`, or an issue id. */
const LINEAR_ID = /^[A-Za-z0-9-]{1,64}$/;

export function parseTaskFollow(value: unknown): TaskFollow | null {
	if (!isObject(value)) return null;
	switch (value.kind) {
		case "pull-request": {
			const pr = parsePullRequest(value.owner, value.repo, value.number);
			return pr && { kind: "pull-request", ...pr.ok };
		}
		case "slack-thread":
			return typeof value.channel === "string" && SLACK_PART.test(value.channel) && typeof value.ts === "string" && SLACK_PART.test(value.ts)
				? { kind: "slack-thread", channel: value.channel, ts: value.ts }
				: null;
		case "linear":
			return typeof value.id === "string" && LINEAR_ID.test(value.id) ? { kind: "linear", id: value.id } : null;
		default:
			return null;
	}
}

/** One string per thing followed, equal for two follows of the same thing. */
export function followKey(follow: TaskFollow): string {
	switch (follow.kind) {
		case "pull-request":
			return `pull-request:${follow.owner}/${follow.repo}#${follow.number}`.toLowerCase();
		case "slack-thread":
			return `slack-thread:${follow.channel}/${follow.ts}`;
		case "linear":
			return `linear:${follow.id}`.toLowerCase();
	}
}

/** How a follow reads on a chip: `owner/repo#12`, `Slack thread`, or the Linear key. */
export function followLabel(follow: TaskFollow): string {
	switch (follow.kind) {
		case "pull-request":
			return `${follow.owner}/${follow.repo}#${follow.number}`;
		case "slack-thread":
			return "Slack thread";
		case "linear":
			return follow.id;
	}
}

/** `follows` with each thing named once, in their first order. */
export function uniqueFollows(follows: readonly TaskFollow[]): TaskFollow[] {
	const seen = new Set<string>();
	return follows.filter(follow => {
		const key = followKey(follow);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

const parseFollows = (value: unknown): TaskFollow[] | null => {
	const follows = parseAll(value, parseTaskFollow);
	return follows && uniqueFollows(follows);
};

export function parseRouterTask(value: unknown): RouterTask | null {
	if (!isObject(value)) return null;
	const id = parseTaskId(value.id);
	const botId = parseBotId(value.botId);
	const title = parseTitle(value.title);
	const follows = parseFollows(value.follows);
	const { sessionId, cwd, prompt, status, quiet, startedAt, updatedAt, restarts, note } = value;
	if (!id || !botId || !title || !follows) return null;
	if (sessionId !== null && !isNonEmpty(sessionId)) return null;
	if (!isNonEmpty(cwd) || !cwd.startsWith("/") || typeof prompt !== "string") return null;
	if (!TASK_STATUSES.includes(status as TaskStatus) || typeof quiet !== "boolean") return null;
	if (!isSafeInteger(startedAt) || !isSafeInteger(updatedAt) || !isSafeInteger(restarts) || restarts < 0) return null;
	if (note !== null && typeof note !== "string") return null;
	return { id, botId, sessionId, title, cwd, prompt, follows, status: status as TaskStatus, quiet, startedAt, updatedAt, restarts, note };
}

/** The tasks file's `{ tasks }`, dropping a task that does not parse, or `null` when it is no such object. */
export function parseRouterTasks(value: unknown): RouterTask[] | null {
	if (!isObject(value) || !Array.isArray(value.tasks)) return null;
	return value.tasks.flatMap(task => parseRouterTask(task) ?? []);
}

/** What a Router asks for when it starts a task; the server adds the rest of a {@link RouterTask}. */
export type TaskSpec = Pick<RouterTask, "id" | "title" | "prompt" | "cwd" | "follows" | "quiet">;

/** Marks task `id`, from its Router's `finish_task` or the page's Mark done and Stop; `stopped` also ends its session. */
export type RouterTaskChange = { op: "finish"; id: string; status: Exclude<TaskStatus, "working">; note: string | null };

/** What a Router's tools ask of the server about one of its tasks. */
export type RouterChange =
	/** Starts the task's session in `cwd` with `prompt` as its first message. */
	| { op: "start"; task: TaskSpec }
	/** Adds to what the task listens to. */
	| { op: "follow"; id: string; follows: TaskFollow[] }
	| RouterTaskChange;

/** What a Router's tool leaves for the server: one change from `botId`, the Bot that asks. */
export interface RouterRequest {
	botId: BotId;
	change: RouterChange;
}

/** A request a Router's tool left for the server, or `null`. */
export function parseRouterRequest(value: unknown): Parsed<RouterRequest> {
	if (!isObject(value) || !isObject(value.change)) return null;
	const botId = parseBotId(value.botId);
	const { change } = value;
	if (!botId) return null;
	switch (change.op) {
		case "start": {
			const { task } = change;
			if (!isObject(task)) return null;
			const id = parseTaskId(task.id);
			const title = parseTitle(task.title);
			const follows = parseFollows(task.follows);
			const { prompt, cwd, quiet } = task;
			if (!id || !title || !follows || !isNonEmpty(prompt) || prompt.length > MAX_TASK_PROMPT || !isNonEmpty(cwd) || !cwd.startsWith("/") || typeof quiet !== "boolean") return null;
			return { ok: { botId, change: { op: "start", task: { id, title, prompt, cwd, follows, quiet } } } };
		}
		case "follow": {
			const id = parseTaskId(change.id);
			const follows = parseFollows(change.follows);
			return id && follows && follows.length > 0 ? { ok: { botId, change: { op: "follow", id, follows } } } : null;
		}
		case "finish": {
			const finish = parseRouterTaskChange(change);
			return finish && { ok: { botId, change: finish } };
		}
		default:
			return null;
	}
}

/** A {@link RouterTaskChange}, whose `note` defaults to `null`, or `null` when it is none. */
export function parseRouterTaskChange(value: unknown): RouterTaskChange | null {
	if (!isObject(value) || value.op !== "finish") return null;
	const id = parseTaskId(value.id);
	const { note = null, status } = value;
	if (!id || (note !== null && (typeof note !== "string" || note.length > MAX_TASK_NOTE))) return null;
	return status === "review" || status === "done" || status === "stopped" ? { op: "finish", id, status, note } : null;
}

/** How the Tasks tab groups a Router's tasks: the ones waiting on you, the ones at work, and the ones over. */
export function taskGroups(tasks: readonly RouterTask[]): { review: RouterTask[]; working: RouterTask[]; done: RouterTask[] } {
	const newest = [...tasks].sort((a, b) => b.updatedAt - a.updatedAt);
	return {
		review: newest.filter(({ status }) => status === "review"),
		working: newest.filter(({ status }) => status === "working"),
		done: newest.filter(({ status }) => status === "done" || status === "stopped"),
	};
}
