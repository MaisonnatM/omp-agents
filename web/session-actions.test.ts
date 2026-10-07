import { describe, expect, test } from "bun:test";
import type { LinkedPullRequest } from "../src/shared/github";
import type { ControlPhase, PastSession, RosterHost } from "../src/shared/sessions";
import { type SessionActionContext, type SessionEntry, sessionActions } from "./session-actions";

const noop = (): void => {};
const context = (change: Partial<SessionActionContext> = {}): SessionActionContext => ({
	onScreen: false,
	pinned: false,
	resuming: null,
	open: noop,
	togglePin: noop,
	resume: noop,
	dismissInterrupted: noop,
	end: noop,
	...change,
});
const live = (control: ControlPhase): SessionEntry => ({
	kind: "live",
	host: { instanceId: "i1", sessionId: "s1", cwd: "/w", pullRequests: [], tickets: [], control } as unknown as RosterHost,
});
const past = (change: Partial<PastSession> = {}): SessionEntry => ({
	kind: "past",
	session: { sessionId: "s2", cwd: "/w", pullRequests: [], tickets: [], interrupted: false, ...change } as PastSession,
});
const ids = (entry: SessionEntry, change?: Partial<SessionActionContext>) => sessionActions(entry, context(change)).map(group => group.map(({ id }) => id));

describe("sessionActions", () => {
	test("End is offered only for a live session the dashboard controls", () => {
		expect(ids(live({ phase: "live", readOnly: false })).at(-1)).toEqual(["end"]);
		expect(ids(live({ phase: "live", readOnly: true })).flat()).not.toContain("end");
		expect(ids(live({ phase: "reconnecting", reason: "lost" })).flat()).not.toContain("end");
		expect(ids(past()).flat()).not.toContain("end");
	});

	test("a past session resumes and an interrupted one also moves to past, while a running one does neither", () => {
		expect(ids(past())[0]).toEqual(["open", "split", "resume", "pin"]);
		expect(ids(past({ interrupted: true }))[0]).toEqual(["open", "split", "resume", "dismiss", "pin"]);
		expect(ids(live({ phase: "live", readOnly: false }))[0]).toEqual(["open", "split", "pin"]);
	});

	test("a session already in a pane offers no split", () => {
		expect(ids(past(), { onScreen: true })[0]).toEqual(["open", "resume", "pin"]);
	});

	test("one resume runs at a time, and only the starting one reads Resuming…", () => {
		const resume = (sessionId: string) => sessionActions(past(), context({ resuming: sessionId }))[0].find(({ id }) => id === "resume");
		expect([resume("s2")?.title, resume("s2")?.disabled]).toEqual(["Resuming…", true]);
		expect([resume("other")?.title, resume("other")?.disabled]).toEqual(["Resume", true]);
	});

	test("each pull request and ticket gets its own link, before the workspace settings", () => {
		const entry = past({ pullRequests: [{ owner: "o", repo: "r", number: 4 } as LinkedPullRequest], tickets: ["ENG-1", "ENG-2"] });
		expect(sessionActions(entry, context())[1].map(({ title, run }) => [title, run])).toEqual([
			["Open r#4", { kind: "link", href: "https://github.com/o/r/pull/4", external: true }],
			["Open ENG-1", { kind: "link", href: "#tickets/ENG-1" }],
			["Open ENG-2", { kind: "link", href: "#tickets/ENG-2" }],
			["Workspace settings", { kind: "link", href: "#settings/%2Fw" }],
		]);
	});
});
