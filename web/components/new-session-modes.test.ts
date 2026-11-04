import { expect, test } from "bun:test";
import type { PastSession } from "../../src/shared/sessions";
import { resumable } from "./new-session-modes";

const past = (sessionId: string, fields: Partial<PastSession> = {}): PastSession => ({ sessionId, title: sessionId, cwd: "/data/personal", cwdDisplay: "~/data/personal", source: "omp", modifiedAt: 0, interrupted: false, workspace: null, ...fields }) as PastSession;

test("a personal draft's sessions to resume are the directory's omp ones, interrupted first, then the latest", () => {
	const sessions = [past("old", { modifiedAt: 1 }), past("new", { modifiedAt: 5 }), past("cut", { interrupted: true }), past("code", { cwd: "/code/api", modifiedAt: 9 }), past("claude", { source: "claude-code", modifiedAt: 9 })];
	expect(resumable(sessions, "/data/personal").map(s => s.sessionId)).toEqual(["cut", "new", "old"]);
});
