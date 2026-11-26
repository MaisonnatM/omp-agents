/**
 * What the Board does on its own while this server runs the unattended work: it starts a new session on each ready
 * Board task, a reopened one included, in the task's own worktree; lands a done Board task's branch when the user
 * replies a bare "Merge on main"; wakes the session a reply is for; stops and re-prompts that session when the user
 * edits one of their messages; ends a started session once the turn that marked its Board task done ends; and returns
 * a Board task to ready when its session exits without marking it done. See docs/architecture/board.md.
 */
import { type BoardAuthor, type BoardChange, type BoardLaunch, type BoardState, type BoardTask, branchOf, holderOf, landsOnReply, MAX_TEXT, MERGE_REPLY, startedOn, unstartedReady, wakeTarget } from "../../templates/omp/agent/extensions/board/log";
import { errorText } from "../json";
import type { ModuleRun, ModuleRunCore } from "../modules";
import { DASHBOARD_PROMPT_PREFIX } from "../shared/transcript";
import { repeat } from "./loops";

/** How often the sweep ends the sessions whose done turn ended, and looks for sessions that exited. */
export const SWEEP_MS = 3_000;
/**
 * How long the session holding a Board task must be gone before the task returns to ready: a restarted server
 * attaches to the sessions still running within seconds, and freeing their tasks meanwhile would start a second one.
 */
export const GONE_MS = 30_000;

/** The branch every session on Board task `id` works on, in a worktree the runner adds for it. */
export const taskBranch = (id: number): string => `board/${id}`;

/** Where a session on a Board task works: the task's worktree on its branch, or, outside git, the Workspace itself. */
export type TaskCheckout = { dir: string; branch: string } | { dir: string; branch: null };

/**
 * How a Board session finishes, so none merges unasked: it commits on the task's branch, then marks the Board task
 * done with a message that ends on suggested next prompts, which ends the session. The user's reply or picked
 * suggestion reopens the Board task, and a new session takes it from the thread; a bare "Merge on main" the server lands.
 */
const finish = (id: number): string =>
	[
		"When the work is done, finish it yourself:",
		"1. If you changed files, commit them on your branch. Never land, merge, or push to the main branch: when the user picks \"Merge on main\", the Board lands the branch with the repository's checks. Where the repository has no .omp/land.json, push the branch and open a draft PR instead.",
		`2. Mark Board task #${id} done with the board tool, as your last step: that ends this session once the turn ends, and the branch stays. Its text is the message the user reads in the thread: a short lead line, a few bullets on what changed and where, the branch or the PR link, then a Suggestions block, a line "Suggestions:" followed by one to three numbered prompts, best first, such as "1. ${MERGE_REPLY}". When the work changed something the user can see, such as a page, a dialog, or a layout, put the screenshots you checked in that text as ![<what it shows>](<absolute PNG path>), one per changed state, so the thread shows them. The user picks one or replies, and a new session takes it from the thread.`,
	].join("\n");

/**
 * Keeps a Board thread a conversation: a session builds a clear request right away, and replies first with what it
 * understood and what it would do only when the request is unclear, which the user answers before any work starts.
 */
const converse = (id: number): string =>
	[
		"The thread is a conversation with the user, not a work order.",
		"Build right away when the user's last message is clear: it names the exact step, such as a suggestion you offered, or says plainly what to change, with one reasonable reading once you have read the code and the thread.",
		`Ask first only when it is unclear: it could mean changes that differ in what the user would see or get, or it leaves out something the code and the thread do not answer. Then, after reading what you need, change nothing yet: mark Board task #${id} done with a reply that says in a few lines what you understood, the change you would make, and each question or choice still open, then a Suggestions block whose prompts are the likely answers, best first, such as "1. Yes, build that". The user's answer starts the next session.`,
		"Ask the same way when the user's reply says you missed the point: restate what you now understand and ask, instead of building another guess.",
		`When the thread ends on a merge that failed, fix the cause on the branch, commit, and mark the task done with "1. ${MERGE_REPLY}" as the first suggestion.`,
	].join("\n");

const authorName = (by: BoardAuthor): string => (by.kind === "user" ? "The user" : by.kind === "routine" ? `The routine "${by.name}"` : `Session ${by.sessionId}`);

