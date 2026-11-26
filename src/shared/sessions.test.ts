import { expect, test } from "bun:test";
import { type AgentRow, awaitsSubagents, EMPTY_QUEUE, parseNewSessionRequest } from "./sessions";

test("an idle session waits on a running subagent, but never on a running eval run", () => {
	const agent: AgentRow = { id: "Scout", kind: "scout", parentId: null, status: "running", activity: null, model: null, startedAt: 1, endedAt: null, canMessage: true, queue: EMPTY_QUEUE };
	const evalRun: AgentRow = { ...agent, id: "tab-history.1", kind: "eval run", canMessage: false, evalRun: true };
	expect(awaitsSubagents({ status: "idle", turnWaits: false, agents: [agent, evalRun] })).toBe(true);
	expect(awaitsSubagents({ status: "idle", turnWaits: false, agents: [evalRun] })).toBe(false);
});

test("a private start parses alone and is refused with a project, a task, or a review draft, which would outlive it", () => {
	const start = { kind: "new", cwd: "/work", prompt: "Plan dinner" };
	const review = { ...start, subject: { kind: "pull-request", pr: { owner: "acme", repo: "app", number: 7 } }, reviewDraft: true };
	expect(parseNewSessionRequest({ ...start, private: true })?.ok.private).toBe(true);
	expect(parseNewSessionRequest(start)?.ok.private).toBe(false);
	expect(parseNewSessionRequest({ ...start, private: "yes" })).toBeNull();

	expect(parseNewSessionRequest(start)?.ok.projectId).toBeNull();
	expect(parseNewSessionRequest({ ...start, projectId: "p1" })?.ok.projectId).toBe("p1");
	expect(parseNewSessionRequest({ ...start, projectId: " " })).toBeNull();
	expect(parseNewSessionRequest({ ...start, projectId: "p1", private: true })).toBeNull();
	expect(parseNewSessionRequest({ ...start, taskId: "slice:tests" })?.ok.taskId).toBe("slice:tests");
	expect(parseNewSessionRequest({ ...start, taskId: "slice:tests", private: true })).toBeNull();
	expect(parseNewSessionRequest(review)?.ok.reviewDraft).toBe(true);
	expect(parseNewSessionRequest({ ...review, private: true })).toBeNull();
});

test("a start saved on a Linear issue before the dashboard dropped Linear reads as one on nothing in particular", () => {
	const start = { kind: "new", cwd: "/work", prompt: "Work on ENG-7", subject: { kind: "ticket", id: "ENG-7" } };
	expect(parseNewSessionRequest(start)?.ok.subject).toBeNull();
});
