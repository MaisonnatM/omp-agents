import { describe, expect, test } from "bun:test";
import type { PullRequestChange } from "../../../../src/shared/github";
import { ActionRunner, type ActionState } from "../../../use-action";
import { composerLabel, type FollowUp, postComment, reviewPlaceholder, reviewVerdicts, stateChange } from "./composer.logic";

describe("reviewVerdicts", () => {
	test("offers every verdict on an open or draft pull request you may review, only a comment on your own, and none otherwise", () => {
		expect(reviewVerdicts({ state: "open", byViewer: false })).toEqual(["comment", "approve", "request-changes"]);
		expect(reviewVerdicts({ state: "draft", byViewer: false })).toEqual(["comment", "approve", "request-changes"]);
		expect(reviewVerdicts({ state: "open", byViewer: true })).toEqual(["comment"]);
		expect(reviewVerdicts({ state: "merged", byViewer: false })).toEqual([]);
		expect(reviewVerdicts({ state: "closed", byViewer: false })).toEqual([]);
	});
});

describe("composerLabel", () => {
	test("names pending line comments, then a started review, then a comment", () => {
		expect(composerLabel({ pending: 1, reviewStarted: true })).toBe("Review pull request, 1 comment pending");
		expect(composerLabel({ pending: 3, reviewStarted: true })).toBe("Review pull request, 3 comments pending");
		expect(composerLabel({ pending: 0, reviewStarted: true })).toBe("Review pull request");
		expect(composerLabel({ pending: 0, reviewStarted: false })).toBe("Comment on pull request");
	});
});

describe("reviewPlaceholder", () => {
	test("says what each verdict still needs", () => {
		expect(reviewPlaceholder("approve", 0)).toBe("Summarize your review (optional)");
		expect(reviewPlaceholder("comment", 2)).toBe("Summarize your review (optional)");
		expect(reviewPlaceholder("comment", 0)).toBe("Summarize your review or add line comments");
		expect(reviewPlaceholder("request-changes", 2)).toBe("Summarize your review (required to request changes)");
	});
});

/** Resolves once `runner` leaves pending. */
function settled<A extends unknown[]>(runner: ActionRunner<A>): Promise<ActionState<A>> {
	return new Promise(resolve => {
		const stop = runner.subscribe(() => {
			if (runner.state.kind === "pending") return;
			stop();
			resolve(runner.state);
		});
	});
}

describe("postComment", () => {
	test("a close that fails after the comment posted fails alone, and its retry sends only the close", async () => {
		const sent: PullRequestChange[] = [];
		let closeFails = true;
		const send = async (change: PullRequestChange): Promise<void> => {
			sent.push(change);
			if (change.field === "state" && closeFails) throw new Error("GitHub is down");
		};
		const change = new ActionRunner(async (then: FollowUp) => send(stateChange(then)), null);
		const post = new ActionRunner(async (then: FollowUp | null) => postComment(send, "Superseded", then, change.run), null);
		const changed = settled(change);
		post.run("close");
		expect(await settled(post)).toEqual({ kind: "idle" });
		expect(await changed).toEqual({ kind: "failed", args: ["close"], error: "GitHub is down" });

		closeFails = false;
		const retried = settled(change);
		change.run("close");
		expect(await retried).toEqual({ kind: "idle" });
		expect(sent).toEqual([{ field: "comment", body: "Superseded" }, stateChange("close"), stateChange("close")]);
	});
});
