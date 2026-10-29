import { describe, expect, test } from "bun:test";
import { firstSessionFact, type GetStartedFacts, getStartedSurface, type SessionFacts } from "./get-started-model";

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

describe("firstSessionFact", () => {
	const empty: SessionFacts = { hosts: 0, past: 0, listed: true, connected: true, rosterError: null };

	test("any live or past session settles it, even while the roster fails or the connection is down", () => {
		expect(firstSessionFact({ ...empty, hosts: 1, rosterError: "boom", connected: false })).toEqual({ kind: "known", value: true });
		expect(firstSessionFact({ ...empty, past: 2, listed: false })).toEqual({ kind: "known", value: true });
	});

	test("an empty roster that answered over a live connection means no session yet", () => {
		expect(firstSessionFact(empty)).toEqual({ kind: "known", value: false });
	});

	test("an empty roster is still checking until it answers", () => {
		expect(firstSessionFact({ ...empty, listed: false })).toEqual({ kind: "checking" });
	});

	test("a roster error or a lost connection makes it unavailable, the roster error first", () => {
		expect(firstSessionFact({ ...empty, rosterError: "registry unreadable", connected: false })).toEqual({ kind: "unavailable", message: "registry unreadable" });
		expect(firstSessionFact({ ...empty, connected: false })).toEqual({ kind: "unavailable", message: "Waiting for the dashboard to reconnect before checking sessions." });
	});
});
