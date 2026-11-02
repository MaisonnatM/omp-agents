/**
 * Runs each routine in its Bot: a prompt goes into the Bot's conversation, and a command runs in the Bot's workspace,
 * what it printed then posted into that conversation. Each tick claims the slots that came due and starts the queued runs;
 * what a routine's triggers see claims a run too. Every step converges: a run claimed is on disk, so a second tick, or the
 * next server, starts nothing twice.
 * A run starts no session of its own: a Bot keeps one conversation, so routines add no session beside it.
 */
import { errorText } from "../json";
import type { ShellResult } from "../proc";
import { COMMAND_TIME_LIMIT, isDue, isTriggeredBy, MAX_TRIGGER_EVENTS, type CommandRun, type Routine, type RoutineRun, type TriggerEvent } from "../routines";
import { SerialLane } from "../serial-lane";
import type { BotId } from "../shared/bots";
import { type RoutineMessage, routineMessageText } from "../shared/routine-message";
import type { RoutinesFile } from "./routines-file";

export interface RoutineRunnerDeps {
	file: RoutinesFile;
	now(): number;
	/** Bot `botId`'s workspace, `null` once the Bot is gone. */
	workspace(botId: BotId): string | null;
	/** Runs `command` through `sh` in `cwd`, with `env` beside the server's environment, whatever its exit code; rejects only when it cannot start. */
	exec(command: string, cwd: string, env: Record<string, string>): Promise<ShellResult>;
	/** Whether the Mac is fully awake: a dark wake lasts seconds, so a run started in one stalls until the next full wake. */
	fullyAwake(): Promise<boolean>;
	/** The routines changed; every socket should hear them. */
	onChange(): void;
	/** Sends `text` into Bot `botId`'s conversation, as the user's message would; the session it went to. Rejects with why it could not. */
	messageBot(botId: BotId, text: string): Promise<string>;
	/** Screens each Bot's trigger events before its routines claim runs, as a Router's rules and tasks do; {@link EVERY_EVENT} by default. */
	screen?: RoutineScreen;
}

/** What a Bot does with its routines' trigger events before they run on them. */
export interface RoutineScreen {
	/** The events of `events` that Bot `botId`'s routines should still run on, in their order; it handled or dropped the rest. Called once per Bot for each {@link RoutineRunner.fire}. */
	events(botId: BotId, events: TriggerEvent[]): Promise<TriggerEvent[]>;
	/** The prompt `run` of a routine of Bot `botId` sends, with what the screen adds to it. */
	prompt(botId: BotId, run: RoutineRun, prompt: string): string;
}

/** The screen that lets every event through and adds nothing to a prompt. */
export const EVERY_EVENT: RoutineScreen = { events: async (_botId, events) => events, prompt: (_botId, _run, prompt) => prompt };

export class RoutineRunner {
	readonly #deps: RoutineRunnerDeps;
	readonly #screen: RoutineScreen;
	/** Routines with a command running. A run holds one outcome and ten run-now claims push it out of the history, so the file cannot say whether a command still runs. */
	readonly #commands = new Set<string>();
	/** Ticks and run-now claims, one at a time. */
	readonly #lane = new SerialLane();
	/** Command reports that ended outside a full wake, for the next tick at a full wake to send. */
	readonly #reports: HeldReport[] = [];

	constructor(deps: RoutineRunnerDeps) {
		this.#deps = deps;
		this.#screen = deps.screen ?? EVERY_EVENT;
	}

	/**
	 * Takes over what a stopped server left in the runs: a command saved as running failed, since it died with that server.
	 * Called by the server that owns routines when it starts or takes over, and never beside one that runs them.
	 */
	recover(): void {
		const { file, now } = this.#deps;
		for (const routine of file.value) {
			for (const { at, outcome } of routine.runs) {
				if (outcome.kind !== "command" || outcome.run.phase !== "running") continue;
				file.command(routine.id, at, { phase: "stopped", reason: "dashboard", output: "", startedAt: outcome.run.startedAt, endedAt: now() });
				file.failed(routine.id, at, "The dashboard stopped while the command ran.");
			}
		}
	}

