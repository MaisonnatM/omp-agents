import { describe, expect, test } from "bun:test";
import type { PullRequestComment, PullRequestEvent, PullRequestThread } from "../src/shared/github";
import { conversationItems, decodeCommentFilter, filterConversations, pageConversations } from "./pull-request-comments";

const comment = (body: string, at: number, login = "octocat"): PullRequestComment => ({ body, at, author: { login, avatarUrl: null }, url: `https://github.com/o/r/pull/1#${body}`, reactions: [] });
const event = (body: string, at: number, review: PullRequestEvent["review"] = null, login = "octocat"): PullRequestEvent => ({ ...comment(body, at, login), review });
const thread = (id: string, comments: PullRequestComment[], resolved = false, dismissed = false): PullRequestThread => ({ id, comments, commentCount: comments.length, resolved, outdated: false, dismissed, path: "index.ts", line: 1, can: { reply: true, resolve: true, unresolve: true } });

describe("Summary conversations", () => {
	test("hides bots and completed discussions independently, including bodyless verdicts", () => {
		const items = conversationItems({ threads: [thread("open", [comment("question", 3)]), thread("resolved", [comment("done", 2)], true), thread("dismissed", [comment("stale", 2.5)], false, true)], conversation: [{ ...event("bot review", 6), author: { login: "cursor", avatarUrl: null, isBot: true } }, event("automation", 5, null, "github-actions[bot]"), event("old verdict", 4, "dismissed"), event("", 1, "approved"), event(" ", 0)] });
		expect(filterConversations(items, { bots: false, resolved: false }).map(item => item.id)).toEqual(["open", "https://github.com/o/r/pull/1#"]);
		expect(filterConversations(items, { bots: true, resolved: false }).map(item => item.id)).toEqual(["https://github.com/o/r/pull/1#bot review", "https://github.com/o/r/pull/1#automation", "open", "https://github.com/o/r/pull/1#"]);
		expect(filterConversations(items, { bots: false, resolved: true }).map(item => item.id)).toEqual(["https://github.com/o/r/pull/1#old verdict", "open", "dismissed", "resolved", "https://github.com/o/r/pull/1#"]);
	});

	test("keeps a bot-rooted discussion when a person replied", () => {
		const items = conversationItems({ threads: [thread("mixed", [{ ...comment("bot finding", 1, "copilot"), author: { login: "copilot", avatarUrl: null, isBot: true } }, comment("human reply", 2)])], conversation: [] });
		expect(filterConversations(items, { bots: false, resolved: false }).map(item => item.id)).toEqual(["mixed"]);
	});

	test("pages recent conversations in tens before reversing their display order", () => {
		const items = conversationItems({ threads: [], conversation: Array.from({ length: 12 }, (_, index) => event(`comment-${index + 1}`, index + 1)) });
		expect(pageConversations(items, 10, "newest").visible.map(item => item.at)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
		expect(pageConversations(items, 10, "oldest").visible.map(item => item.at)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		expect(pageConversations(items, 10, "newest").hidden).toBe(2);
		expect(pageConversations(items, 20, "oldest").visible.map(item => item.at)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		expect(pageConversations(items, 20, "oldest").hidden).toBe(0);
	});

	test("restores valid filters and rejects malformed saved state", () => {
		expect(decodeCommentFilter('{"bots":true,"resolved":false}')).toEqual({ bots: true, resolved: false });
		expect(decodeCommentFilter('{"bots":"yes","resolved":true}')).toEqual({ bots: false, resolved: false });
		expect(decodeCommentFilter("broken")).toEqual({ bots: false, resolved: false });
	});
});
