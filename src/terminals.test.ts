import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_TERMINALS, Scrollback, type Terminal, type TerminalListener, Terminals } from "./terminals";

describe("Scrollback", () => {
	test("drops the oldest output once it holds over its limit, and keeps a chunk larger than the limit whole", () => {
		const kept = new Scrollback(5);
		for (const text of ["ab", "cd", "ef"]) kept.push(new TextEncoder().encode(text));
		expect(kept.chunks.map(chunk => new TextDecoder().decode(chunk))).toEqual(["cd", "ef"]);
		kept.push(new Uint8Array(9));
		expect(kept.chunks.map(chunk => chunk.length)).toEqual([9]);
	});
});

describe("Terminals", () => {
	const saved = { SHELL: process.env.SHELL, PORT: process.env.PORT };
	let dir = "";
	beforeAll(() => {
		process.env.SHELL = "/bin/sh";
		process.env.PORT = "4999";
		dir = realpathSync(mkdtempSync(join(tmpdir(), "omp-terminals-")));
	});
	afterAll(() => {
		for (const [name, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
		rmSync(dir, { recursive: true, force: true });
	});

	/** A shell in the test directory, which the cap must not refuse. */
	function opened(terminals: Terminals): Terminal {
		const terminal = terminals.open(dir, { cols: 80, rows: 24 });
		if (!terminal) throw new Error("The terminal was refused.");
		return terminal;
	}

	/** Collects what `terminal` sends a page; `shows` resolves once the output holds `needle`, and `exited` with the exit code. */
	function watch(terminal: Terminal) {
		let text = "";
		const waiting: { needle: string; resolve: () => void }[] = [];
		const exited = Promise.withResolvers<number | null>();
		const listener: TerminalListener = {
			output(chunk) {
				text += new TextDecoder().decode(chunk);
				for (const wait of waiting) if (text.includes(wait.needle)) wait.resolve();
			},
			exit: exited.resolve,
		};
		const detach = terminal.attach(listener);
		return {
			text: () => text,
			shows(needle: string): Promise<void> {
				const shown = Promise.withResolvers<void>();
				if (text.includes(needle)) shown.resolve();
				else waiting.push({ needle, resolve: shown.resolve });
				return shown.promise;
			},
			exited: exited.promise,
			detach,
		};
	}

	test("runs the shell in its directory without the server's PORT, and replays its output to a page that attaches later", async () => {
		const terminals = new Terminals();
		const terminal = opened(terminals);
		const first = watch(terminal);
		terminal.write('echo "at $(pwd) port=${PORT:-unset}"\r');
		await first.shows(`at ${dir} port=unset`);
		first.detach();

		const later = watch(terminal);
		expect(later.text()).toBe(first.text());
		expect(terminals.list()).toEqual([{ id: terminal.id, cwd: dir, cwdDisplay: dir }]);
		later.detach();
		terminals.dispose();
	});

	test("an exit reaches every page that shows the shell, and the shell leaves the list", async () => {
		const terminals = new Terminals();
		const terminal = opened(terminals);
		const one = watch(terminal);
		const two = watch(terminal);
		terminal.write("exit 3\r");
		expect(await one.exited).toBe(3);
		expect(await two.exited).toBe(3);
		expect(terminals.list()).toEqual([]);
		expect(terminals.get(terminal.id)).toBeUndefined();
	});

	test("resizing the terminal resizes what the shell sees, and a kill hangs up on it", async () => {
		const terminals = new Terminals();
		const terminal = opened(terminals);
		const page = watch(terminal);
		terminal.resize(132, 40);
		terminal.write("stty size\r");
		await page.shows("40 132");
		terminal.kill();
		expect(await page.exited).toBeNull();
	});

	test("refuses a shell past the cap until one exits", async () => {
		const terminals = new Terminals();
		const first = opened(terminals);
		const others = Array.from({ length: MAX_TERMINALS - 1 }, () => opened(terminals));
		expect(terminals.open(dir, { cols: 80, rows: 24 })).toBeNull();
		const page = watch(first);
		first.kill();
		await page.exited;
		const rest = [...others, opened(terminals)].map(watch);
		terminals.dispose();
		await Promise.all(rest.map(page => page.exited));
		expect(terminals.list()).toEqual([]);
	});
});
