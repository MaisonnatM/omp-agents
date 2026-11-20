import { expect, test } from "bun:test";
import type { LinkedPullRequest } from "../../../src/shared/github";
import type { Project } from "../../../src/shared/projects";
import type { PastSession, RosterHost } from "../../../src/shared/sessions";
import { projectWork } from "./project-work";

const project: Project = { id: "p1", name: "Migration", goal: "", steps: [], decisions: [], log: [], sessionIds: ["saved", "live", "forgotten"], createdAt: "2026-11-20T10:00:00.000Z" };
const pr = (owner: string, number: number): LinkedPullRequest => ({ owner, repo: "app", number, link: "submitted" });
const host = (sessionId: string, pullRequests: LinkedPullRequest[], issues: string[]) => ({ sessionId, sessionName: `${sessionId} host`, cwdDisplay: "~/code/app", pullRequests, issues }) as unknown as RosterHost;
const past = (sessionId: string, pullRequests: LinkedPullRequest[], issues: string[]) => ({ sessionId, title: `${sessionId} copy`, cwdDisplay: "~/code/app", pullRequests, issues }) as unknown as PastSession;

test("a project's sessions list the running ones first; a past or unknown one has no host and keeps its place after them", () => {
	const live = host("live", [], []);
	const work = projectWork(project, { hosts: [live, host("elsewhere", [pr("acme", 9)], ["ENG-9"])], past: [past("saved", [], [])] });
	expect(work.running).toBe(1);
	expect(work.sessions.map(({ id, name, host }) => ({ id, name, host }))).toEqual([
		{ id: "live", name: "live host", host: live },
		{ id: "saved", name: "saved copy", host: null },
		{ id: "forgotten", name: "Session", host: null },
	]);
});

test("pull requests and issues are gathered from the project's sessions once each, and each session keeps its own", () => {
	const work = projectWork(project, {
		hosts: [host("live", [pr("acme", 1), pr("acme", 2), pr("acme", 1)], ["ENG-1"]), host("elsewhere", [pr("acme", 9)], ["ENG-9"])],
		past: [past("saved", [pr("acme", 1), pr("other", 1)], ["ENG-1", "ENG-2"])],
	});
	expect(work.pullRequests).toEqual([
		{ owner: "acme", repo: "app", number: 1 },
		{ owner: "other", repo: "app", number: 1 },
		{ owner: "acme", repo: "app", number: 2 },
	]);
	expect(work.issues).toBe(2);
	expect(work.sessions[0]?.pullRequests).toEqual([
		{ owner: "acme", repo: "app", number: 1 },
		{ owner: "acme", repo: "app", number: 2 },
	]);
});

test("a session still live is read from the roster, not from its saved copy", () => {
	const work = projectWork({ ...project, sessionIds: ["live"] }, { hosts: [host("live", [pr("acme", 3)], [])], past: [past("live", [pr("acme", 4)], ["ENG-4"])] });
	expect(work.pullRequests).toEqual([{ owner: "acme", repo: "app", number: 3 }]);
	expect(work.issues).toBe(0);
});
