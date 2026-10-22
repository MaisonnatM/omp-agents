import { describe, expect, test } from "bun:test";
import { condenseStep } from "./use-condensed-header";

describe("condenseStep", () => {
	test("condenses only past the fold and its margin, keeping the content still", () => {
		expect(condenseStep(false, 152, 120, 40)).toBeNull();
		expect(condenseStep(false, 153, 120, 40)).toEqual({ condensed: true, top: 73 });
	});

	test("expands only near the top", () => {
		expect(condenseStep(true, 4, 120, 40)).toBeNull();
		expect(condenseStep(true, 3, 120, 40)).toEqual({ condensed: false, top: null });
	});

	test("stays put while the fold has no height", () => {
		expect(condenseStep(false, 500, 0, 40)).toBeNull();
		expect(condenseStep(true, 0, 0, 40)).toBeNull();
	});
});
