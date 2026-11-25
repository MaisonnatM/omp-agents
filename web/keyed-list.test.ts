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

	test("a key both removed and changed moves to the end, in the order the change lists it", () => {
		const a = row("a", 1);
		expect(applyDelta([a, row("b", 1), row("c", 1)], false, [row("x", 1), row("b", 1), row("c", 1)], key, ["b", "c"])).toEqual([a, row("x", 1), row("b", 1), row("c", 1)]);
	});

	test("reset replaces the list", () => {
		expect(applyDelta([row("a", 1)], true, [row("b", 1)], key, [])).toEqual([row("b", 1)]);
	});
});

test("a list built from deltas keeps placing each key where it is", () => {
	const a = row("a", 1);
	let list = applyDelta<{ id: string; v: number }>([], true, [a, row("b", 1)], key, []);
	for (let v = 2; v < 5; v++) list = applyDelta(list, false, [row("b", v), row(`n${v}`, v)], key, []);
	const before = list;
	list = applyDelta(list, false, [row("a", 9)], key, ["n2"]);
	expect(applyDelta(before, false, [row("n3", 0)], key, [])).toEqual([a, row("b", 4), row("n2", 2), row("n3", 0), row("n4", 4)]);
	expect(applyDelta(list, false, [row("n4", 0), row("z", 0)], key, [])).toEqual([row("a", 9), row("b", 4), row("n3", 3), row("n4", 0), row("z", 0)]);
});
