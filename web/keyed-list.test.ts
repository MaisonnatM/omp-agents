import { describe, expect, test } from "bun:test";
import { applyDelta } from "./keyed-list";

const row = (id: string, v: number) => ({ id, v });
const key = (entry: { id: string }) => entry.id;

describe("applyDelta", () => {
	test("upserts keep position, new keys append, removed keys leave, untouched entries keep identity", () => {
		const a = row("a", 1);
		const c = row("c", 1);
		const next = applyDelta([a, row("b", 1), c], false, [row("c", 2), row("d", 1)], key, ["b"]);
		expect(next).toEqual([a, row("c", 2), row("d", 1)]);
		expect(next[0]).toBe(a);
		expect(next[1]).not.toBe(c);
	});

	test("reset replaces the list", () => {
		expect(applyDelta([row("a", 1)], true, [row("b", 1)], key, [])).toEqual([row("b", 1)]);
	});
});
