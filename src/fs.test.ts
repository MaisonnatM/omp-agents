/** Tests for `JsonFile`'s coalesced saves and `flushJsonFiles`, and `ReducerFile`'s changes. */
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flushJsonFiles, JsonFile, ReducerFile } from "./fs";
import { isObject } from "./json";
import { ScheduledFile } from "./server/scheduled-file";

const dirs: string[] = [];
afterEach(() => {
	flushJsonFiles();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function numbersIn(): { path: string; file: JsonFile<number[]> } {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-fs-"));
	dirs.push(dir);
	const path = join(dir, "numbers.json");
	const parse = (json: unknown): number[] | null => (Array.isArray(json) && json.every(n => typeof n === "number") ? json : null);
	return { path, file: new JsonFile(path, { parse, holds: "a list of numbers", onInvalid: "ignore" }) };
}

test("saves within one tick write once, at the end of it, with the last value", async () => {
	const { path, file } = numbersIn();
	file.save([1]);
	file.save([1, 2]);
	expect(existsSync(path)).toBe(false);
	const { promise, resolve } = Promise.withResolvers<void>();
	setImmediate(resolve);
	await promise;
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([1, 2]);
});

test("flushJsonFiles writes a saved value at once, and a load reads what another store of the path saved", () => {
	const { path, file } = numbersIn();
	file.save([3]);
	flushJsonFiles();
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([3]);
	file.save([4]);
	const parse = (json: unknown): number[] | null => (Array.isArray(json) ? json : null);
	expect(new JsonFile(path, { parse, holds: "a list", onInvalid: "ignore" }).load()).toEqual([4]);
});

function countsIn(shared: boolean): { path: string; open: () => ReducerFile<number[], [add: number]> } {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-fs-"));
	dirs.push(dir);
	const path = join(dir, "counts.json");
	const parse = (json: unknown): number[] | null => (isObject(json) && Array.isArray(json.counts) && json.counts.every(n => typeof n === "number") ? json.counts : null);
	const open = () =>
		new ReducerFile<number[], [add: number]>(path, {
			parse,
			toJson: counts => ({ counts }),
			holds: "a list of counts",
			empty: [],
			reduce: (counts, add) => (counts.includes(add) ? counts : [...counts, add]),
			shared,
		});
	return { path, open };
}

test("a change that changes nothing saves nothing, and what a change saves is wrapped by toJson", () => {
	const { path, open } = countsIn(false);
	const file = open();
	expect(file.value).toEqual([]);
	expect(file.apply(1)).toBe(true);
	expect(file.apply(1)).toBe(false);
	file.flush();
	expect(readFileSync(path, "utf8")).toBe('{\n\t"counts": [\n\t\t1\n\t]\n}\n');
	expect(open().value).toEqual([1]);
});

test("a shared file reads what another store saved before it applies a change; an unshared one keeps its own", () => {
	const shared = countsIn(true);
	const [mine, theirs] = [shared.open(), shared.open()];
	theirs.apply(2);
	expect(mine.apply(3)).toBe(true);
	expect(mine.value).toEqual([2, 3]);

	const own = countsIn(false);
	const [first, second] = [own.open(), own.open()];
	second.apply(2);
	first.apply(3);
	expect(first.value).toEqual([3]);
});

test("a failed JSON write keeps its dirty value for a later flush", () => {
	const { path, file } = numbersIn();
	mkdirSync(path);
	file.save([7]);
	expect(file.flush()).toBe(false);
	rmSync(path, { recursive: true });
	flushJsonFiles();
	expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([7]);
	expect(file.flush()).toBe(true);
});

async function compete(script: string, path: string): Promise<string[]> {
	const children = [1, 2].map(id => Bun.spawn([process.execPath, "--eval", script], {
		env: { ...process.env, SHARED_PATH: path, WRITER_ID: String(id) },
		stdin: "pipe", stdout: "pipe", stderr: "pipe",
	}));
	const readers = children.map(child => child.stdout.getReader());
	try {
		await Promise.all(readers.map(async reader => {
			const ready = await reader.read();
			expect(new TextDecoder().decode(ready.value)).toBe("ready\n");
		}));
		for (const child of children) {
			child.stdin.write("go");
			child.stdin.end();
		}
		return await Promise.all(children.map(async (child, index) => {
			const output: Uint8Array[] = [];
			for (;;) {
				const chunk = await readers[index]!.read();
				if (chunk.done) break;
				output.push(chunk.value);
			}
			expect(await new Response(child.stderr).text()).toBe("");
			expect(await child.exited).toBe(0);
			return Buffer.concat(output).toString().trim();
		}));
	} finally {
		for (const child of children) child.kill();
	}
}

test.each([false, true])("independent processes preserve both shared reducer edits (dead owner: %s)", async stale => {
	const { path, open } = countsIn(true);
	if (stale) writeFileSync(`${path}.lock`, JSON.stringify({ pid: 2 ** 22 + 12345, port: 0 }));
	const script = `
		import { ReducerFile } from ${JSON.stringify(new URL("./fs.ts", import.meta.url).pathname)};
		const file = new ReducerFile(process.env.SHARED_PATH, {
			parse: json => json.counts, toJson: counts => ({ counts }),
			holds: "counts", empty: [], shared: true,
			reduce(counts, id) {
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
				return [...counts, id];
			},
		});
		console.log("ready");
		await Bun.stdin.text();
		file.apply(Number(process.env.WRITER_ID));
		console.log("saved");
	`;
	expect(await compete(script, path)).toEqual(["saved", "saved"]);
	expect(open().value.toSorted()).toEqual([1, 2]);
});

test.each([false, true])("independent processes grant only one scheduled-send claim (dead owner: %s)", async stale => {
	const { path } = countsIn(true);
	const file = new ScheduledFile(path);
	file.apply({ op: "add", send: { id: "send", at: 1, reset: null, target: { kind: "message", sessionId: "session", text: "once" } } }, 0);
	if (stale) writeFileSync(`${path}.lock`, JSON.stringify({ pid: 2 ** 22 + 12345, port: 0 }));
	const script = `
		import { ScheduledFile } from ${JSON.stringify(new URL("./server/scheduled-file.ts", import.meta.url).pathname)};
		class SlowFile extends ScheduledFile {
			update(next) {
				return super.update(value => {
					Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
					return next(value);
				});
			}
		}
		const file = new SlowFile(process.env.SHARED_PATH);
		console.log("ready");
		await Bun.stdin.text();
		console.log(file.claim("send") ? "claimed" : "already claimed");
	`;
	expect((await compete(script, path)).toSorted()).toEqual(["already claimed", "claimed"]);
	expect(new ScheduledFile(path).value.map(send => send.state)).toEqual([{ phase: "sending" }]);
});
