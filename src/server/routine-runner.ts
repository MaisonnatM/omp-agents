/**
 * Starts the sessions, runs the commands, and messages the Bots that routines ask for. Each tick claims the
 * slots that came due, starts the queued runs while session slots are free, and ends the sessions that finished their turn.
 * Every step converges: a slot claimed is on disk, so a second tick, or the next server, starts nothing twice.
 */
import { errorText } from "../json";
import { COMMAND_TIME_LIMIT, isDue, UNATTENDED, type CommandRun, type Routine, type RoutineRun } from "../routines";
import { SerialLane } from "../serial-lane";
import type { BotId } from "../shared/bots";
import type { PinChange } from "../shared/pins";
import { type HostStatus, newSessionRequest, type StartRequest, type StartResult } from "../shared/sessions";
import type { RoutinesFile } from "./routines-file";

/** Routine sessions that may run at once; a session waiting on a question holds its slot. */
export const MAX_ROUTINE_SESSIONS = 3;
/**
 * How long a routine's session may stay idle before its first turn runs. A first prompt that omp rejects, an extension cancels,
 * or a model that is unavailable leaves the session idle for good, and it would hold its slot until the dashboard stops.
 */
export const SESSION_START_DEADLINE_MS = 600_000;

export interface RoutineRunnerDeps {
	file: RoutinesFile;
	start(request: StartRequest): Promise<StartResult>;
	/**
	 * Live session `instanceId`, or `null` once it is gone; `occupied` while it is still on its task: a turn runs or waits on a question, or a usage
	 * limit stopped it and its continue waits. An occupied session holds its slot and is not ended.
	 */
	session(instanceId: string): { status: HostStatus; occupied: boolean; sessionId: string; end(): Promise<void> } | null;
	now(): number;
	/** Runs `command` through `sh` in `cwd`, whatever its exit code; rejects only when it cannot start. */
	exec(command: string, cwd: string): Promise<{ exitCode: number | null; output: string }>;
	/** The routines changed; every socket should hear them. */
	onChange(): void;
	/** Pins or unpins sidebar sessions, for every window, page open or not. */
	changePins(change: PinChange): void;
	/** Sends `text` into Bot `botId`'s conversation, as the user's message would; the session it went to. Rejects with why it could not. */
	messageBot(botId: BotId, text: string): Promise<string>;
}

/** A session a routine started: `starting` until its turn is seen running, `working` after; it leaves once it finished. */
interface Tracked {
	routineId: string;
	/** The run the session belongs to. */
	runAt: number;
	startedAt: number;
	phase: "starting" | "working";
}

/** A command runs without an omp session, and a Bot's routine in the Bot's own one, so neither holds a session slot. */
const takesSession = (routine: Routine): boolean => routine.task.kind === "prompt" && routine.target.kind === "new-session";

export class RoutineRunner {
	readonly #deps: RoutineRunnerDeps;
	/** By instance id. A session outlives the server, so {@link recover} takes back the ones a stopped server tracked from the runs that started them. */
	readonly #tracked = new Map<string, Tracked>();
	/** Routines with a command running. A run holds one outcome and ten run-now claims push it out of the history, so the file cannot say whether a command still runs. */
	readonly #commands = new Set<string>();
	/** Ticks and run-now claims, one at a time. */
	readonly #lane = new SerialLane();

	constructor(deps: RoutineRunnerDeps) {
		this.#deps = deps;
	}

