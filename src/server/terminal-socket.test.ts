import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Terminals } from "../terminals";
import { terminalFor } from "./terminal-socket";

describe("terminalFor", () => {
	const dir = mkdtempSync(join(tmpdir(), "omp-terminal-socket-"));
	afterAll(() => rmSync(dir, { recursive: true, force: true }));

	/** The status `terminalFor` refuses the query with, failing when it opens a shell. */
	async function refusal(query: string): Promise<number> {
		const terminals = new Terminals();
		const found = await terminalFor(terminals, new URLSearchParams(query));
		if (!(found instanceof Response)) throw new Error("A shell was opened.");
		expect(terminals.list()).toEqual([]);
		return found.status;
	}

	test("refuses a query naming no terminal, an exited one, and a cwd that is no directory, opening no shell", async () => {
		const file = join(dir, "notes.txt");
		writeFileSync(file, "");
		expect(await refusal("cols=80&rows=24")).toBe(400);
		expect(await refusal("id=gone")).toBe(404);
		expect(await refusal(`cwd=${encodeURIComponent(join(dir, "removed"))}&cols=80&rows=24`)).toBe(404);
		expect(await refusal(`cwd=${encodeURIComponent(file)}&cols=80&rows=24`)).toBe(404);
	});
});