	/**
	 * Once the Mac is fully awake, posts the command reports held since a dark wake, claims due slots, then starts the
	 * queued runs; the first tick at a full wake claims what came due since as one run. A tick while one runs is skipped.
	 */
	tick(): Promise<void> {
		if (this.#lane.busy) return this.#lane.idle();
		return this.#lane.run(async () => {
			if (!(await this.#deps.fullyAwake())) return;
			for (const held of this.#reports.splice(0)) void this.#send(held);
			const now = this.#deps.now();
			for (const routine of this.#deps.file.value) if (isDue(routine, now)) this.#claim(routine, now, []);
			await this.#drain();
		});
	}

	/** Claims a slot for routine `id` now, whatever its schedule, then drains; waits for a tick under way rather than skip. */
	runNow(id: string): Promise<void> {
		return this.#lane.run(async () => {
			const routine = this.#deps.file.value.find(candidate => candidate.id === id);
			if (!routine) return;
			this.#claim(routine, this.#deps.now(), []);
			await this.#drain();
		});
	}

	/**
	 * Claims one run for each enabled routine with a trigger of the kinds in `events`, holding the first
	 * {@link MAX_TRIGGER_EVENTS} of them it watches that its Bot's screen leaves, then drains once the Mac is fully awake,
	 * else leaves the runs for the next tick at a full wake; waits for a tick under way rather than skip.
	 * Each Bot's screen sees, once and all at a time, the events any of its routines watches, so an event reaches a task
	 * once however many routines watch it. A routine whose screen leaves none claims nothing. News for a routine whose
	 * triggered run is still queued joins that run, so a night of dark wakes starts one run.
	 */
	fire(events: readonly TriggerEvent[]): Promise<void> {
		return this.#lane.run(async () => {
			const { file } = this.#deps;
			const now = this.#deps.now();
			const watchedBy = new Map<BotId, TriggerEvent[]>();
			for (const routine of file.value) {
				const watched = watchedBy.get(routine.botId) ?? [];
				watchedBy.set(routine.botId, [...new Set([...watched, ...events.filter(event => isTriggeredBy(routine, event.kind))])]);
			}
			const kept = new Map(
				await Promise.all([...watchedBy].map(async ([botId, watched]) => [botId, new Set(watched.length === 0 ? [] : await this.#screen.events(botId, watched))] as const)),
			);
			// A routine saved while the screens ran has no screened events, and one deleted is gone.
			for (const routine of file.value) {
				const screened = kept.get(routine.botId);
				const seen = events.filter(event => isTriggeredBy(routine, event.kind) && screened?.has(event)).slice(0, MAX_TRIGGER_EVENTS);
				if (seen.length === 0) continue;
				const waiting = routine.runs.find(run => run.outcome.kind === "pending" && run.outcome.queued && run.triggeredBy.length > 0);
				if (waiting) file.addTriggerEvents(routine.id, waiting.at, seen);
				// Runs are keyed by their time, so a second claim in the same millisecond takes the next one.
				else this.#claim(routine, Math.max(now, (routine.runs[0]?.at ?? 0) + 1), seen);
			}
			if (await this.#deps.fullyAwake()) await this.#drain();
		});
	}

	/** Saves the run before anything starts from it, so a crash after the claim loses no slot. */
	#claim(routine: Routine, at: number, triggeredBy: TriggerEvent[]): void {
		this.#deps.file.claim(routine.id, at, triggeredBy);
		this.#deps.onChange();
	}

	/** Starts the queued runs, oldest first. */
	async #drain(): Promise<void> {
		const { file } = this.#deps;
		for (;;) {
			const next = oldestQueued(file.value);
			if (!next) return;
			const { routine, run } = next;
			const { task } = routine;
			file.dequeue(routine.id, run.at);
			switch (task.kind) {
				case "prompt":
					await this.#message(routine, run.at, sentText(routine, run, { kind: "prompt", prompt: this.#screen.prompt(routine.botId, run, task.prompt) }));
					break;
				case "command":
					this.#launch(routine, run, task.command);
					break;
				default: {
					const unhandled: never = task;
					return unhandled;
				}
			}
		}
	}

	/** Sends the prompt into the Bot's conversation, which the routine neither tracks nor ends: the Bot keeps it. */
	async #message(routine: Routine, at: number, text: string): Promise<void> {
		const { file } = this.#deps;
		try {
			file.sent(routine.id, at, await this.#deps.messageBot(routine.botId, text));
		} catch (error) {
			file.failed(routine.id, at, `${routine.name}: ${errorText(error)}`);
		}
		this.#deps.onChange();
	}

	/** Runs `routine`'s command in its Bot's workspace for `run` without waiting for it, since a command may run for minutes. */
	#launch(routine: Routine, { at, triggeredBy }: RoutineRun, command: string): void {
		const { file } = this.#deps;
		const refuse = (why: string): void => {
			file.failed(routine.id, at, why);
			this.#deps.onChange();
		};
		if (this.#commands.has(routine.id)) return refuse("The last run's command is still running.");
		const cwd = this.#deps.workspace(routine.botId);
		if (cwd === null) return refuse("This Bot is gone.");
		this.#commands.add(routine.id);
		const startedAt = this.#deps.now();
		file.command(routine.id, at, { phase: "running", startedAt });
		this.#deps.onChange();
		const ended = (run: Exclude<CommandRun, { phase: "running" }>, error: string | null): void => {
			this.#commands.delete(routine.id);
			file.command(routine.id, at, run);
			if (error !== null) file.failed(routine.id, at, error);
			this.#deps.onChange();
			void this.#post(routine, at, sentText(routine, { at, triggeredBy }, { kind: "command", command, run }));
		};
		void this.#deps.exec(command, cwd, { ROUTINE_TRIGGERS: JSON.stringify(triggeredBy) }).then(
			({ exitCode, output, slept }) => {
				const endedAt = this.#deps.now();
				if (exitCode === null) ended({ phase: "stopped", reason: "time-limit", output, startedAt, endedAt, slept }, `Stopped after ${COMMAND_TIME_LIMIT}.`);
				else ended({ phase: "exited", code: exitCode, output, startedAt, endedAt, slept }, exitCode === 0 ? null : `Exited with code ${exitCode}.`);
			},
			(err: unknown) => {
				const error = errorText(err);
				ended({ phase: "failed", error, startedAt, endedAt: this.#deps.now() }, error);
			},
		);
	}

	/** Sends how the command ended into the Bot's conversation, or holds it for the next tick at a full wake. */
	async #post(routine: Routine, at: number, report: string): Promise<void> {
		const held = { botId: routine.botId, id: routine.id, at, report };
		if (await this.#deps.fullyAwake()) await this.#send(held);
		else this.#reports.push(held);
	}

	/** Sends a command report; the run keeps the output either way, and records why the Bot could not take it. */
	async #send({ botId, id, at, report }: HeldReport): Promise<void> {
		try {
			await this.#deps.messageBot(botId, report);
		} catch (error) {
			this.#deps.file.failed(id, at, `The output could not be posted to the Bot: ${errorText(error)}`);
			this.#deps.onChange();
		}
	}
}

/** A command report for Bot `botId` from the run at `at` of routine `id`. */
interface HeldReport {
	botId: BotId;
	id: string;
	at: number;
	report: string;
}

/** What a run of `routine` sends into its Bot's conversation. */
const sentText = (routine: Routine, { at, triggeredBy }: Pick<RoutineRun, "at" | "triggeredBy">, sent: RoutineMessage["sent"]): string =>
	routineMessageText({ botId: routine.botId, routine: { id: routine.id, name: routine.name }, at, triggeredBy, sent });

/** The oldest queued run. */
function oldestQueued(routines: Routine[]): { routine: Routine; run: RoutineRun } | null {
	let oldest: { routine: Routine; run: RoutineRun } | null = null;
	for (const routine of routines) {
		for (const run of routine.runs) if (run.outcome.kind === "pending" && run.outcome.queued && (!oldest || run.at < oldest.run.at)) oldest = { routine, run };
	}
	return oldest;
}
