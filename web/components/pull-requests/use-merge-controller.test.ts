import { describe, expect, test } from "bun:test";
import type { StackedPullRequest } from "../../../src/shared/github";
import { mergeRequest } from "./use-merge-controller";

const member = (number: number): StackedPullRequest => ({ owner: "acme", repo: "app", number }) as StackedPullRequest;

describe("mergeRequest", () => {
	test("pins a lone pull request to the confirmed head", () => {
		expect(mergeRequest({ owner: "acme", repo: "app", number: 7 }, undefined, "squash", "abc123")).toEqual({
			op: "add",
			method: "squash",
			prs: [{ owner: "acme", repo: "app", number: 7, head: "abc123" }],
		});
	});

	test("queues a stack bottom first, pinning only the bottom one", () => {
		const stack = [member(3), member(2), member(1)];
		expect(mergeRequest(member(1), stack, "rebase", "def456")).toEqual({
			op: "add",
			method: "rebase",
			prs: [
				{ owner: "acme", repo: "app", number: 1, head: "def456" },
				{ owner: "acme", repo: "app", number: 2, head: null },
				{ owner: "acme", repo: "app", number: 3, head: null },
			],
		});
		expect(stack.map(pr => pr.number)).toEqual([3, 2, 1]);
	});
});
