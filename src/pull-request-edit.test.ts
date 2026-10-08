import { describe, expect, test } from "bun:test";
import { stateSteps } from "./pull-request-edit";

describe("stateSteps", () => {
	const open = { open: true, draft: false };
	const draft = { open: true, draft: true };
	const closed = { open: false, draft: false };
	const closedDraft = { open: false, draft: true };

	test("takes no step to the state the pull request is in", () => {
		expect(stateSteps(open, "open")).toEqual([]);
		expect(stateSteps(draft, "draft")).toEqual([]);
		expect(stateSteps(closed, "closed")).toEqual([]);
		expect(stateSteps(closedDraft, "closed")).toEqual([]);
	});

	test("flips the draft flag of an open pull request, and closes either kind", () => {
		expect(stateSteps(open, "draft")).toEqual(["convertPullRequestToDraft"]);
		expect(stateSteps(draft, "open")).toEqual(["markPullRequestReadyForReview"]);
		expect(stateSteps(draft, "closed")).toEqual(["closePullRequest"]);
	});

	test("reopens a closed pull request before it changes the draft flag", () => {
		expect(stateSteps(closed, "open")).toEqual(["reopenPullRequest"]);
		expect(stateSteps(closed, "draft")).toEqual(["reopenPullRequest", "convertPullRequestToDraft"]);
		expect(stateSteps(closedDraft, "open")).toEqual(["reopenPullRequest", "markPullRequestReadyForReview"]);
		expect(stateSteps(closedDraft, "draft")).toEqual(["reopenPullRequest"]);
	});
});
