/**
 * Starts the sessions that routines ask for. Each tick claims the slots that came due, starts what their queues hold
 * while session slots are free, and ends the sessions that finished their turn.
 * Every step converges: a slot claimed and a head taken are on disk, so a second tick, or the next server, starts nothing twice.
 */
import { errorText } from "../json";
import { PULL_REQUEST_ACTIONS } from "../pull-request-actions";
import { isDue, PROMPT_TARGET, pendingTargets, UNATTENDED } from "../routines";
import { type HostStatus, type InboxPullRequest, prKey, type Routine, type RoutineRun, type StartRequest, type StartResult, type WorkItem } from "../shared";
import type { RoutinesFile } from "./routines-file";

/** Routine sessions that may run at once; a session waiting on a question holds its slot. */
export const MAX_ROUTINE_SESSIONS = 3;

export interface RoutineRunnerDeps {
	file: RoutinesFile;
	start(request: StartRequest): Promise<StartResult>;
	/** The pull requests of `cwd`'s inbox; rejects when GitHub cannot be read. */
	inbox(cwd: string): Promise<InboxPullRequest[]>;
	/** Live session `instanceId`, or `null` once it is gone. */
	session(instanceId: string): { status: HostStatus; sessionId: string; end(): Promise<void> } | null;
	now(): number;
	/** The routines changed; every socket should hear them. */
	onChange(): void;
}

/** A session a routine started: `starting` until its turn is seen running, `working` after; it leaves once it finished. */
interface Tracked {
	routineId: string;
	phase: "starting" | "working";
}

/** A session's turn runs, or waits on a question; either way it holds its slot. */
const turnRuns = (status: HostStatus | undefined): boolean => status === "working" || status === "needs-input";

/** What one start runs: its prompt, the row it links to, and the label its run lists. */
interface Target {
	label: string;
	prompt: string;
	subject: WorkItem | null;
}

export class RoutineRunner {
	readonly #deps: RoutineRunnerDeps;
	/** By instance id. Kept in memory only: the sessions die with the server, and the queues resume from the file. */
	readonly #tracked = new Map<string, Tracked>();
	#inFlight: Promise<void> | null = null;

	constructor(deps: RoutineRunnerDeps) {
		this.#deps = deps;
	}