	/**
	 * Takes over what a stopped server left in the runs: a session that survived it is tracked again, holding its slot until it ends,
	 * and a command saved as running failed, since it died with that server. Called by the server that owns routines, once it
	 * attached to the surviving sessions, when it starts or takes over, and never beside one that runs them.
	 */
	recover(): void {
		for (const routine of this.#deps.file.value) for (const run of routine.runs) this.#recoverRun(routine.id, run);
	}

	#recoverRun(routineId: string, { at, outcome }: RoutineRun): void {
		const { file, now } = this.#deps;
		switch (outcome.kind) {
			case "pending":
				return;
			case "session":
				// Its turn may have ended while no server watched, so it counts as worked and ends once idle.
				if (!this.#tracked.has(outcome.instanceId) && this.#deps.session(outcome.instanceId))
					this.#tracked.set(outcome.instanceId, { routineId, runAt: at, startedAt: now(), phase: "working" });
				return;
			case "bot":
				return;
			case "command":
				if (outcome.run.phase !== "running") return;
				file.command(routineId, at, { phase: "stopped", reason: "dashboard", output: "", startedAt: outcome.run.startedAt, endedAt: now() });
				file.failed(routineId, at, "The dashboard stopped while the command ran.");
				return;
			default: {
				const unhandled: never = outcome;
				return unhandled;
			}
		}
	}

	/** Claims due slots, starts the queued runs, then retires finished sessions. A tick while one runs is skipped. */
	tick(): Promise<void> {
		if (this.#lane.busy) return this.#lane.idle();
		return this.#lane.run(async () => {
			const now = this.#deps.now();
			for (const routine of this.#deps.file.value) if (isDue(routine, now)) await this.#claim(routine, now);
			await this.#drain();
			await this.#retire();
		});
	}

	/** Session `instanceId`'s row changed: a turn shorter than a tick still counts as worked, and a finished session ends at once, freeing its slot. */
	observe(instanceId: string): void {
		const tracked = this.#tracked.get(instanceId);
		if (tracked) void this.#settle(instanceId, tracked);
	}

	/** Claims a slot for routine `id` now, whatever its schedule, then drains; waits for a tick under way rather than skip. */
	runNow(id: string): Promise<void> {
		return this.#lane.run(async () => {
			const routine = this.#deps.file.value.find(candidate => candidate.id === id);
			if (!routine) return;
			await this.#claim(routine, this.#deps.now());
			await this.#drain();
		});
	}

	/** Saves the run before anything starts from it, so a crash after the claim loses no slot. */
	#claim(routine: Routine, at: number): void {
		this.#deps.file.claim(routine.id, at);
		this.#deps.onChange();
	}

	/**
	 * Starts queued runs, oldest first: sessions while fewer than {@link MAX_ROUTINE_SESSIONS} routine sessions are busy,
	 * and commands whatever the sessions, since they take no slot.
	 */
	async #drain(): Promise<void> {
		const { file } = this.#deps;
		for (;;) {
			const next = oldestQueued(file.value, this.#tracked.size >= MAX_ROUTINE_SESSIONS);
			if (!next) return;
			const { routine, run } = next;
			const { task, target } = routine;
			file.dequeue(routine.id, run.at);
			if (task.kind === "command") this.#launch(routine, run.at, task.command);
			else if (target.kind === "bot") await this.#message(routine, run.at, target.botId, task.prompt);
			else await this.#start(routine, run.at, task.prompt);
		}
	}

	async #start(routine: Routine, at: number, prompt: string): Promise<void> {
		const { file } = this.#deps;
		const refuse = (why: string): void => {
			file.failed(routine.id, at, why);
			this.#deps.onChange();
		};
		if ([...this.#tracked.values()].some(tracked => tracked.routineId === routine.id)) return refuse("The last run's session is still running.");
		const result = await this.#deps.start(newSessionRequest(routine.cwd, `${prompt} ${UNATTENDED}`, { skill: routine.skill }));
		const session = result.ok ? this.#deps.session(result.instanceId) : null;
		if (!result.ok || !session) {
			file.failed(routine.id, at, `${routine.name}: ${result.ok ? "the session exited as it started." : result.error}`);
		} else {
			this.#tracked.set(result.instanceId, { routineId: routine.id, runAt: at, startedAt: this.#deps.now(), phase: session.occupied ? "working" : "starting" });
			file.started(routine.id, at, { instanceId: result.instanceId, sessionId: session.sessionId });
		}
		this.#deps.onChange();
	}

	/** Sends the prompt into the Bot's conversation, which the routine neither tracks nor ends: the Bot keeps it. */
	async #message(routine: Routine, at: number, botId: BotId, prompt: string): Promise<void> {
		const { file } = this.#deps;
		try {
			file.sent(routine.id, at, botId, await this.#deps.messageBot(botId, prompt));
		} catch (error) {
			file.failed(routine.id, at, `${routine.name}: ${errorText(error)}`);
		}
		this.#deps.onChange();
	}

	/** Runs `routine`'s command for the run at `at` without waiting for it, since a command may run for minutes. */
	#launch(routine: Routine, at: number, command: string): void {
		const { file } = this.#deps;
		if (this.#commands.has(routine.id)) {
			file.failed(routine.id, at, "The last run's command is still running.");
			this.#deps.onChange();
			return;
		}
		this.#commands.add(routine.id);
		const startedAt = this.#deps.now();
		file.command(routine.id, at, { phase: "running", startedAt });
		this.#deps.onChange();
		const ended = (command: CommandRun, error: string | null): void => {
			this.#commands.delete(routine.id);
			file.command(routine.id, at, command);
			if (error !== null) file.failed(routine.id, at, error);
			this.#deps.onChange();
		};
		void this.#deps.exec(command, routine.cwd).then(
			({ exitCode, output }) => {
				const endedAt = this.#deps.now();
				if (exitCode === null) ended({ phase: "stopped", reason: "time-limit", output, startedAt, endedAt }, `Stopped after ${COMMAND_TIME_LIMIT}.`);
				else ended({ phase: "exited", code: exitCode, output, startedAt, endedAt }, exitCode === 0 ? null : `Exited with code ${exitCode}.`);
			},
			(err: unknown) => {
				const error = errorText(err);
				ended({ phase: "failed", error, startedAt, endedAt: this.#deps.now() }, error);
			},
		);
	}

	/** Ends each session that worked and went idle, pinned first when its routine asks; the transcript stays, and Resume continues it. */
	async #retire(): Promise<void> {
		for (const [instanceId, tracked] of this.#tracked) await this.#settle(instanceId, tracked);
	}

	/**
	 * Moves one tracked session along `starting -> working -> finished`; a session that is gone or finished leaves the slots.
	 * One that is still idle {@link SESSION_START_DEADLINE_MS} after it started never began its turn: the run records it, and the session ends.
	 */
	async #settle(instanceId: string, tracked: Tracked): Promise<void> {
		const session = this.#deps.session(instanceId);
		if (!session) {
			this.#tracked.delete(instanceId);
		} else if (session.occupied) {
			tracked.phase = "working";
		} else if (session.status === "idle" && tracked.phase === "working") {
			this.#tracked.delete(instanceId);
			this.#pinFinished(tracked.routineId, session.sessionId);
			await session.end();
		} else if (tracked.phase === "starting" && this.#deps.now() - tracked.startedAt >= SESSION_START_DEADLINE_MS) {
			this.#tracked.delete(instanceId);
			this.#deps.file.failed(tracked.routineId, tracked.runAt, `The session never started its turn within ${SESSION_START_DEADLINE_MS / 60_000} minutes, so it was ended.`);
			this.#deps.onChange();
			await session.end();
		}
	}

	/** Pins `sessionId` when its routine asks, and unpins the sessions of the routine's other runs, so the latest run alone stays pinned. */
	#pinFinished(routineId: string, sessionId: string): void {
		const routine = this.#deps.file.value.find(r => r.id === routineId);
		if (routine?.task.kind !== "prompt" || !routine.task.pin) return;
		const earlier = routine.runs.flatMap(({ outcome }) => (outcome.kind === "session" && outcome.sessionId !== sessionId ? [outcome.sessionId] : []));
		if (earlier.length > 0) this.#deps.changePins({ op: "unpin", sessionIds: earlier });
		this.#deps.changePins({ op: "pin", sessionIds: [sessionId] });
	}
}

/** The oldest queued run, and only commands once `sessionsFull`. */
function oldestQueued(routines: Routine[], sessionsFull: boolean): { routine: Routine; run: RoutineRun } | null {
	let oldest: { routine: Routine; run: RoutineRun } | null = null;
	for (const routine of routines) {
		if (sessionsFull && takesSession(routine)) continue;
		for (const run of routine.runs) if (run.outcome.kind === "pending" && run.outcome.queued && (!oldest || run.at < oldest.run.at)) oldest = { routine, run };
	}
	return oldest;
}
