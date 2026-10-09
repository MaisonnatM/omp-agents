import { describe, expect, test } from "bun:test";
import { applyPins } from "./pins";

describe("applyPins", () => {
	test("pinning adds each missing id once, at the end, and pinning again changes nothing", () => {
		const pins = ["s1"];
		const pinned = applyPins(pins, { op: "pin", sessionIds: ["s2", "s1", "s2"] });
		expect(pinned).toEqual(["s1", "s2"]);
		expect(applyPins(pinned, { op: "pin", sessionIds: ["s2"] })).toBe(pinned);
	});

	test("unpinning removes the ids it names, and unpinning again changes nothing", () => {
		const pins = ["s1", "s2", "s3"];
		const unpinned = applyPins(pins, { op: "unpin", sessionIds: ["s1", "s3"] });
		expect(unpinned).toEqual(["s2"]);
		expect(applyPins(unpinned, { op: "unpin", sessionIds: ["s1", "s4"] })).toBe(unpinned);
	});
});