	/** Claims due slots, drains the queues, then retires finished sessions. A tick while one runs is skipped. */
	tick(): Promise<void> {
		return (
			this.#inFlight ??
			this.#exclusive(async () => {
				const now = this.#deps.now();
				for (const routine of this.#deps.file.routines) if (isDue(routine, now)) await this.#claim(routine, now);
				await this.#drain();
				await this.#retire();
			})
		);
	}

	/** Session `instanceId`'s row changed: a turn shorter than a tick still counts as worked, and a finished session ends at once, freeing its slot. */
	observe(instanceId: string): void {
		const tracked = this.#tracked.get(instanceId);
		if (tracked) void this.#settle(instanceId, tracked);
	}

	/** Claims a slot for routine `id` now, whatever its schedule, then drains; waits for a tick under way rather than skip. */
	async runNow(id: string): Promise<void> {
		while (this.#inFlight) await this.#inFlight;
		await this.#exclusive(async () => {
			const routine = this.#deps.file.routines.find(candidate => candidate.id === id);
			if (!routine) return;
			await this.#claim(routine, this.#deps.now());
			await this.#drain();
		});
	}

	#exclusive(work: () => Promise<void>): Promise<void> {
		const running = (async () => {
			try {
				await work();
			} finally {
				this.#inFlight = null;
			}
		})();
		this.#inFlight = running;
		return running;
	}

	/**
	 * Saves the run before anything starts from it, so a crash after the claim loses no pull request.
	 * When the inbox cannot be read the slot is still taken, with the error; the next run takes the pull requests this one missed.
	 */
	async #claim(routine: Routine, at: number): Promise<void> {
		const { file } = this.#deps;
		if (routine.task.kind === "prompt") {
			file.claim(routine.id, at, [PROMPT_TARGET], null);
		} else {
			try {
				const prs = await this.#deps.inbox(routine.cwd);
				file.claim(routine.id, at, pendingTargets(routine, prs).map(prKey), prs.map(prKey));
			} catch (err) {
				file.claim(routine.id, at, [], null);
				file.failed(routine.id, at, errorText(err));
			}
		}
		this.#deps.onChange();
	}

	/** Starts queued targets, oldest run first, while fewer than {@link MAX_ROUTINE_SESSIONS} routine sessions are busy. */
	async #drain(): Promise<void> {
		const { file } = this.#deps;
		/** Routines whose inbox failed this tick: their queues wait for the next one. */
		const blocked = new Set<string>();
		/** One inbox read per workspace per drain, however many pull requests it starts. */
		const inboxes = new Map<string, Promise<InboxPullRequest[]>>();
		while (this.#tracked.size < MAX_ROUTINE_SESSIONS) {
			const next = oldestQueued(file.routines, blocked);
			if (!next) return;
			const { routine, run } = next;
			if (routine.task.kind === "prompt") {
				// A queue claimed before an edit turned the routine into a prompt task holds pull request keys, which start nothing.
				if (file.pop(routine.id, run.at) !== PROMPT_TARGET) {
					this.#deps.onChange();
				} else if ([...this.#tracked.values()].some(tracked => tracked.routineId === routine.id)) {
					file.failed(routine.id, run.at, "The last run's session is still running.");
					this.#deps.onChange();
				} else {
					await this.#start(routine, run.at, { label: routine.name, prompt: routine.task.prompt, subject: null }, null);
				}
				continue;
			}
			let prs: InboxPullRequest[];
			try {
				prs = await inboxes.getOrInsertComputed(routine.cwd, cwd => this.#deps.inbox(cwd));
			} catch (err) {
				file.failed(routine.id, run.at, errorText(err));
				blocked.add(routine.id);
				this.#deps.onChange();
				continue;
			}
			const key = file.pop(routine.id, run.at);
			const current = file.routines.find(candidate => candidate.id === routine.id);
			const pr = current && pendingTargets(current, prs).find(candidate => prKey(candidate) === key);
			if (!current || !pr || current.task.kind !== "pull-requests") {
				this.#deps.onChange();
				continue;
			}
			const target: Target = {
				label: `${pr.owner}/${pr.repo}#${pr.number}`,
				prompt: PULL_REQUEST_ACTIONS[current.task.action].prompt(pr),
				subject: { kind: "pull-request", pr: { owner: pr.owner, repo: pr.repo, number: pr.number } },
			};
			await this.#start(current, run.at, target, { key: prKey(pr), headOid: pr.headOid });
		}
	}

	/** Starts `target` for the run at `at`; a pull request it took goes in `done` only once its session started. */
	async #start(routine: Routine, at: number, target: Target, head: { key: string; headOid: string } | null): Promise<void> {
		const { file } = this.#deps;
		const result = await this.#deps.start({
			kind: "new",
			cwd: routine.cwd,
			prompt: `${target.prompt} ${UNATTENDED}`,
			images: [],
			branch: null,
			model: null,
			thinking: null,
			skill: routine.skill,
			subject: target.subject,
		});
		const session = result.ok ? this.#deps.session(result.instanceId) : null;
		if (!result.ok || !session) {
			file.failed(routine.id, at, `${target.label}: ${result.ok ? "the session exited as it started." : result.error}`);
		} else {
			this.#tracked.set(result.instanceId, { routineId: routine.id, phase: turnRuns(session.status) ? "working" : "starting" });
			if (head) file.done(routine.id, head.key, head.headOid);
			file.started(routine.id, at, { label: target.label, instanceId: result.instanceId, sessionId: session.sessionId });
		}
		this.#deps.onChange();
	}

	/** Ends each session that worked and went idle; the transcript stays, and Resume continues it. */
	async #retire(): Promise<void> {
		for (const [instanceId, tracked] of this.#tracked) await this.#settle(instanceId, tracked);
	}

	/** Moves one tracked session along `starting -> working -> finished`; a session that is gone or finished leaves the slots. */
	async #settle(instanceId: string, tracked: Tracked): Promise<void> {
		const session = this.#deps.session(instanceId);
		if (!session) {
			this.#tracked.delete(instanceId);
		} else if (turnRuns(session.status)) {
			tracked.phase = "working";
		} else if (session.status === "idle" && tracked.phase === "working") {
			this.#tracked.delete(instanceId);
			await session.end();
		}
	}
}

/** The oldest run with something queued, among the routines not in `blocked`. */
function oldestQueued(routines: Routine[], blocked: ReadonlySet<string>): { routine: Routine; run: RoutineRun } | null {
	let oldest: { routine: Routine; run: RoutineRun } | null = null;
	for (const routine of routines) {
		if (blocked.has(routine.id)) continue;
		for (const run of routine.runs) if (run.queue.length > 0 && (!oldest || run.at < oldest.run.at)) oldest = { routine, run };
	}
	return oldest;
}
