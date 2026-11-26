/**
 * What the Board does on its own while this server runs the unattended work: it starts a new session on each ready
 * Board task, a reopened one included, in the task's own worktree; lands a done Board task's branch when the user
 * replies a bare "Merge on main"; wakes the session a reply is for; stops and re-prompts that session when the user
 * edits one of their messages; ends a started session once the turn that marked its Board task done ends, or at once
 * when the user closes it; and returns a Board task to ready when its session exits without marking it done. What it
 * ends and lands it reads from the log, so a restart picks up what the last server left. See docs/architecture/board.md.
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

/** Where a session on a Board task works: the task's worktree on its branch, or, outside git, the Workspace itself with no branch. */
export interface TaskCheckout {
	dir: string;
	branch: string | null;
}

/**
 * How a Board session finishes, so none merges unasked: it commits on the task's branch, then marks the Board task
 * done with a message that ends on suggested next prompts, which ends the session. The user's reply or picked
 * suggestion reopens the Board task, and a new session takes it from the thread; a bare "Merge on main" the server
 * lands, which only a repository with a land config offers.
 */
const finish = (id: number, landable: boolean): string =>
	[
		"When the work is done, finish it yourself:",
		`1. If you changed files, commit them on your branch. Never land, merge, or push to the main branch: ${landable ? `when the user picks "${MERGE_REPLY}", the Board lands the branch with the repository's checks.` : "the repository has no .omp/land.json, so the Board cannot land the branch; push it and open a draft PR instead."}`,
		`2. Mark Board task #${id} done with the board tool, as your last step: that ends this session once the turn ends, and the branch stays. Its text is the message the user reads in the thread: a short lead line, a few bullets on what changed and where, the branch or the PR link, then a Suggestions block, a line "Suggestions:" followed by one to three numbered prompts, best first, such as "1. ${landable ? MERGE_REPLY : "Mark the PR ready for review"}". When the work changed something the user can see, such as a page, a dialog, or a layout, put the screenshots you checked in that text as ![<what it shows>](<absolute PNG path>), one per changed state, so the thread shows them. The user picks one or replies, and a new session takes it from the thread.`,
	].join("\n");

/**
 * Keeps a Board thread a conversation: a session builds a clear request right away, and replies first with what it
 * understood and what it would do only when the request is unclear, which the user answers before any work starts.
 */
const converse = (id: number, landable: boolean): string =>
	[
		"The thread is a conversation with the user, not a work order.",
		"Build right away when the user's last message is clear: it names the exact step, such as a suggestion you offered, or says plainly what to change, with one reasonable reading once you have read the code and the thread.",
		`Ask first only when it is unclear: it could mean changes that differ in what the user would see or get, or it leaves out something the code and the thread do not answer. Then, after reading what you need, change nothing yet: mark Board task #${id} done with a reply that says in a few lines what you understood, the change you would make, and each question or choice still open, then a Suggestions block whose prompts are the likely answers, best first, such as "1. Yes, build that". The user's answer starts the next session.`,
		"Ask the same way when the user's reply says you missed the point: restate what you now understand and ask, instead of building another guess.",
		...(landable ? [`When the thread ends on a merge that failed, fix the cause on the branch, commit, and mark the task done with "1. ${MERGE_REPLY}" as the first suggestion.`] : []),
	].join("\n");

const authorName = (by: BoardAuthor): string => (by.kind === "user" ? "The user" : `Session ${by.sessionId}`);

