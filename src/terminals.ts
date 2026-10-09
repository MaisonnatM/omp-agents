/** The shells of the dashboard's terminal panel: each runs in a pseudo-terminal and outlives the page that opened it. */
import type { Subprocess } from "bun";
import { displayPath } from "./paths";
import type { TerminalInfo } from "./shared/terminals";

/** How much of a shell's output a page that attaches later, such as after a reload, gets replayed. */
export const SCROLLBACK_BYTES = 1024 * 1024;

/**
 * What the server sets for itself: a dev server in the terminal would take the dashboard's `PORT`, and the desktop
 * shell's `OMP_AGENTS_PARENT` means nothing to anything else.
 */
const SERVER_ENV = ["PORT", "OMP_AGENTS_PARENT"];

/** The output kept for a page that attaches later, oldest dropped first once it holds over `limit` bytes. */
export class Scrollback {
	#chunks: Uint8Array[] = [];
	#bytes = 0;
	constructor(private readonly limit: number) {}

	push(chunk: Uint8Array): void {
		this.#chunks.push(chunk);
		this.#bytes += chunk.length;
		while (this.#bytes > this.limit && this.#chunks.length > 1) this.#bytes -= this.#chunks.shift()!.length;
	}

	get chunks(): readonly Uint8Array[] {
		return this.#chunks;
	}
}

/** Where a terminal's output and exit go: one per page that shows it. */
export interface TerminalListener {
	output(chunk: Uint8Array): void;
	exit(code: number | null): void;
}

/** One shell in a pseudo-terminal. */
export class Terminal {
	readonly id = crypto.randomUUID();
	readonly #listeners = new Set<TerminalListener>();
	readonly #scrollback = new Scrollback(SCROLLBACK_BYTES);
	readonly #proc: Subprocess;

	constructor(
		readonly cwd: string,
		size: { cols: number; rows: number },
		onExit: (terminal: Terminal) => void,
	) {
		const env: Record<string, string | undefined> = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "omp-agents" };
		for (const name of SERVER_ENV) delete env[name];
		this.#proc = Bun.spawn([process.env.SHELL || "/bin/sh", "-l"], {
			cwd,
			env,
			terminal: {
				...size,
				data: (_terminal, chunk) => {
					this.#scrollback.push(chunk);
					for (const listener of this.#listeners) listener.output(chunk);
				},
			},
		});
		void this.#proc.exited.then(() => {
			for (const listener of this.#listeners) listener.exit(this.#proc.exitCode);
			this.#listeners.clear();
			onExit(this);
		});
	}

	get info(): TerminalInfo {
		return { id: this.id, cwd: this.cwd, cwdDisplay: displayPath(this.cwd) };
	}

	/** Replays the kept output to `listener`, then sends it what follows; returns the detach. */
	attach(listener: TerminalListener): () => void {
		for (const chunk of this.#scrollback.chunks) listener.output(chunk);
		this.#listeners.add(listener);
		return () => void this.#listeners.delete(listener);
	}

	write(input: string | Uint8Array): void {
		this.#proc.terminal?.write(input);
	}

	resize(cols: number, rows: number): void {
		this.#proc.terminal?.resize(cols, rows);
	}

	/** Hangs up on the shell, as closing a terminal window does. */
	kill(): void {
		this.#proc.kill("SIGHUP");
	}
}

/** Every shell the panel runs, by id, until it exits. */
export class Terminals {
	readonly #all = new Map<string, Terminal>();

	open(cwd: string, size: { cols: number; rows: number }): Terminal {
		const terminal = new Terminal(cwd, size, exited => this.#all.delete(exited.id));
		this.#all.set(terminal.id, terminal);
		return terminal;
	}

	get(id: string): Terminal | undefined {
		return this.#all.get(id);
	}

	list(): TerminalInfo[] {
		return [...this.#all.values()].map(terminal => terminal.info);
	}

	/** Hangs up on every shell, as the server stops. */
	dispose(): void {
		for (const terminal of this.#all.values()) terminal.kill();
	}
}
