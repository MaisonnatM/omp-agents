/**
 * The server the desktop shell starts: spawns it and follows it until it stops, then takes the checkout back when an
 * update's build did not start, restarts a server that stopped after a growing wait, or says why it gave up. It knows no
 * window: it tells the listener {@link ServerSupervisor.start} was given. Free of Electron, so a test runs it under Bun.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { Readable } from "node:stream";
import { errorText } from "../src/json";
import { isListeningLine, isRestartingLine } from "../src/server/address";
import { type Recovery, type StartFailure, UpdateJournal } from "../src/server/update-journal";
import { shortCommit } from "../src/shared/dashboard-update";
import { OMP_MISSING_EXIT } from "../src/shared/startup";
import { afterLoss, type Losses, RESTART_POLICY, type RestartPolicy } from "./restart-policy";

/** How the server runs: its Bun, the arguments, the directory, what it adds to the environment, and its port. */
export interface ServerCommand {
	bun: string;
	args: readonly string[];
	cwd: string;
	env: Readonly<Record<string, string | undefined>>;
	port: number;
}

export interface SupervisorOptions {
	command: ServerCommand;
	/** The checkout the server runs from, whose update record each stop recovers; `null` for the packaged app. */
	checkout: string | null;
	policy?: RestartPolicy;
	now?: () => number;
	readyTimeoutMs?: number;
}

/** What the window shows: the dashboard once a server listens, why the supervisor stopped trying, or how to install omp. */
export type SupervisorEvent = { kind: "listening" } | { kind: "failed"; title: string; detail: string } | { kind: "omp-missing" };

/** How a server ended: it exited, it printed no listening line in time, or it could not run at all. */
type Loss = { kind: "exited"; code: number | null; signal: NodeJS.Signals | null } | { kind: "silent" } | { kind: "unstartable"; message: string };

/** How a spawned server ended, and whether it was listening then: a restart in place that has not listened yet was not. */
interface Ended {
	loss: Loss;
	listened: boolean;
}

/** The server builds the page before it listens. */
const READY_TIMEOUT_MS = 60_000;
/** How long the server gets after SIGTERM to write its stores and let go of its sessions, which keep running. */
const STOP_TIMEOUT_MS = 10_000;
/** The server output an error page shows. */
const LOG_LINES = 40;
/** How long an exit waits for the server's last output, so the failure can name its error. */
const DRAIN_MS = 200;
/** A line that names the error a server died of, as Bun prints `SyntaxError: …` or `error: Cannot find module …`. */
const ERROR_LINE = /(^|\s)(\w*Error|error):\s/;

/** SIGTERM, then SIGKILL once {@link STOP_TIMEOUT_MS} passed without an exit. */
function stopChild(child: ChildProcess): void {
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGTERM");
	const kill = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS);
	kill.unref();
	child.once("exit", () => clearTimeout(kill));
}

export class ServerSupervisor {
	readonly #command: ServerCommand;
	readonly #policy: RestartPolicy;
	readonly #now: () => number;
	readonly #readyTimeoutMs: number;
	readonly #log: string[] = [];
	readonly #journal: Promise<UpdateJournal | null>;
	#onEvent: (event: SupervisorEvent) => void = () => {};
	/** The run under way, from {@link start} until it stopped trying or {@link stop} ended it. */
	#run: Promise<void> | null = null;
	#abort: AbortController | null = null;
	/** Ends a restart's wait early, set only while one waits. */
	#wake: (() => void) | null = null;
	/** When the server stopped once this run had seen it listen, which the restart policy counts. */
	#losses: Losses = [];

	constructor({ command, checkout, policy = RESTART_POLICY, now = Date.now, readyTimeoutMs = READY_TIMEOUT_MS }: SupervisorOptions) {
		this.#command = command;
		this.#journal = checkout === null ? Promise.resolve(null) : UpdateJournal.at(checkout, command.port, command.bun);
		this.#policy = policy;
		this.#now = now;
		this.#readyTimeoutMs = readyTimeoutMs;
	}

