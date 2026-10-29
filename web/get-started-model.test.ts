import { describe, expect, test } from "bun:test";
import { type GetStartedFacts, getStartedSurface } from "./get-started-model";

const fresh: GetStartedFacts = { route: false, vacantHome: true, dismissed: false, minimized: false, requiredDone: false, settled: true };

describe("getStartedSurface", () => {
	test("opens the dialog on a vacant first-run home", () => {
		expect(getStartedSurface(fresh)).toBe("dialog");
	});

	test("shows the bubble once the dialog was closed, even on a vacant home", () => {
		expect(getStartedSurface({ ...fresh, minimized: true })).toBe("bubble");
	});

	test("never opens the dialog on its own over a page, draft, or pane", () => {
		expect(getStartedSurface({ ...fresh, vacantHome: false })).toBe("bubble");
	});

	test("shows nothing while the facts are checking, so a returning user sees no flash", () => {
		expect(getStartedSurface({ ...fresh, settled: false })).toBe("none");
	});

	test("shows nothing once skipped or once the required steps are done", () => {
		expect(getStartedSurface({ ...fresh, dismissed: true })).toBe("none");
		expect(getStartedSurface({ ...fresh, requiredDone: true, minimized: true })).toBe("none");
	});

	test("#get-started opens the dialog even after dismissal or completion", () => {
		expect(getStartedSurface({ ...fresh, route: true, dismissed: true, requiredDone: true, vacantHome: false })).toBe("dialog");
	});
});
