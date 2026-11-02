/**
 * The supervisor of Router tasks: every {@link SUPERVISOR_TICK_MS}, on the server that holds the owner lock, it looks at
 * each working task's session. A session that works but writes nothing new for {@link STALL_CHECKS} looks, or for
 * {@link LONG_CALL_CHECKS} while a tool call such as a long build still runs, one that ran
 * the same tool call {@link LOOP_REPEATS} times in a row, or one that died while its task worked, is stopped and told to
 * go on, with the reason and its last error; after {@link MAX_RESTARTS} restarts, or a restart that fails, the task is stopped and its Router told.
 */
import { errorText, isObject } from "../json";
import type { LiveSession } from "../live-session";
import type { BotId } from "../shared/bots";
import type { RouterTask } from "../shared/router";
import type { WithdrawnMessage } from "../shared/sessions";
import { oneLine, tailEntries, textOf, type ToolCall, toolCallsOf, toolResultOf, toolSummary } from "../session-entries";
import { isUserPrompt } from "../transcript";
import type { RouterTasks } from "./router-tasks";

/** How often the supervisor looks at the working tasks. */
export const SUPERVISOR_TICK_MS = 2 * 60_000;
/** How many looks in a row a working session writes nothing new before it counts as stuck, or a session gone before it counts as dead. */
export const STALL_CHECKS = 3;
/** How many looks a working session may write nothing while a tool call it made still runs, such as a long build or test run. */
export const LONG_CALL_CHECKS = 15;
/** How many times in a row the same tool call ends a session's file before it counts as looping. */
export const LOOP_REPEATS = 4;
/** How many times the supervisor restarts a task before it stops it. */
export const MAX_RESTARTS = 2;

/** What the end of a session's file says of its progress. */
export interface TaskTail {
	/** The newest entry's id, else its time; it changes whenever the session writes. `null` for a file with no entry. */
	mark: string | null;
	/** The tool call the file ends on and how many times in a row since the last prompt it ran, `null` without one. */
	repeated: { call: string; times: number } | null;
	/** The newest tool call that has no result yet, as it runs now, `null` without one. */
	running: string | null;
	/** The newest failed tool call's result, as one line, `null` without one. */
	lastError: string | null;
}

/** A tool call as one line, such as `bash bun run build`. */
const callLabel = (call: ToolCall): string => `${call.name} ${toolSummary(call.args, undefined)}`.trim();

/** The end of session file `path`, as {@link TaskTail}, which names nothing for a file that is gone; `null` when it cannot be read. */
export function readTaskTail(path: string): TaskTail | null {
	let mark: string | null = null;
	let lastError: string | null = null;
	let running: string | null = null;
	let newestCalls = true;
	const answered = new Set<string>();
	let repeated: { call: string; key: string; times: number; open: boolean } | null = null;
	try {
		for (const entry of tailEntries(path)) {
			mark ??= typeof entry.id === "string" ? entry.id : typeof entry.timestamp === "string" ? entry.timestamp : null;
			const message = entry.type === "message" && isObject(entry.message) ? entry.message : null;
			if (!message) continue;
			// A prompt, such as the supervisor's own restart, starts a new run: what came before it is answered.
			if (isUserPrompt(message)) break;
			const result = toolResultOf(message);
			if (result?.callId) answered.add(result.callId);
			if (result?.isError && lastError === null) lastError = oneLine(textOf(result.content)) || `${result.toolName} failed`;
			const calls = toolCallsOf(message);
			// Only the newest message's calls can still run: an older one's would have been answered before the session went on.
			if (newestCalls && calls.length > 0) {
				newestCalls = false;
				const open = calls.find(call => !answered.has(call.id));
				if (open) running = callLabel(open);
			}
			// Newest first: the last call of the newest message is the newest call.
			for (const call of calls.toReversed()) {
				const key = `${call.name}\n${JSON.stringify(call.args)}`;
				if (repeated === null) repeated = { call: callLabel(call), key, times: 1, open: true };
				else if (repeated.open && repeated.key === key) repeated.times++;
				else repeated.open = false;
			}
		}
	} catch {
		return null;
	}
	return { mark, repeated: repeated && { call: repeated.call, times: repeated.times }, running, lastError };
}

/** What the supervisor needs of a task's live session. */
export interface SupervisedSession {
	/** Whether a turn runs, not waiting on you. */
	busy: boolean;
	/** What its subagents do now, which changes as they work while the session's own file stays still. */
	activity: string;
	interrupt(): Promise<WithdrawnMessage[]>;
}

