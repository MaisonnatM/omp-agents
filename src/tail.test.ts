import { afterEach, describe, expect, jest, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item } from "./shared";
import { FileTail } from "./tail";

const dirs: string[] = [];
afterEach(() => {
	jest.useRealTimers();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const user = (timestamp: number, text: string) =>
	`${JSON.stringify({ type: "message", id: `e${timestamp}`, message: { role: "user", timestamp, content: text } })}\n`;

/** A tail on a fresh path, with each emit recorded once its read settles. */
function setup() {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-tail-"));
	dirs.push(dir);
	const path = join(dir, "session.jsonl");
	const emits: { reset: boolean; items: Item[] }[] = [];
	let settle: () => void = () => {};
	const tail = new FileTail(path, (reset, items) => {
		emits.push({ reset, items });
		settle();
	});
	const read = (): Promise<void> => {
		const { promise, resolve } = Promise.withResolvers<void>();
		settle = resolve;
		tail.poke();
		return promise;
	};
	return { path, emits, read, tail };
}

describe("FileTail", () => {
	test("a file that does not exist yet loads empty, then streams lines as they are appended", async () => {
		const { path, emits, read } = setup();
		await read();
		writeFileSync(path, user(1, "first"));
		await read();
		expect(emits).toEqual([
			{ reset: true, items: [] },
			{ reset: false, items: [{ id: "m1", kind: "user", text: "first", skill: null, from: null, entryId: "e1" }] },
		]);
	});

	test("a line omp is still writing waits for its newline, even when it splits a multi-byte character", async () => {
		const { path, emits, read } = setup();
		const line = Buffer.from(user(2, "café ✓"));
		const cut = line.indexOf(Buffer.from("✓")) + 1;
		writeFileSync(path, line.subarray(0, cut));
		await read();
		appendFileSync(path, line.subarray(cut));
		await read();
		expect(emits).toEqual([
			{ reset: true, items: [] },
			{ reset: false, items: [{ id: "m2", kind: "user", text: "café ✓", skill: null, from: null, entryId: "e2" }] },
		]);
	});

	test("a file rewritten shorter starts the transcript over", async () => {
		const { path, emits, read } = setup();
		writeFileSync(path, user(3, "old one") + user(4, "old two"));
		await read();
		writeFileSync(path, user(5, "new"));
		await read();
		expect(emits.at(-1)).toEqual({ reset: true, items: [{ id: "m5", kind: "user", text: "new", skill: null, from: null, entryId: "e5" }] });
	});

	describe("streamed updates", () => {
		const reply = (text: string, extra: Record<string, unknown> = {}) => ({
			role: "assistant",
			timestamp: 7,
			content: [{ type: "text", text }],
			...extra,
		});
		const update = (text: string) => ({ type: "message_update", assistantMessageEvent: { partial: reply(text) } });

		/** A loaded tail. `applied` resolves once every update fed to it so far went through the tail's queue. */
		async function loaded() {
			jest.useFakeTimers();
			const ctx = setup();
			await ctx.read();
			const applied = (): Promise<void> => {
				const { promise, resolve } = Promise.withResolvers<void>();
				ctx.tail.live(() => {
					resolve();
					return [];
				});
				return promise;
			};
			return { ...ctx, applied };
		}

		test("a burst of updates of a streaming reply publishes once the window ends, with the latest text", async () => {
			const { tail, emits, applied } = await loaded();
			for (let n = 1; n <= 30; n++) tail.live(t => t.applyEvent(update("x".repeat(n))));
			await applied();
			expect(emits).toHaveLength(1);

			jest.advanceTimersByTime(50);
			jest.advanceTimersByTime(1000);
			expect(emits.slice(1)).toEqual([{ reset: false, items: [{ id: "m7:0", kind: "assistant", text: "x".repeat(30), streaming: true }] }]);
		});

		test("the reply that ends the stream publishes at once with the held text, and the window publishes nothing after it", async () => {
			const { tail, emits, applied } = await loaded();
			tail.live(t => t.applyEvent(update("pon")));
			await applied();
			expect(emits).toHaveLength(1);

			tail.live(t => t.applyEvent({ type: "message_end", message: reply("pong", { stopReason: "stop" }) }));
			await applied();
			expect(emits.slice(1)).toEqual([{ reset: false, items: [{ id: "m7:0", kind: "assistant", text: "pong", streaming: false }] }]);

			jest.advanceTimersByTime(1000);
			expect(emits).toHaveLength(2);
		});
	});
});