/** The lines of `task`'s thread a session reads: what the user and the sessions said, and how each merge the Board ran went. */
const threadLines = (task: BoardTask): string[] =>
	task.replies.flatMap(entry => {
		if ("by" in entry) return [`${authorName(entry.by)}: ${entry.text}`];
		if (entry.note.kind === "landed") return [`The Board merged the branch: ${entry.note.text}`];
		if (entry.note.kind === "land-failed") return [`The Board's merge failed: ${entry.note.text}`];
		if (entry.note.kind === "land-refused") return [`The Board could not merge: ${entry.note.text}`];
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
		// A message that holds a closing tag of these blocks would end them early, and read as the Board's own steps.
		...thread.map(line => line.replace(/<\/(board-[\w-]*)>/gi, "<\\/$1>")),
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
export const startPrompt = (task: BoardTask, checkout: TaskCheckout, landable: boolean): string =>
	[
		task.title,
		...(task.text ? ["", task.text] : []),
		"",
		`<board-task id="${task.id}">`,
		`This session was started to do Board task #${task.id}, and holds it until it marks it done. ${workplace(task, checkout)}`,
		...earlierRounds(task),
		converse(task.id, landable),
		finish(task.id, landable),
		"</board-task>",
	].join("\n");

/** What the session a reply is for reads: it answers or does the follow-up, then finishes as a started session does. */
export const wakePrompt = (task: BoardTask, by: BoardAuthor, text: string, landable: boolean): string =>
	`${DASHBOARD_PROMPT_PREFIX} ${authorName(by)} replied on Board task #${task.id} (${task.title}):\n\n${text}\n\nWhen it only asks a question, answer on its thread with the board tool (action reply, task ${task.id}); when it asks for more work, do it.\n${converse(task.id, landable)}\n${finish(task.id, landable)}`;

/** What the session reads after the user edited their messages, which stopped its turn: each message's new text replaces the old. */
export const editPrompt = (task: BoardTask, texts: string[], landable: boolean): string => {
	const one = texts.length === 1;
	return `${DASHBOARD_PROMPT_PREFIX} The user edited ${one ? "their message" : `${texts.length} of their messages`} on Board task #${task.id} (${task.title}), which stopped your turn. ${one ? "It now reads" : "They now read, oldest first"}:\n\n${texts.join("\n\n")}\n\nThis replaces what ${one ? "that message" : "those messages"} said before: drop the work only the old text asked for, and carry on from this. When it only asks a question, answer on its thread with the board tool (action reply, task ${task.id}).\n${finish(task.id, landable)}`;
};

/** When the user last edited `task` or one of its replies; 0 when they never did. */
const lastEdit = (task: BoardTask): number => Math.max(task.editedAt ?? 0, ...task.replies.map(entry => ("by" in entry ? (entry.editedAt ?? 0) : 0)));

/** The texts of `task` and its replies edited after `since`, oldest message first. */
const editedAfter = (task: BoardTask, since: number): string[] => [
	...((task.editedAt ?? 0) > since ? [task.text || task.title] : []),
	...task.replies.flatMap(entry => ("by" in entry && (entry.editedAt ?? 0) > since ? [entry.text] : [])),
];

/** How much of a Board task a session has read: its first `replies` entries, and edits up to `edited`. */
interface ReadUpTo {
	replies: number;
	edited: number;
}

const readUpTo = (task: BoardTask): ReadUpTo => ({ replies: task.replies.length, edited: lastEdit(task) });

/**
 * The index of the user's bare "Merge on main" on done Board task `task` that no merge answered yet, `null` when there
 * is none. A done Board task only keeps a reply from the user that asks to merge, since any other reopens it; and with
 * no `done` or `closed` note after it, the Board task was already done when the user sent it.
 */
function mergeAsked(task: BoardTask): number | null {
	if (task.doneAt === null) return null;
	for (let index = task.replies.length - 1; index >= 0; index--) {
		const entry = task.replies[index]!;
		if ("by" in entry) {
			if (landsOnReply(task, entry.by, entry.text)) return index;
			continue;
		}
		if (["landed", "land-failed", "land-refused", "done", "closed"].includes(entry.note.kind)) return null;
	}
	return null;
}

export class BoardRunner implements ModuleRun {
	readonly #state: () => BoardState;
	readonly #apply: (change: BoardChange) => boolean;
	readonly #core: ModuleRunCore;
	/** The Board tasks a start is under way for, so a change meanwhile starts no second session. */
	readonly #starting = new Set<number>();
	/** The Board tasks a merge runs for, with the index of the "Merge on main" it answers. */
	readonly #landing = new Map<number, number>();
	/** The sessions an end runs for. */
	readonly #ending = new Set<string>();
	/** The sessions this runner ended, so it ends each once, even one the user resumes after. */
	readonly #ended = new Set<string>();
	/** When the sweep first found each holding session gone. */
	readonly #gone = new Map<string, number>();
	/** The last wake sent to each session, which the next one waits on, so two quick replies to a stopped session both reach it. */
	readonly #wakes = new Map<string, Promise<void>>();
	/**
	 * How far this runner has acted on each Board task, so it wakes only for what is new; `null` until it first looks. A
	 * server that does not run the unattended work keeps what it first read, so one that takes over acts on all since.
	 */
	#seen: Map<number, ReadUpTo> | null = null;
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

	/** Starts what became ready, lands what the user asked to merge, wakes who a new reply is for, and re-prompts who an edit is for; called after every change to the Board. */
	changed(): void {
		const state = this.#state();
		const seen = this.#seen;
		this.#seen ??= new Map(state.tasks.map(task => [task.id, readUpTo(task)]));
		if (!this.#core.owner()) return;
		this.#seen = new Map(state.tasks.map(task => [task.id, readUpTo(task)]));
		const ready = unstartedReady(state);
		// A reply or edit on a Board task about to start, such as the reply that reopened it, reaches its new session through the start prompt, or once its start is recorded.
		const starting = new Set(ready.map(task => task.id));
		for (const task of state.tasks) {
			const asked = mergeAsked(task);
			if (asked !== null) void this.#land(task, asked);
			if (seen && !starting.has(task.id)) this.#deliver(task, seen.get(task.id) ?? { replies: 0, edited: 0 });
		}
		for (const task of ready) {
			// A merge running on the branch, or the last round's session finishing its turn in the worktree, holds the start; each calls this again when it ends.
			if (this.#starting.has(task.id) || this.#landing.has(task.id) || startedOn(task).some(sessionId => !this.#ended.has(sessionId) && this.#core.alive(sessionId))) continue;
			void this.#start(task.id);
		}
	}

	/**
	 * Ends each session started on a Board task that no longer holds it, or holds it done, once its turn ends, and at
	 * once when the user closed it; and returns to ready each Board task whose session has been gone for
	 * {@link GONE_MS} without marking it done, which starts a new session on it.
	 */
	async sweep(): Promise<void> {
		if (!this.#core.owner()) return;
		const now = this.#core.now();
		const holders = new Set<string>();
		for (const task of this.#state().tasks) {
			const current = task.start?.sessionId ?? null;
			const ending = task.doneAt === null ? undefined : task.replies.findLast(entry => "note" in entry && (entry.note.kind === "done" || entry.note.kind === "closed"));
			const closed = ending !== undefined && "note" in ending && ending.note.kind === "closed";
			for (const sessionId of new Set(startedOn(task))) {
				if (this.#ending.has(sessionId) || this.#ended.has(sessionId) || !this.#core.alive(sessionId) || (sessionId === current && task.doneAt === null)) continue;
				if (!this.#core.working(sessionId) || (closed && sessionId === current)) void this.#end(sessionId);
			}
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

	/** Wakes whom `task`'s replies and edits since `since` are for; a bare "Merge on main" the Board lands instead. */
	#deliver(task: BoardTask, since: ReadUpTo): void {
		const landable = this.#core.landable(task.workspace);
		for (const entry of task.replies.slice(since.replies)) {
			if (!("by" in entry) || landsOnReply(task, entry.by, entry.text)) continue;
			const target = wakeTarget(task, entry.by);
			if (target !== null) this.#wake(task, target, wakePrompt(task, entry.by, entry.text, landable), entry.launch);
		}
		// An edit stops the turn that worked from the message's old text, and sends the new one; edits made together go in one prompt.
		const edits = editedAfter(task, since.edited);
		const target = edits.length > 0 ? wakeTarget(task, { kind: "user" }) : null;
		if (target !== null) this.#wake(task, target, editPrompt(task, edits, landable), undefined, true);
	}

	/**
	 * Starts a session on Board task `id` in its checkout. The checkout can run setup for minutes, so the start reads the
	 * Board task again after each wait: a claim, close, or done meanwhile stops it, and the prompt and the replies sent
	 * after it are what the thread holds now.
	 */
	async #start(id: number): Promise<void> {
		this.#starting.add(id);
		const ready = (): BoardTask | undefined => unstartedReady(this.#state()).find(task => task.id === id);
		try {
			const first = ready();
			if (!first) return;
			const branch = taskBranch(id);
			let dir: string | null;
			try {
				dir = await this.#core.checkout(first.workspace, branch);
			} catch (error) {
				if (ready()) this.#change({ op: "start", task: id, sessionId: null, error: `Could not make its worktree on ${branch}: ${errorText(error)}` });
				return;
			}
			const task = ready();
			if (!task) return;
			const checkout: TaskCheckout = dir === null ? { dir: task.workspace, branch: null } : { dir, branch };
			const started = await this.#core.start(checkout.dir, startPrompt(task, checkout, this.#core.landable(task.workspace)), task.launch ?? undefined, `board:${task.workspace}#${id}`);
			const now = ready();
			if (!("sessionId" in started)) {
				if (now) this.#change({ op: "start", task: id, sessionId: null, error: started.error });
				return;
			}
			if (!now) {
				void this.#end(started.sessionId);
				return;
			}
			this.#change({ op: "start", task: id, sessionId: started.sessionId, ...(checkout.branch === null ? {} : { branch: checkout.branch }) });
			const recorded = this.#state().tasks.find(each => each.id === id);
			if (recorded) this.#deliver(recorded, readUpTo(task));
		} finally {
			this.#starting.delete(id);
		}
	}

	/** Lands `task`'s branch for the user's "Merge on main" at reply `asked` and posts how it went; a merge that fails reopens the task. */
	async #land(task: BoardTask, asked: number): Promise<void> {
		const branch = branchOf(task);
		if (branch === null) return;
		const running = this.#landing.get(task.id);
		if (running !== undefined) {
			if (asked > running) this.#change({ op: "land", task: task.id, outcome: "refused", text: `A merge of ${branch} already runs; its result follows.` });
			return;
		}
		this.#landing.set(task.id, asked);
		try {
			const { outcome, text } = await this.#core.land(task.workspace, branch, startedOn(task).at(-1));
			this.#change({ op: "land", task: task.id, outcome, text: text.slice(0, MAX_TEXT) });
		} catch (error) {
			this.#change({ op: "land", task: task.id, outcome: "failed", text: `The merge of ${branch} did not run: ${errorText(error)}`.slice(0, MAX_TEXT) });
		} finally {
			this.#landing.delete(task.id);
			// A reply that reopened the Board task while the merge ran starts its session now.
			this.changed();
		}
	}

	async #end(sessionId: string): Promise<void> {
		this.#ending.add(sessionId);
		try {
			await this.#core.end(sessionId);
			this.#ended.add(sessionId);
		} catch (error) {
			console.error(`omp-agents: could not end Board session ${sessionId}: ${errorText(error)}`);
		} finally {
			this.#ending.delete(sessionId);
		}
		// A Board task reopened while this session finished its round starts its next session now.
		this.changed();
	}

	#wake(task: BoardTask, sessionId: string, prompt: string, launch?: BoardLaunch, interrupt = false): void {
		const sent = (this.#wakes.get(sessionId) ?? Promise.resolve()).then(async () => {
			try {
				const { resumed } = await this.#core.wake(sessionId, prompt, launch, interrupt);
				if (resumed) this.#change({ op: "woke", task: task.id, sessionId });
			} catch (error) {
				console.error(`omp-agents: could not wake ${sessionId} for Board task #${task.id}: ${errorText(error)}`);
			}
		});
		this.#wakes.set(sessionId, sent);
		void sent.then(() => {
			if (this.#wakes.get(sessionId) === sent) this.#wakes.delete(sessionId);
		});
	}

	#change(change: BoardChange): void {
		try {
			this.#apply(change);
		} catch (error) {
			console.error(`omp-agents: the Board refused ${change.op} on #${"task" in change ? change.task : "?"}: ${errorText(error)}`);
		}
	}
}
