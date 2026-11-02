/**
 * The tasks Router Bots hand to background sessions, kept in `router-tasks.json` beside `bots.json`, and how each moves
 * as its session works: a turn that ends, or a session that End session ends, while it works moves it to review and
 * tells its Router; a session that goes down on its own mid-turn is handed back for the supervisor to restart.
 * Only the server that holds the owner lock changes the file, so two servers never tell a Router twice; nothing else reads or writes it.
 */
import { errorText } from "../json";
import type { BotId } from "../shared/bots";
import { followKey, isOpenTask, parseRouterTasks, type RouterTask, type RouterTaskChange, type TaskFollow, type TaskStatus, uniqueFollows } from "../shared/router";
import type { ServerMsg } from "../shared/protocol";
import { oneLine } from "../session-entries";
import { ReducerFile } from "../fs";
import { PLAIN_LAUNCH } from "../omp/rpc";
import type { StartRequest } from "../shared/sessions";
import type { SessionJoin } from "./start";

export type RouterTaskEdit =
	| { op: "add"; task: RouterTask }
	| { op: "status"; id: string; status: TaskStatus; note: string | null }
	| { op: "session"; id: string; sessionId: string }
	| { op: "follow"; id: string; follows: TaskFollow[] }
	/** Something the task follows happened and went to its session: it works again, as of now. */
	| { op: "heard"; id: string }
	/** The supervisor restarted a working task's session, for `note`. */
	| { op: "restart"; id: string; note: string }
	| { op: "remove-bot"; botId: BotId };

/** `tasks` after `edit` at `now`, or `tasks` itself when it changes nothing; adding a task id already kept changes nothing, so a request read twice adds once. */
export function applyRouterTask(tasks: RouterTask[], edit: RouterTaskEdit, now: number): RouterTask[] {
	const change = (id: string, next: (task: RouterTask) => RouterTask | null): RouterTask[] => {
		const task = tasks.find(candidate => candidate.id === id);
		const changed = task && next(task);
		return task && changed ? tasks.map(candidate => (candidate === task ? { ...changed, updatedAt: now } : candidate)) : tasks;
	};
	switch (edit.op) {
		case "add":
			return tasks.some(({ id }) => id === edit.task.id) ? tasks : [...tasks, edit.task];
		case "status":
			return change(edit.id, task => (task.status === edit.status && task.note === edit.note ? null : { ...task, status: edit.status, note: edit.note }));
		case "session":
			return change(edit.id, task => (task.sessionId === edit.sessionId ? null : { ...task, sessionId: edit.sessionId }));
		case "follow":
			return change(edit.id, task => {
				const follows = uniqueFollows([...task.follows, ...edit.follows]);
				return follows.length === task.follows.length ? null : { ...task, follows };
			});
		case "heard":
			return change(edit.id, task => ({ ...task, status: task.status === "review" ? "working" : task.status }));
		case "restart":
			return change(edit.id, task => (task.status === "working" ? { ...task, restarts: task.restarts + 1, note: edit.note } : null));
		case "remove-bot":
			return tasks.some(({ botId }) => botId === edit.botId) ? tasks.filter(({ botId }) => botId !== edit.botId) : tasks;
	}
}

/** The tasks file, which only {@link RouterTasks} reads and writes. */
class RouterTasksFile extends ReducerFile<RouterTask[], [edit: RouterTaskEdit, now: number]> {
	constructor(path: string) {
		super(path, { parse: parseRouterTasks, toJson: tasks => ({ tasks }), holds: "a list of Router tasks", empty: [], reduce: applyRouterTask });
	}
}

export interface RouterTasksDeps {
	/** The tasks file, `router-tasks.json`. */
	path: string;
	/** Whether this server changes the tasks: the one that holds the owner lock. */
	active(): boolean;
	/** Tells Router `botId` something in its conversation. */
	tell(botId: BotId, text: string): Promise<unknown>;
	/** Ends the running session `sessionId`, if it runs. */
	end(sessionId: string): Promise<void>;
	now(): number;
	/** The tasks changed, for the pages to hear. */
	onChange(): void;
}

/** `reply`'s last line as one short line, as a finished task tells its Router what it said. */
function lastLine(reply: string | null): string | null {
	const line = reply?.split("\n").findLast(text => text.trim() !== "");
	return line ? oneLine(line) : null;
}

/** The tasks' lives: started, bound to the session doing them, moved as that session works, and marked by its Router or the page. */
export class RouterTasks {
	readonly #deps: RouterTasksDeps;
	readonly #file: RouterTasksFile;
	/** The task each running session works on, by instance id, so a session that moves to another file keeps its task. */
	readonly #instances = new Map<string, string>();
	/** The tasks whose session the supervisor stops to restart, so the turn it stops ends without moving the task to review. */
	readonly #restarting = new Set<string>();

	constructor(deps: RouterTasksDeps) {
		this.#deps = deps;
		this.#file = new RouterTasksFile(deps.path);
	}

	get value(): RouterTask[] {
		return this.#file.value;
	}

	get(id: string): RouterTask | undefined {
		return this.value.find(task => task.id === id);
	}

	forBot(botId: BotId): RouterTask[] {
		return this.value.filter(task => task.botId === botId);
	}

