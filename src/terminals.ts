/** The shells of the dashboard's terminal panel: each runs in a pseudo-terminal and outlives the page that opened it. */
import type { Subprocess } from "bun";
import { displayPath } from "./paths";
import { childEnv } from "./proc";
import type { TerminalInfo } from "./shared/terminals";

/** How much of a shell's output a page that attaches later, such as after a reload, gets replayed. */
export const SCROLLBACK_BYTES = 1024 * 1024;

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
	/** The pages a running shell sends to, or how it exited, which a page that attaches after the exit hears at once. */
	#state: { kind: "running"; listeners: Set<TerminalListener> } | { kind: "exited"; code: number | null } = { kind: "running", listeners: new Set() };
	readonly #scrollback = new Scrollback(SCROLLBACK_BYTES);
	readonly #proc: Subprocess;

	constructor(
		readonly cwd: string,
		size: { cols: number; rows: number },
		onExit: (terminal: Terminal) => void,
	) {
		const env = childEnv({ TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "omp-agents" });
		this.#proc = Bun.spawn([process.env.SHELL || "/bin/sh", "-l"], {
			cwd,
			env,
			terminal: {
				...size,
				data: (_terminal, chunk) => {
					this.#scrollback.push(chunk);
					if (this.#state.kind === "running") for (const listener of this.#state.listeners) listener.output(chunk);
				},
			},
		});
		void this.#proc.exited.then(() => {
			const running = this.#state;
			const code = this.#proc.exitCode;
			this.#state = { kind: "exited", code };
			if (running.kind === "running") for (const listener of running.listeners) listener.exit(code);
			onExit(this);
		});
	}

	get info(): TerminalInfo {
		return { id: this.id, cwd: this.cwd, cwdDisplay: displayPath(this.cwd) };
	}

	/** Replays the kept output to `listener`, then sends it what follows, or the exit of a shell already gone; returns the detach. */
	attach(listener: TerminalListener): () => void {
		for (const chunk of this.#scrollback.chunks) listener.output(chunk);
		if (this.#state.kind === "exited") {
			listener.exit(this.#state.code);
			return () => {};
		}
		const { listeners } = this.#state;
		listeners.add(listener);
		return () => void listeners.delete(listener);
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

/** The most shells the panel runs at once; past it a new one is refused, so a page cannot fork shells without bound. */
export const MAX_TERMINALS = 16;

/** Every shell the panel runs, by id, until it exits. */
export class Terminals {
	readonly #all = new Map<string, Terminal>();

	/** A new shell in `cwd`, or `null` while {@link MAX_TERMINALS} run. */
	open(cwd: string, size: { cols: number; rows: number }): Terminal | null {
		if (this.#all.size >= MAX_TERMINALS) return null;
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