/** What a session on a routine's Board task does when the run finds nothing: a quiet done, which notifies nobody. */
const quietRun = (task: BoardTask): string[] =>
	task.by.kind === "routine"
		? [`Routine "${task.by.name}" posted this Board task, and each of its runs replies on it while it is not done. When a run finds nothing worth reporting, change nothing and mark Board task #${task.id} done with quiet set to true and one line saying so, with no Suggestions block: a quiet done notifies nobody.`]
		: [];

/** The lines of `task`'s thread a session reads: what the user and the sessions said, and how each merge the Board ran went. */
const threadLines = (task: BoardTask): string[] =>
	task.replies.flatMap(entry => {
		if ("by" in entry) return [`${authorName(entry.by)}: ${entry.text}`];
		if (entry.note.kind === "landed") return [`The Board merged the branch: ${entry.note.text}`];
		if (entry.note.kind === "land-failed") return [`The Board's merge failed: ${entry.note.text}`];
		return [];
	});

/** What a session on a reopened Board task learns of the rounds before it: who worked on it, and the thread, which ends on what to do now. */
function earlierRounds(task: BoardTask): string[] {
	const thread = threadLines(task);
	if (thread.length === 0) return [];
	const earlier = startedOn(task);
	return [
		...(earlier.length > 0 ? [`Earlier sessions worked on it and ended: ${earlier.join(", ")}. Their commits are on your branch, unless the thread names another branch or pull request. Read an earlier session's transcript through eval's archive only when the thread leaves out something you need.`] : []),
		"Its Board thread so far, oldest first; the last reply says what to do now:",
		"<board-thread>",
		...thread,
		"</board-thread>",
	];
}

/** Where the session works, as the start prompt tells it. */
const workplace = (task: BoardTask, checkout: TaskCheckout): string =>
	checkout.branch === null
		? `You work in ${checkout.dir}, which is outside git.`
		: `You work in ${checkout.dir}, a worktree on branch ${checkout.branch} with its dependencies installed; every round of this Board task works on that branch. Edit and commit only there, never in the main checkout ${task.workspace}.`;

/**
 * What a session started on Board task `task` reads first, the whole of what the Board asks of it. omp titles the
 * session from this prompt, so the task leads and the Board's steps, and the thread of a reopened Board task, sit in a
 * `<board-task>` block the titler skips; as plain lines they name every session "Board task 5" instead of its work.
 */
export const startPrompt = (task: BoardTask, checkout: TaskCheckout): string =>
	[
		task.title,
		...(task.text ? ["", task.text] : []),
		"",
		`<board-task id="${task.id}">`,
		`This session was started to do Board task #${task.id}, and holds it until it marks it done. ${workplace(task, checkout)}`,
		...earlierRounds(task),
		...quietRun(task),
		converse(task.id),
		finish(task.id),
		"</board-task>",
	].join("\n");