	/** The last lines the server printed since its last start. */
	get log(): readonly string[] {
		return this.#log;
	}

	/** Whether a server, a rollback, or a restart's wait is under way, which a quit must stop. */
	get running(): boolean {
		return this.#run !== null;
	}

	/**
	 * Starts the server, telling `onEvent` each time one listens and once it stops trying. A start while a restart waits
	 * starts it now; a start while a server or rollback is under way only changes who is told. Either forgets the stops so far.
	 */
	start(onEvent: (event: SupervisorEvent) => void): void {
		this.#onEvent = onEvent;
		this.#losses = [];
		if (this.#wake) return this.#wake();
		if (this.#run) return;
		const abort = new AbortController();
		this.#abort = abort;
		this.#run = this.#supervise(abort.signal)
			.catch(err => this.#emit({ kind: "failed", title: "The server did not start", detail: errorText(err) }))
			.finally(() => {
				this.#run = null;
			});
	}

	/** Stops the server, a rollback's install, or a restart's wait, and resolves once nothing runs; it tells nothing more. */
	async stop(): Promise<void> {
		this.#abort?.abort();
		await this.#run;
	}

	/**
	 * Recovers what a quit or crash left first, then spawns until it gives up. A server that stops before it ever
	 * listened in this run says why at once; after it listened, each stop restarts it after the policy's wait. A rollback
	 * starts the commit that ran before at once, since it is no stop of a server that ran.
	 */
	async #supervise(signal: AbortSignal): Promise<void> {
		let first = true;
		let recovery = await this.#recover(null, signal);
		for (;;) {
			if (signal.aborted) return;
			if (recovery.kind === "stuck") return this.#emit({ kind: "failed", title: `omp-agents could not go back to ${shortCommit(recovery.move.from)}`, detail: recovery.reason });
			const { loss, listened } = await this.#spawn(signal);
			if (listened) first = false;
			if (signal.aborted) return;
			recovery = await this.#recover(listened ? null : this.#failure(loss), signal);
			if (recovery.kind !== "none") continue;
			if (loss.kind === "exited" && loss.code === OMP_MISSING_EXIT) return this.#emit({ kind: "omp-missing" });
			if (first) return this.#emit({ kind: "failed", title: "The server did not start", detail: `The server ${this.#ended(loss)}.` });
			const next = afterLoss(this.#losses, this.#now(), this.#policy);
			this.#losses = next.losses;
			if (next.kind === "give-up") {
				const minutes = Math.round(this.#policy.windowMs / 60_000);
				return this.#emit({ kind: "failed", title: "The server stopped", detail: `It stopped ${next.losses.length} times within ${minutes} minutes. The last time, it ${this.#ended(loss)}.` });
			}
			if ((await this.#wait(next.delayMs, signal)) === "retry") first = true;
		}
	}

	#emit(event: SupervisorEvent): void {
		if (!this.#abort?.signal.aborted) this.#onEvent(event);
	}

	/** How the server ended, after "The server" or "it", as the error page and the update record say it. */
	#ended(loss: Loss): string {
		switch (loss.kind) {
			case "exited":
				return loss.signal ? `was stopped by ${loss.signal}` : `exited with code ${loss.code}`;
			case "silent":
				return `did not answer within ${this.#readyTimeoutMs / 1000} s`;
			case "unstartable":
				return `could not run: ${loss.message}`;
			default: {
				const never: never = loss;
				return String(never);
			}
		}
	}

	/** Why a build did not start, as its update record keeps it: how it ended, and the last error line it printed. */
	#failure(loss: Loss): StartFailure {
		return { failure: this.#ended(loss), error: this.#log.findLast(line => ERROR_LINE.test(line))?.trim().slice(0, 300) ?? null };
	}

	async #recover(failed: StartFailure | null, signal: AbortSignal): Promise<Recovery> {
		const journal = await this.#journal;
		if (journal === null) return { kind: "none" };
		const recovery = await journal.recover(failed, signal);
		if (recovery.kind === "reverted") {
			const { from, to } = recovery.move;
			const why = failed === null ? "" : ` (${failed.failure}${failed.error === null ? "" : `: ${failed.error}`})`;
			console.error(
				recovery.blocked
					? `omp-agents: ${shortCommit(to)} did not start${why}, so the checkout went back to ${shortCommit(from)}.`
					: `omp-agents: the update to ${shortCommit(to)} was cut short, so the checkout went back to ${shortCommit(from)}.`,
			);
		}
		return recovery;
	}

	/**
	 * Spawns the server, which exits when its stdin ends however this process dies. It listens once it prints its
	 * listening line, since an answer on the port alone could come from another server; a server that prints none within
	 * the deadline is stopped, and so is one that prints none within the deadline after it announced a restart in place,
	 * which is no longer listening until it prints its line again.
	 */
	#spawn(signal: AbortSignal): Promise<Ended> {
		const { bun, args, cwd, env, port } = this.#command;
		this.#log.length = 0;
		const child = spawn(bun, args, { cwd, env: { ...process.env, ...env, PORT: String(port), OMP_AGENTS_PARENT: "stdin" }, stdio: ["pipe", "pipe", "pipe"] });
		const gone = Promise.withResolvers<Loss>();
		let listened = false;
		let silent = false;
		let deadline: NodeJS.Timeout | undefined;
		const arm = (): void => {
			clearTimeout(deadline);
			deadline = setTimeout(() => {
				silent = true;
				stopChild(child);
			}, this.#readyTimeoutMs);
		};
		arm();
		this.#tail(child.stdout, process.stdout).on("line", line => {
			if (isListeningLine(line, port)) {
				clearTimeout(deadline);
				listened = true;
				this.#emit({ kind: "listening" });
			} else if (isRestartingLine(line, port)) {
				listened = false;
				arm();
			}
		});
		this.#tail(child.stderr, process.stderr);
		child.once("error", (err: NodeJS.ErrnoException) => {
			clearTimeout(deadline);
			gone.resolve({ kind: "unstartable", message: err.code === "ENOENT" ? `\`${bun}\` is not found` : err.message });
		});
		child.once("exit", (code, exitSignal) => {
			clearTimeout(deadline);
			const loss: Loss = silent ? { kind: "silent" } : { kind: "exited", code, signal: exitSignal };
			const drained = setTimeout(() => gone.resolve(loss), DRAIN_MS);
			child.once("close", () => {
				clearTimeout(drained);
				gone.resolve(loss);
			});
		});
		const onAbort = (): void => stopChild(child);
		signal.addEventListener("abort", onAbort, { once: true });
		return gone.promise.then(loss => {
			signal.removeEventListener("abort", onAbort);
			return { loss, listened };
		});
	}

	/** Copies one of the server's output streams through, and keeps its last {@link LOG_LINES} lines for an error page. */
	#tail(stream: Readable, out: NodeJS.WriteStream): Interface {
		stream.pipe(out);
		const lines = createInterface({ input: stream });
		lines.on("line", line => {
			this.#log.push(line);
			if (this.#log.length > LOG_LINES) this.#log.shift();
		});
		return lines;
	}

	/** Waits `ms`, or less when a start wants the server now ("retry") or a stop ends the run. */
	#wait(ms: number, signal: AbortSignal): Promise<"elapsed" | "retry"> {
		const { promise, resolve } = Promise.withResolvers<"elapsed" | "retry">();
		const timer = setTimeout(() => resolve("elapsed"), ms);
		const onAbort = (): void => resolve("elapsed");
		signal.addEventListener("abort", onAbort, { once: true });
		this.#wake = () => resolve("retry");
		return promise.finally(() => {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			this.#wake = null;
		});
	}
}
