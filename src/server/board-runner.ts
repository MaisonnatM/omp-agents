/**
 * What the Board does on its own while this server runs the unattended work: it starts a new session on each ready
 * Board task, wakes the session a reply is for, and returns each lapsed claim to ready. See docs/architecture/board.md.
 */
import { type BoardAuthor, type BoardChange, type BoardState, type BoardTask, lapsed, unstartedReady, wakeTarget } from "../../templates/omp/agent/extensions/board/log";
import { errorText } from "../json";
import type { ModuleRun, ModuleRunCore } from "../modules";
import { DASHBOARD_PROMPT_PREFIX } from "../shared/transcript";
import { repeat } from "./loops";

/** How often the sweep looks for lapsed claims. */
export const SWEEP_MS = 30_000;

/** What a session started on Board task `task` reads first. */
export const startPrompt = (task: BoardTask): string =>
	[
		`Board task #${task.id} on the omp-agents Board is ready, and this session was started to do it: ${task.title}`,
		...(task.text ? ["", task.text] : []),
		"",
		`First claim it with the board tool (action claim, task ${task.id}), which also shows its Board thread.`,
		"The claim holds a 15-minute lease: renew it while you work.",
		"Reply on the thread to ask or report, and when you finish, mark it done with a line on what you did.",
	].join("\n");

const authorName = (by: BoardAuthor): string => (by.kind === "user" ? "The user" : `Session ${by.sessionId}`);

/** What the session a reply is for reads. */
export const wakePrompt = (task: BoardTask, by: BoardAuthor, text: string): string =>
	`${DASHBOARD_PROMPT_PREFIX} ${authorName(by)} replied on Board task #${task.id} (${task.title}):\n\n${text}\n\nAnswer on its thread with the board tool (action reply, task ${task.id}).`;

export class BoardRunner implements ModuleRun {
	readonly #state: () => BoardState;
	readonly #apply: (change: BoardChange) => boolean;
	readonly #core: ModuleRunCore;
	/** The Board tasks a start is under way for, so a change meanwhile starts no second session. */
	readonly #starting = new Set<number>();
	/** How many replies each Board task had when this runner last looked, so it wakes only for new ones; `null` until it first looks. */
	#seen: Map<number, number> | null = null;
	#stopSweep: (() => void) | null = null;

	constructor(state: () => BoardState, apply: (change: BoardChange) => boolean, core: ModuleRunCore) {
		this.#state = state;
		this.#apply = apply;
		this.#core = core;
	}

	start(): void {
		this.#stopSweep = repeat("Board lease sweep", () => this.sweep(), SWEEP_MS);
		this.changed();
	}

	stop(): void {
		this.#stopSweep?.();
	}

	/** Starts what became ready and wakes who a new reply is for; called after every change to the Board. */
	changed(): void {
		const state = this.#state();
		const seen = this.#seen;
		this.#seen = new Map(state.tasks.map(task => [task.id, task.replies.length]));
		if (!this.#core.owner()) return;
		if (seen)
			for (const task of state.tasks)
				for (const entry of task.replies.slice(seen.get(task.id) ?? 0))
					if ("by" in entry) {
						const target = wakeTarget(task, entry.by);
						if (target !== null) void this.#wake(task, target, entry.by, entry.text);
					}
		for (const task of unstartedReady(state)) if (!this.#starting.has(task.id)) void this.#start(task);
	}

	/** Returns each lapsed claim, or start nobody claimed, to ready, which starts a new session on it. */
	async sweep(): Promise<void> {
		if (!this.#core.owner()) return;
		for (const task of lapsed(this.#state(), this.#core.now())) this.#change({ op: "expire", task: task.id });
	}

	async #start(task: BoardTask): Promise<void> {
		this.#starting.add(task.id);
		try {
			const started = await this.#core.start(task.workspace, startPrompt(task));
			this.#change("sessionId" in started ? { op: "start", task: task.id, sessionId: started.sessionId } : { op: "start", task: task.id, sessionId: null, error: started.error });
		} finally {
			this.#starting.delete(task.id);
		}
	}

	async #wake(task: BoardTask, sessionId: string, by: BoardAuthor, text: string): Promise<void> {
		try {
			const { resumed } = await this.#core.wake(sessionId, wakePrompt(task, by, text));
			if (resumed) this.#change({ op: "woke", task: task.id, sessionId });
		} catch (error) {
			console.error(`omp-agents: could not wake ${sessionId} for Board task #${task.id}: ${errorText(error)}`);
		}
	}

	#change(change: BoardChange): void {
		try {
			this.#apply(change);
		} catch (error) {
			console.error(`omp-agents: the Board refused ${change.op} on #${"task" in change ? change.task : "?"}: ${errorText(error)}`);
		}
	}
}
