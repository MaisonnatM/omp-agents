import { expect, test } from "bun:test";
import type { PullRequestSummary } from "../src/shared/github";
import type { ConversationHit, PastSession, RosterHost, View } from "../src/shared/sessions";
import type { OpenMode } from "./routing";
import { conversationItems, recordItems } from "./palette-records";

const pr: PullRequestSummary = {
	owner: "Acme",
	repo: "web",
	number: 4,
	title: "Ship login",
	author: { login: "max", avatarUrl: null },
	reviewers: [],
	role: "author",
	state: "open",
	review: "review-required",
	checks: "passing",
	conflicts: false,
	additions: 0,
	deletions: 0,
	head: "fix/login",
	base: "main",
	stackedOn: null,
	behind: false,
	unresolved: { count: 0, exact: true, bots: 0 },
	conversations: 0,
	viewerApproved: false,
	createdAt: 0,
	updatedAt: 5,
};

test("each pull request opens where the dashboard shows it", () => {
	const items = recordItems({
		pullRequestRepos: [
			{ owner: "Acme", repo: "web", cwds: [], pullRequests: [pr] },
			{ owner: "Acme", repo: "api", cwds: [], error: "gh failed" },
		],
	});
	expect(items.map(item => [item.id, item.section, item.title, item.subtitle, item.accessories, item.actions.flat().map(action => action.run)])).toEqual([
		[
			"pr:acme/web#4",
			"pullRequests",
			"Ship login",
			"Acme/web#4",
			[{ kind: "age", at: 5 }],
			[
				{ kind: "link", href: "#pull-requests/Acme/web/4" },
				{ kind: "link", href: "https://github.com/Acme/web/pull/4", external: true },
			],
		],
	]);
});


test("a conversation match opens its live session or saved transcript at the matching message, and a match in a session the sidebar hides lists nothing", () => {
	const hit = (sessionId: string, matches: number): ConversationHit => ({ sessionId, messageId: `m${matches}:0`, role: "assistant", snippet: `snippet ${sessionId}`, matches });
	const host = { instanceId: "i1", sessionId: "live", sessionName: "Live work", cwd: "/w/live", status: "idle" } as RosterHost;
	const saved = { sessionId: "old", title: "Old work", cwd: "/w/old", modifiedAt: 7 } as PastSession;
	const opened: [View, string, OpenMode, string][] = [];
	const items = conversationItems([hit("old", 2), hit("hidden", 1), hit("live", 1)], [host], [saved], (...args) => opened.push(args));
	expect(items.map(item => [item.id, item.title, item.subtitle, item.accessories])).toEqual([
		["conversation:old", "snippet old", "Old work", [{ kind: "text", text: "2 matches" }, { kind: "age", at: 7 }]],
		["conversation:live", "snippet live", "Live work", [{ kind: "text", text: "1 match" }, { kind: "status", status: "idle" }]],
	]);
	for (const item of items) for (const action of item.actions.flat()) if (action.run.kind === "do") action.run.fn();
	expect(opened).toEqual([
		[{ kind: "past", sessionId: "old" }, "/w/old", "replace", "m2:0"],
		[{ kind: "past", sessionId: "old" }, "/w/old", "split", "m2:0"],
		[{ kind: "live", instanceId: "i1", agentId: null }, "/w/live", "replace", "m1:0"],
		[{ kind: "live", instanceId: "i1", agentId: null }, "/w/live", "split", "m1:0"],
	]);
});
