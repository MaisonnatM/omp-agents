/**
 * The tasks Router Bots hand to background sessions, kept in `router-tasks.json` beside `bots.json`, and how each moves
 * as its session works: a turn that ends, or a session that exits, while it works moves it to review and tells its Router.
 * Only the server that holds the owner lock changes the file, so two servers never tell a Router twice.
 */
import { errorText } from "../json";
import type { TurnReply } from "../live-session";
import type { BotId } from "../shared/bots";
import { followKey, isOpenTask, parseRouterTasks, type RouterTask, type RouterTaskChange, type TaskFollow, type TaskStatus, uniqueFollows } from "../shared/router";
import type { ServerMsg } from "../shared/protocol";
import { oneLine } from "../session-entries";
import { ReducerFile } from "../fs";

export type RouterTaskEdit =
	| { op: "add"; task: RouterTask }
	| { op: "status"; id: string; status: TaskStatus; note: string | null }
	| { op: "session"; id: string; sessionId: string }
	| { op: "follow"; id: string; follows: TaskFollow[] }
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
		case "remove-bot":
			return tasks.some(({ botId }) => botId === edit.botId) ? tasks.filter(({ botId }) => botId !== edit.botId) : tasks;
	}
}

export class RouterTasksFile extends ReducerFile<RouterTask[], [edit: RouterTaskEdit, now: number]> {
	constructor(path: string) {
		super(path, { parse: parseRouterTasks, toJson: tasks => ({ tasks }), holds: "a list of Router tasks", empty: [], reduce: applyRouterTask });
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
}

export interface RouterTasksDeps {
	file: RouterTasksFile;
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
function lastLine(reply: TurnReply | null): string | null {
	const line = reply?.body.split("\n").findLast(text => text.trim() !== "");
	return line ? oneLine(line) : null;
}

/** The tasks' lives: started, bound to the session doing them, moved as that session works, and marked by the page. */
export class RouterTasks {
	readonly #deps: RouterTasksDeps;
	/** The task each running session works on, by instance id, so a session that moves to another file keeps its task. */
	readonly #instances = new Map<string, string>();

	constructor(deps: RouterTasksDeps) {
		this.#deps = deps;
	}

	msg(): Extract<ServerMsg, { t: "router-tasks" }> {
		return { t: "router-tasks", tasks: this.#deps.file.value };
	}

	reload(): void {
		this.#deps.file.reload();
	}

	/** Applies `edit` and tells the pages when it changed something. */
	apply(edit: RouterTaskEdit): boolean {
		const changed = this.#deps.file.apply(edit, this.#deps.now());
		if (changed) this.#deps.onChange();
		return changed;
	}

	/** Task `id` runs in session `sessionId`, live as `instanceId`. */
	bind(instanceId: string, id: string, sessionId: string): void {
		this.#instances.set(instanceId, id);
		this.apply({ op: "session", id, sessionId });
	}

	/** The open task live session `instanceId` works on: the one bound to it, else the one its session runs, as after a restart. */
	#taskOf(instanceId: string, sessionId: string | undefined): RouterTask | undefined {
		const { file } = this.#deps;
		const bound = this.#instances.get(instanceId);
		const task = bound === undefined ? (sessionId ? file.bySession(sessionId) : undefined) : file.get(bound);
		if (task && bound === undefined) this.#instances.set(instanceId, task.id);
		return task;
	}

	/** Live session `instanceId` moved to session file `sessionId`, as on an edited prompt; its task follows it. */
	switched(instanceId: string, sessionId: string): void {
		const id = this.#instances.get(instanceId);
		if (id !== undefined && this.#deps.active()) this.apply({ op: "session", id, sessionId });
	}

	/** Someone prompted a task waiting for review, so it works again. */
	turnStarted(instanceId: string, sessionId: string | undefined): void {
		const task = this.#taskOf(instanceId, sessionId);
		if (task?.status === "review" && this.#deps.active()) this.apply({ op: "status", id: task.id, status: "working", note: null });
	}

	/** The task's session ended its turn with `reply`: a working task moves to review, and tells its Router unless it is quiet. */
	turnEnded(instanceId: string, sessionId: string | undefined, reply: TurnReply | null): Promise<void> {
		return this.#finished(this.#taskOf(instanceId, sessionId), lastLine(reply));
	}

	/** The task's session exited; one still working moves to review. */
	exited(instanceId: string, sessionId: string | undefined): Promise<void> {
		const task = this.#taskOf(instanceId, sessionId);
		this.#instances.delete(instanceId);
		return this.#finished(task, null);
	}

	async #finished(task: RouterTask | undefined, line: string | null): Promise<void> {
		if (task?.status !== "working" || !this.#deps.active()) return;
		this.apply({ op: "status", id: task.id, status: "review", note: null });
		if (task.quiet) return;
		await this.#deps.tell(task.botId, `Task "${task.title}" finished: ${line ?? "its session ended without a reply."}`).catch((error: unknown) => {
			console.error(`omp-agents: cannot tell Router ${task.botId} that task ${task.id} finished: ${errorText(error)}`);
		});
	}

	/** Marks task `id` as `status` for its Router's `finish_task`; a stopped task's session ends. */
	finish(id: string, status: Exclude<TaskStatus, "working">, note: string | null): boolean {
		const task = this.#deps.file.get(id);
		if (!task || !this.apply({ op: "status", id, status, note })) return false;
		if (status === "stopped") this.#end(task);
		return true;
	}

	/** The page's change, which the list registry publishes: Mark done, or Stop, which ends the task's session once the change is saved. */
	change(change: RouterTaskChange): boolean {
		const task = this.#deps.file.get(change.id);
		if (!task || !this.#deps.file.apply({ op: "status", id: change.id, status: change.status, note: null }, this.#deps.now())) return false;
		if (change.status === "stopped") this.#end(task);
		return true;
	}

	/** Ends `task`'s session, if it has one, without waiting; its exit then finds the task stopped and tells nobody. */
	#end(task: RouterTask): void {
		if (task.sessionId) this.#deps.end(task.sessionId).catch((error: unknown) => console.error(`omp-agents: cannot end task ${task.id}'s session: ${errorText(error)}`));
	}
}
