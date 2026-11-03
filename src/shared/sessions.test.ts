import { expect, test } from "bun:test";
import { parseNewSessionRequest } from "./sessions";

test("a private start parses alone and is refused with a todo, a task, or a review draft, which would outlive it", () => {
	const start = { kind: "new", cwd: "/work", prompt: "Plan dinner" };
	const review = { ...start, subject: { kind: "pull-request", pr: { owner: "acme", repo: "app", number: 7 } }, reviewDraft: true };
	expect(parseNewSessionRequest({ ...start, private: true })?.ok.private).toBe(true);
	expect(parseNewSessionRequest(start)?.ok.private).toBe(false);
	expect(parseNewSessionRequest({ ...start, private: "yes" })).toBeNull();

	expect(parseNewSessionRequest({ ...start, todoId: "t1" })?.ok.todoId).toBe("t1");
	expect(parseNewSessionRequest({ ...start, todoId: "t1", private: true })).toBeNull();
	expect(parseNewSessionRequest({ ...start, taskId: "slice:tests" })?.ok.taskId).toBe("slice:tests");
	expect(parseNewSessionRequest({ ...start, taskId: "slice:tests", private: true })).toBeNull();
	expect(parseNewSessionRequest(review)?.ok.reviewDraft).toBe(true);
	expect(parseNewSessionRequest({ ...review, private: true })).toBeNull();
});