	/** The open tasks that follow what `follow` names, so what happens there reaches them. */
	following(follow: TaskFollow): RouterTask[] {
		const key = followKey(follow);
		return this.value.filter(task => isOpenTask(task) && task.follows.some(candidate => followKey(candidate) === key));
	}

	bySession(sessionId: string): RouterTask | undefined {
		return this.value.find(task => task.sessionId === sessionId);
	}

	msg(): Extract<ServerMsg, { t: "router-tasks" }> {
		return { t: "router-tasks", tasks: this.value };
	}

	reload(): void {
		this.#file.reload();
	}

	/** Applies `edit` and tells the pages when it changed something. */
	apply(edit: RouterTaskEdit): boolean {
		const changed = this.#file.apply(edit, this.#deps.now());
		if (changed) this.#deps.onChange();
		return changed;
	}

	/** Task `id` runs in session `sessionId`, live as `instanceId`, as its start found. */
	bind(instanceId: string, id: string, sessionId: string): void {
		this.#instances.set(instanceId, id);
		this.apply({ op: "session", id, sessionId });
	}

	/** How `request` joins the server: the resume of a task's session, as the supervisor's, a message's, or a restarted server's, binds that task to it once it is live. */
	join(request: StartRequest): SessionJoin {
		const id = request.kind === "resume" ? this.bySession(request.sessionId)?.id : undefined;
		return { rpc: PLAIN_LAUNCH, attach: id === undefined ? () => {} : session => void this.#instances.set(session.instanceId, id) };
	}

	/** The task live session `instanceId` works on. */
	#taskOf(instanceId: string): RouterTask | undefined {
		const id = this.#instances.get(instanceId);
		return id === undefined ? undefined : this.get(id);
	}

	/** Live session `instanceId` moved to session file `sessionId`, as on an edited prompt; its task follows it. */
	switched(instanceId: string, sessionId: string): void {
		const id = this.#instances.get(instanceId);
		if (id !== undefined && this.#deps.active()) this.apply({ op: "session", id, sessionId });
	}

	/** Someone prompted a task waiting for review, so it works again. */
	turnStarted(instanceId: string): void {
		const task = this.#taskOf(instanceId);
		if (task) this.#restarting.delete(task.id);
		if (task?.status === "review" && this.#deps.active()) this.apply({ op: "status", id: task.id, status: "working", note: null });
	}

	/**
	 * Restarts working task `id` for `note` with `run`, which stops its session and prompts it to go on; the turn the stop
	 * ends does not move the task to review. The restart counts once `run` resolves; when it rejects, the task is stopped
	 * with why as its note, and the error is thrown on. Whether the task was working.
	 */
	async restart(id: string, note: string, run: () => Promise<void>): Promise<boolean> {
		if (this.get(id)?.status !== "working") return false;
		this.#restarting.add(id);
		try {
			await run();
		} catch (error) {
			this.#restarting.delete(id);
			this.change({ op: "finish", id, status: "stopped", note: `The supervisor could not restart it: ${errorText(error)}` });
			throw error;
		}
		this.apply({ op: "restart", id, note });
		return true;
	}

	/** The task's session ended its turn with `reply`: a working task moves to review, and tells its Router unless it is quiet. */
	turnEnded(instanceId: string, reply: string | null): Promise<void> {
		return this.#finished(this.#taskOf(instanceId), lastLine(reply));
	}

	/**
	 * The task's session exited, `ended` when End session ended it. A working task moves to review, unless its session went
	 * down on its own mid-turn, as on a crash or a kill: that task is returned, for the supervisor to restart.
	 */
	exited(instanceId: string, ended: boolean): RouterTask | null {
		const task = this.#taskOf(instanceId);
		this.#instances.delete(instanceId);
		if (!ended && task?.status === "working" && !this.#restarting.has(task.id) && this.#deps.active()) return task;
		void this.#finished(task, null);
		return null;
	}

	async #finished(task: RouterTask | undefined, line: string | null): Promise<void> {
		const restarting = task !== undefined && this.#restarting.delete(task.id);
		if (task?.status !== "working" || !this.#deps.active() || restarting) return;
		this.apply({ op: "status", id: task.id, status: "review", note: null });
		if (task.quiet) return;
		await this.#deps.tell(task.botId, `Task "${task.title}" finished: ${line ?? "its session ended without a reply."}`).catch((error: unknown) => {
			console.error(`omp-agents: cannot tell Router ${task.botId} that task ${task.id} finished: ${errorText(error)}`);
		});
	}

	/** Marks a task, for its Router's `finish_task` or the page's Mark done and Stop; a stopped task's session ends. */
	change({ id, status, note }: RouterTaskChange): boolean {
		const task = this.get(id);
		if (!task || !this.apply({ op: "status", id, status, note })) return false;
		if (status === "stopped") this.#end(task);
		return true;
	}

	/** Ends `task`'s session, if it has one, without waiting; its exit then finds the task stopped and tells nobody. */
	#end(task: RouterTask): void {
		if (task.sessionId) this.#deps.end(task.sessionId).catch((error: unknown) => console.error(`omp-agents: cannot end task ${task.id}'s session: ${errorText(error)}`));
	}
}
