/**
 * What the Board does on its own while this server runs the unattended work: it starts a new session on each ready
 * Board task, a reopened one included, wakes the session a reply is for, stops and re-prompts that session when the
 * user edits one of their messages, and returns each lapsed claim to ready. See docs/architecture/board.md.
 */
import { type BoardAuthor, type BoardChange, type BoardLaunch, type BoardState, type BoardTask, lapsed, startedOn, unstartedReady, wakeTarget } from "../../templates/omp/agent/extensions/board/log";
import { errorText } from "../json";
import type { ModuleRun, ModuleRunCore } from "../modules";
import { DASHBOARD_PROMPT_PREFIX } from "../shared/transcript";
import { repeat } from "./loops";

/** How often the sweep looks for lapsed claims. */
export const SWEEP_MS = 30_000;

/**
 * How a Board session finishes, so none stays running and none merges unasked: it commits on its branch, or opens a
 * draft PR, marks the Board task done with a message that ends on suggested next prompts, then ends itself. The user's
 * reply or picked suggestion reopens the Board task, and a new session takes it from the thread.
 */
const finish = (id: number): string =>
	[
		"When the work is done, finish it yourself, and leave merging to the user:",
		"1. If you changed files, commit them on your branch; where the repository has no .omp/land.json, push the branch and open a draft PR. Land or merge only when the user's last reply asks for it, such as \"Merge on main\".",
		`2. Mark Board task #${id} done with the board tool. Its text is the message the user reads in the thread: a short lead line, a few bullets on what changed and where, the branch or the PR link, then a Suggestions block, a line "Suggestions:" followed by one to three numbered prompts, best first, such as "1. Merge on main". Never suggest ending the session, alone or after another step such as "Merge on main, then end the session": the session that takes a pick from the thread ends itself. When the work changed something the user can see, such as a page, a dialog, or a layout, put the screenshots you checked in that text as ![<what it shows>](<absolute PNG path>), one per changed state, so the thread shows them. The user picks one or replies, and a new session takes it from the thread.`,
		"3. Call end_session; your committed branch stays.",
	].join("\n");

const authorName = (by: BoardAuthor): string => (by.kind === "user" ? "The user" : `Session ${by.sessionId}`);

/** What a session on a reopened Board task learns of the rounds before it: who worked on it, and the thread, which ends on what to do now. */
function earlierRounds(task: BoardTask): string[] {
	const thread = task.replies.flatMap(entry => ("by" in entry ? [`${authorName(entry.by)}: ${entry.text}`] : []));
	if (thread.length === 0) return [];
	const earlier = startedOn(task);
	return [
		...(earlier.length > 0 ? [`Earlier sessions worked on it and ended: ${earlier.join(", ")}. Their work sits on the branch or pull request the thread names; continue it in a worktree of that branch, or land that worktree by passing it as the land tool's path. Read an earlier session's transcript through eval's archive only when the thread leaves out something you need.`] : []),
		"Its Board thread so far, oldest first; the last reply says what to do now:",
		"<board-thread>",
		...thread,
		"</board-thread>",
	];
}

/**
 * What a session started on Board task `task` reads first. omp titles the session from this prompt, so the task leads
 * and the Board's steps, and the thread of a reopened Board task, sit in a `<board-task>` block the titler skips; as
 * plain lines they name every session "Claim Board task 5" instead of its work.
 */
export const startPrompt = (task: BoardTask): string =>
	[
		task.title,
		...(task.text ? ["", task.text] : []),
		"",
		`<board-task id="${task.id}">`,
		`This session was started to do Board task #${task.id}. First claim it with the board tool (action claim, task ${task.id}), which also shows its Board thread.`,
		...earlierRounds(task),
		"The claim holds a 15-minute lease: renew it while you work. Reply on the thread only to ask what you cannot settle yourself.",
		finish(task.id),
		"</board-task>",
	].join("\n");

/** What the session a reply is for reads: it answers or does the follow-up, then finishes as a started session does. */
export const wakePrompt = (task: BoardTask, by: BoardAuthor, text: string): string =>
	`${DASHBOARD_PROMPT_PREFIX} ${authorName(by)} replied on Board task #${task.id} (${task.title}):\n\n${text}\n\nWhen it only asks a question, answer on its thread with the board tool (action reply, task ${task.id}); when it asks for more work, do it.\n${finish(task.id)}`;

