import { expect, test } from "bun:test";
import { type Boundary, resolveDue } from "./use-merge-split";

const boundary = (tid: number, kind: Boundary["kind"], phase: Boundary["phase"], due: number): Boundary => ({ tid, kind, survivorId: tid, otherId: tid + 100, gapIndex: 2, phase, due });

test("a boundary whose motion window ended resolves, a merge to its commit and a split away, and no other moves", () => {
	const mergeDue = boundary(1, "merge", "converge", 100);
	const splitDue = boundary(2, "split", "diverge", 100);
	const later = boundary(3, "merge", "converge", 300);
	const committed = boundary(4, "merge", "commit", 50);
	expect(resolveDue([mergeDue, splitDue, later, committed], 100)).toEqual([{ ...mergeDue, phase: "commit" }, later, committed]);
});

test("boundaries with nothing due come back as the same list, so the timer's update renders nothing", () => {
	const open = [boundary(1, "merge", "converge", 300), boundary(2, "split", "splitIn", 400)];
	expect(resolveDue(open, 100)).toBe(open);
});
