/**
 * Router Bots: the tasks a Router hands to background sessions, what its `start_task`, `follow`, and `finish_task`
 * tools ask of the server, and the job a new one starts with.
 */
import { isNonEmpty, isObject, isSafeInteger, parseAll, type Parsed } from "../json";
import { type BotId, parseBotId } from "./bots";
import { parsePullRequest } from "./github";

export const ROUTER_NAME = "Atlas";

export const ROUTER_JOB = [
	"Be my one conversation for getting work done, and answer at once.",
	"Hand any real work, such as code changes, investigations, reviews, or anything longer than a quick answer, to a task with `start_task`; never do it in your own turn.",
	"Give each task a short title and a prompt that holds everything it needs, since it never sees this conversation.",
	"When a task works on a pull request, a Slack thread, or a Linear issue, name it in `follows`, so what happens there reaches that task.",
	"When a task finishes, tell me in one line what it did and what it needs from me, then mark it with `finish_task`.",
	"Stay quiet on events that need nothing from me.",
	"Ask me only for decisions, never for what a task can find out itself.",
].join("\n");

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

/** What a Router's tools ask of the server about one of its tasks. */
export type RouterChange =
	/** Starts the task's session in `cwd` with `prompt` as its first message. */
	| { op: "start"; task: { id: string; title: string; prompt: string; cwd: string; follows: TaskFollow[]; quiet: boolean } }
	/** Adds to what the task listens to. */
	| { op: "follow"; taskId: string; follows: TaskFollow[] }
	/** Marks the task; `stopped` also ends its session. */
	| { op: "finish"; taskId: string; status: Exclude<TaskStatus, "working">; note: string | null };

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
			const taskId = parseTaskId(change.taskId);
			const follows = parseFollows(change.follows);
			return taskId && follows && follows.length > 0 ? { ok: { botId, change: { op: "follow", taskId, follows } } } : null;
		}
		case "finish": {
			const taskId = parseTaskId(change.taskId);
			const { note = null, status } = change;
			if (!taskId || (note !== null && typeof note !== "string") || (typeof note === "string" && note.length > MAX_TASK_NOTE)) return null;
			if (status !== "review" && status !== "done" && status !== "stopped") return null;
			return { ok: { botId, change: { op: "finish", taskId, status, note: typeof note === "string" ? note : null } } };
		}
		default:
			return null;
	}
}

/** What the page asks of a task: mark it done, or stop it, which ends its session. */
export type RouterTaskChange = { op: "finish"; id: string; status: "done" | "stopped" };

export function parseRouterTaskChange(value: unknown): RouterTaskChange | null {
	if (!isObject(value) || value.op !== "finish") return null;
	const id = parseTaskId(value.id);
	return id && (value.status === "done" || value.status === "stopped") ? { op: "finish", id, status: value.status } : null;
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