/** What the session reads after the user edited one of their messages, which stopped its turn: the message's new text replaces the old. */
export const editPrompt = (task: BoardTask, text: string): string =>
	`${DASHBOARD_PROMPT_PREFIX} The user edited their message on Board task #${task.id} (${task.title}), which stopped your turn. It now reads:\n\n${text}\n\nThis replaces what that message said before: drop the work only the old text asked for, and carry on from this one. When it only asks a question, answer on its thread with the board tool (action reply, task ${task.id}).\n${finish(task.id)}`;

/** When the user last edited `task` or one of its replies; 0 when they never did. */
const lastEdit = (task: BoardTask): number => Math.max(task.editedAt ?? 0, ...task.replies.map(entry => ("by" in entry ? (entry.editedAt ?? 0) : 0)));

/** The texts of `task` and its replies edited after `since`, oldest message first. */
const editedAfter = (task: BoardTask, since: number): string[] => [
	...((task.editedAt ?? 0) > since ? [task.text || task.title] : []),
	...task.replies.flatMap(entry => ("by" in entry && (entry.editedAt ?? 0) > since ? [entry.text] : [])),
];

export class BoardRunner implements ModuleRun {
	readonly #state: () => BoardState;
	readonly #apply: (change: BoardChange) => boolean;
	readonly #core: ModuleRunCore;
	/** The Board tasks a start is under way for, so a change meanwhile starts no second session. */
	readonly #starting = new Set<number>();
	/** How many replies each Board task had, and when it was last edited, when this runner last looked, so it acts only on what is new; `null` until it first looks. */
	#seen: Map<number, { replies: number; edited: number }> | null = null;
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

	/** Starts what became ready, wakes who a new reply is for, and re-prompts who an edit is for; called after every change to the Board. */
	changed(): void {
		const state = this.#state();
		const seen = this.#seen;
		this.#seen = new Map(state.tasks.map(task => [task.id, { replies: task.replies.length, edited: lastEdit(task) }]));
		if (!this.#core.owner()) return;
		const ready = unstartedReady(state);
		// A reply or edit on a Board task about to start, such as the reply that reopened it, reaches its new session through the start prompt.
		const starting = new Set(ready.map(task => task.id));
		if (seen)
			for (const task of state.tasks) {
				if (starting.has(task.id)) continue;
				const before = seen.get(task.id);
				for (const entry of task.replies.slice(before?.replies ?? 0))
					if ("by" in entry) {
						const target = wakeTarget(task, entry.by);
						if (target !== null) void this.#wake(task, target, wakePrompt(task, entry.by, entry.text), entry.launch);
					}
				// An edit stops the turn that worked from the message's old text, and sends the new one.
				const target = before && lastEdit(task) > before.edited ? wakeTarget(task, { kind: "user" }) : null;
				if (target !== null) for (const text of editedAfter(task, before?.edited ?? 0)) void this.#wake(task, target, editPrompt(task, text), undefined, true);
			}
		for (const task of ready) if (!this.#starting.has(task.id)) void this.#start(task);
	}

	/**
	 * Returns each lapsed claim, or start nobody claimed, to ready, which starts a new session on it. A Board task whose
	 * session still runs a turn or waits on a question stays its own: under load a session misses its renewal, and
	 * expiring it then started a second session on the same work, again and again.
	 */
	async sweep(): Promise<void> {
		if (!this.#core.owner()) return;
		for (const task of lapsed(this.#state(), this.#core.now())) {
			const holder = task.claim?.sessionId ?? task.start?.sessionId ?? null;
			if (holder !== null && this.#core.working(holder)) continue;
			this.#change({ op: "expire", task: task.id });
		}
	}

	async #start(task: BoardTask): Promise<void> {
		this.#starting.add(task.id);
		try {
			const started = await this.#core.start(task.workspace, startPrompt(task), task.launch ?? undefined);
			this.#change("sessionId" in started ? { op: "start", task: task.id, sessionId: started.sessionId } : { op: "start", task: task.id, sessionId: null, error: started.error });
		} finally {
			this.#starting.delete(task.id);
		}
	}

	async #wake(task: BoardTask, sessionId: string, prompt: string, launch?: BoardLaunch, interrupt = false): Promise<void> {
		try {
			const { resumed } = await this.#core.wake(sessionId, prompt, launch, interrupt);
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