export interface RouterSupervisorDeps {
	tasks: Pick<RouterTasks, "value" | "change" | "restart">;
	/** Whether this server supervises: the one that holds the owner lock. */
	active(): boolean;
	/** Session `sessionId` as it runs here, `null` when it does not. */
	live(sessionId: string): SupervisedSession | null;
	/** The end of session `sessionId`'s file, `null` when it is not found. */
	tail(sessionId: string): TaskTail | null;
	/** Session `sessionId` live, resumed when it does not run; rejects when it does not resume. */
	reach(sessionId: string): Promise<Pick<LiveSession, "prompt">>;
	/** Tells Router `botId` something in its conversation. */
	tell(botId: BotId, text: string): Promise<unknown>;
}

/** What the supervisor saw of a task at its last look. */
interface Seen {
	mark: string;
	/** Looks in a row that saw nothing new. */
	still: number;
}

/** The follow-up that restarts a task's session, with the messages the stop took back. */
export function restartPrompt(reason: string, lastError: string | null, withdrawn: readonly WithdrawnMessage[]): string {
	const prompt = `The supervisor restarted you: ${reason}. Last error: ${lastError ?? "none"}. Continue the task.`;
	return withdrawn.length === 0 ? prompt : [prompt, "These messages were waiting for you when it stopped you:", ...withdrawn.map(({ text }) => text)].join("\n\n");
}

export class RouterSupervisor {
	readonly #deps: RouterSupervisorDeps;
	readonly #seen = new Map<string, Seen>();

	constructor(deps: RouterSupervisorDeps) {
		this.#deps = deps;
	}

	/** One look at every working task; the timer calls it every {@link SUPERVISOR_TICK_MS}. */
	async check(): Promise<void> {
		if (!this.#deps.active()) {
			this.#seen.clear();
			return;
		}
		const working = this.#deps.tasks.value.flatMap(task => (task.status === "working" && task.sessionId !== null ? [{ task, sessionId: task.sessionId }] : []));
		for (const id of this.#seen.keys()) if (!working.some(({ task }) => task.id === id)) this.#seen.delete(id);
		for (const { task, sessionId } of working) {
			await this.#look(task, sessionId).catch((error: unknown) => console.error(`omp-agents: cannot supervise task ${task.id}: ${errorText(error)}`));
		}
	}

	async #look(task: RouterTask, sessionId: string): Promise<void> {
		const live = this.#deps.live(sessionId);
		const tail = this.#deps.tail(sessionId);
		if (live && !live.busy) {
			// It waits on you, or its turn just ended and the task moves to review.
			this.#seen.delete(task.id);
			return;
		}
		if (live && tail?.repeated && tail.repeated.times >= LOOP_REPEATS) {
			return this.#restart(task, sessionId, live, `it ran ${tail.repeated.call} ${tail.repeated.times} times in a row`, tail.lastError);
		}
		// A session gone that still writes runs elsewhere, as under another server, so only a still file counts.
		const mark = `${tail?.mark ?? ""}\n${live?.activity ?? ""}`;
		const seen = this.#seen.get(task.id);
		const still = seen?.mark === mark ? seen.still + 1 : 0;
		this.#seen.set(task.id, { mark, still });
		const limit = live && tail?.running ? LONG_CALL_CHECKS : STALL_CHECKS;
		if (still < limit) return;
		const minutes = Math.round((limit * SUPERVISOR_TICK_MS) / 60_000);
		const stalled = tail?.running && live ? `it made no progress for ${minutes} minutes while ${tail.running} ran` : `it made no progress for ${minutes} minutes`;
		return this.#restart(task, sessionId, live, live ? stalled : "its session died", tail?.lastError ?? null);
	}

	async #restart(task: RouterTask, sessionId: string, live: SupervisedSession | null, reason: string, lastError: string | null): Promise<void> {
		this.#seen.delete(task.id);
		if (task.restarts >= MAX_RESTARTS) {
			if (!this.#deps.tasks.change({ op: "finish", id: task.id, status: "stopped", note: reason })) return;
			await this.#deps.tell(task.botId, `The supervisor stopped task "${task.title}" after ${MAX_RESTARTS} restarts: ${reason}.`);
			return;
		}
		// A restart that fails stops the task, with why as its note, and its Router hears of it.
		const restarted = await this.#deps.tasks
			.restart(task.id, reason, async () => {
				const withdrawn = live ? await live.interrupt() : [];
				const session = await this.#deps.reach(sessionId);
				await session.prompt(null, restartPrompt(reason, lastError, withdrawn), [], "followUp");
			})
			.catch(async (error: unknown) => {
				await this.#deps.tell(task.botId, `The supervisor stopped task "${task.title}": it could not restart it: ${errorText(error)}.`);
				return false;
			});
		if (restarted && !task.quiet) await this.#deps.tell(task.botId, `FYI: the supervisor restarted task "${task.title}": ${reason}.`);
	}
}