/** What the session a reply is for reads: it answers or does the follow-up, then finishes as a started session does. */
export const wakePrompt = (task: BoardTask, by: BoardAuthor, text: string): string =>
	`${DASHBOARD_PROMPT_PREFIX} ${authorName(by)} replied on Board task #${task.id} (${task.title}):\n\n${text}\n\nWhen it only asks a question, answer on its thread with the board tool (action reply, task ${task.id}); when it asks for more work, do it.\n${[...quietRun(task), converse(task.id), finish(task.id)].join("\n")}`;

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
	/** The Board tasks a merge runs for, so a second "Merge on main" meanwhile runs no second one. */
	readonly #landing = new Set<number>();
	/** The started sessions that marked their Board task done, which the sweep ends once their turn ends. */
	readonly #ending = new Set<string>();
	/** When the sweep first found each holding session gone. */
	readonly #gone = new Map<string, number>();
	/** How many replies each Board task had, and when it was last edited, when this runner last looked, so it acts only on what is new; `null` until it first looks. */
	#seen: Map<number, { replies: number; edited: number }> | null = null;
	#stopSweep: (() => void) | null = null;

	constructor(state: () => BoardState, apply: (change: BoardChange) => boolean, core: ModuleRunCore) {
		this.#state = state;
		this.#apply = apply;
		this.#core = core;
	}

	start(): void {
		this.#stopSweep = repeat("Board session sweep", () => this.sweep(), SWEEP_MS);
		this.changed();
	}

	stop(): void {
		this.#stopSweep?.();
	}

	/** Starts what became ready, lands what the user asked to merge, wakes who a new reply is for, re-prompts who an edit is for, and marks who finished; called after every change to the Board. */
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
				const before = seen.get(task.id);
				for (const entry of task.replies.slice(before?.replies ?? 0)) {
					if ("note" in entry) {
						if (entry.note.kind === "done" && entry.note.sessionId === task.start?.sessionId) this.#ending.add(entry.note.sessionId);
						continue;
					}
					if (landsOnReply(task, entry.by, entry.text)) {
						void this.#land(task);
						continue;
					}
					if (starting.has(task.id)) continue;
					const target = wakeTarget(task, entry.by);
					if (target !== null) void this.#wake(task, target, wakePrompt(task, entry.by, entry.text), entry.launch);
				}
				if (starting.has(task.id)) continue;
				// An edit stops the turn that worked from the message's old text, and sends the new one.
				const target = before && lastEdit(task) > before.edited ? wakeTarget(task, { kind: "user" }) : null;
				if (target !== null) for (const text of editedAfter(task, before?.edited ?? 0)) void this.#wake(task, target, editPrompt(task, text), undefined, true);
			}
		for (const task of ready) if (!this.#starting.has(task.id)) void this.#start(task);
	}

	/**
	 * Ends each started session whose Board task it marked done once that turn ends, and returns to ready each Board
	 * task whose session has been gone for {@link GONE_MS} without marking it done, which starts a new session on it.
	 */
	async sweep(): Promise<void> {
		if (!this.#core.owner()) return;
		for (const sessionId of this.#ending)
			if (!this.#core.working(sessionId)) {
				this.#ending.delete(sessionId);
				void this.#core.end(sessionId).catch((error: unknown) => console.error(`omp-agents: could not end Board session ${sessionId}: ${errorText(error)}`));
			}
		const now = this.#core.now();
		const holders = new Set<string>();
		for (const task of this.#state().tasks) {
			const holder = task.doneAt === null ? holderOf(task) : null;
			if (holder === null) continue;
			holders.add(holder);
			if (this.#core.alive(holder)) {
				this.#gone.delete(holder);
				continue;
			}
			const since = this.#gone.get(holder) ?? now;
			this.#gone.set(holder, since);
			if (now - since >= GONE_MS) this.#change({ op: "expire", task: task.id });
		}
		for (const sessionId of this.#gone.keys()) if (!holders.has(sessionId)) this.#gone.delete(sessionId);
	}

	async #start(task: BoardTask): Promise<void> {
		this.#starting.add(task.id);
		try {
			const branch = taskBranch(task.id);
			let dir: string | null;
			try {
				dir = await this.#core.checkout(task.workspace, branch);
			} catch (error) {
				this.#change({ op: "start", task: task.id, sessionId: null, error: `Could not make its worktree on ${branch}: ${errorText(error)}` });
				return;
			}
			const checkout: TaskCheckout = dir === null ? { dir: task.workspace, branch: null } : { dir, branch };
			const started = await this.#core.start(checkout.dir, startPrompt(task, checkout), task.launch ?? undefined);
			if (!("sessionId" in started)) {
				this.#change({ op: "start", task: task.id, sessionId: null, error: started.error });
				return;
			}
			this.#change({ op: "start", task: task.id, sessionId: started.sessionId, ...(checkout.branch === null ? {} : { branch: checkout.branch, worktree: checkout.dir }) });
		} finally {
			this.#starting.delete(task.id);
		}
	}

	/** Lands `task`'s branch for the user's "Merge on main" and posts how it went; a merge that fails reopens the task. */
	async #land(task: BoardTask): Promise<void> {
		const branch = branchOf(task);
		if (branch === null || this.#landing.has(task.id)) return;
		this.#landing.add(task.id);
		try {
			const dir = await this.#core.checkout(task.workspace, branch);
			if (dir === null) throw new Error(`${task.workspace} is no longer in git.`);
			const { landed, text } = await this.#core.land(dir, startedOn(task).at(-1));
			this.#change({ op: "land", task: task.id, landed, text: text.slice(0, MAX_TEXT) });
		} catch (error) {
			this.#change({ op: "land", task: task.id, landed: false, text: `The merge of ${branch} did not run: ${errorText(error)}`.slice(0, MAX_TEXT) });
		} finally {
			this.#landing.delete(task.id);
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
