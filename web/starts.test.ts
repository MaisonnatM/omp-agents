import { describe, expect, test } from "bun:test";
import { beginStart, dismissSettled, dropHidden, loseStarts, settleStart, startOf, type Starts } from "./starts";

const point = { entryId: "e1", prefill: true };
const fork = { kind: "fork", view: { kind: "past", sessionId: "s1" }, itemId: "u1", point } as const;
const resume = { kind: "resume", sessionId: "s1" } as const;
const quick = { kind: "quick", cwd: "/tmp", prompt: "fix", subject: { kind: "ticket", id: "ENG-7", action: "work" } } as const;
const ok = { ok: true, instanceId: "i1", cwd: "/tmp", prompt: null } as const;

describe("starts", () => {
	test("a new start replaces the last of its kind and keeps the other kinds", () => {
		let starts: Starts = beginStart(new Map(), 1, resume);
		starts = beginStart(starts, 2, fork);
		starts = beginStart(starts, 3, { kind: "resume", sessionId: "s2" });
		expect([...starts.keys()]).toEqual([2, 3]);
		expect(startOf(starts, "resume")?.op.sessionId).toBe("s2");
	});

	test("an answer settles only a start still waiting: success removes it, failure keeps the reason", () => {
		const starts = beginStart(new Map(), 1, resume);
		const failed = settleStart(starts, 1, { ok: false, error: "no file" });
		expect(startOf(failed, "resume")).toMatchObject({ phase: "failed", error: "no file" });
		expect(settleStart(failed, 1, ok)).toBe(failed);
		expect(settleStart(starts, 1, ok).size).toBe(0);
		expect(settleStart(starts, 9, ok)).toBe(starts);
	});

	test("losing the connection fails every start under way and leaves failed ones as they were", () => {
		let starts = beginStart(new Map(), 1, resume);
		starts = settleStart(starts, 1, { ok: false, error: "no file" });
		starts = beginStart(starts, 2, fork);
		const lost = loseStarts(starts);
		expect(startOf(lost, "resume")).toMatchObject({ phase: "failed", error: "no file" });
		expect(startOf(lost, "fork")).toMatchObject({ phase: "failed", error: expect.stringContaining("forking") });
		expect(loseStarts(lost)).toBe(lost);
	});

	test("a failure's reason leaves with its view, a start under way stays, and a draft's failure outlives any view", () => {
		let starts = settleStart(beginStart(new Map(), 1, resume), 1, { ok: false, error: "no file" });
		starts = settleStart(beginStart(starts, 2, { kind: "new", cwd: "~", prompt: "hi", branch: null }), 2, { ok: false, error: "not a directory" });
		starts = beginStart(starts, 3, fork);
		const none = (): boolean => false;
		const hidden = dropHidden(starts, none);
		expect([...hidden.keys()]).toEqual([2, 3]);
		expect(dismissSettled(hidden, "new").size).toBe(1);
		expect(dismissSettled(hidden, "fork")).toBe(hidden);
	});

	test("a quick action's session stays as started, outlives the connection and every view, and goes on dismiss", () => {
		const started = settleStart(beginStart(new Map(), 1, quick), 1, ok);
		expect(startOf(started, "quick")).toMatchObject({ phase: "started", view: { kind: "live", instanceId: "i1", agentId: null } });
		expect(loseStarts(started)).toBe(started);
		expect(dropHidden(started, () => false)).toBe(started);
		expect(dismissSettled(started, "quick").size).toBe(0);
	});
});
