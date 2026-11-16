import { describe, expect, test } from "bun:test";
import type { TriggerEvent } from "../routines";
import type { PullRequestList, PullRequestSummary } from "../shared/github";
import type { AgentOn } from "../shared/moves";
import type { SlackFound } from "../slack-messages";
import { pullRequestSightings, type Seen, SLACK_SCOPE, slackSightings, TriggerWatch } from "./routine-triggers";

const person = { login: "ada", avatarUrl: null };
const pr: PullRequestSummary = {
	owner: "acme",
	repo: "app",
	number: 4,
	title: "Fix login",
	author: person,
	reviewers: [],
	role: "author",
	state: "open",
	review: "approved",
	checks: "pending",
	conflicts: false,
	additions: 1,
	deletions: 0,
	head: "fix-login",
	base: "main",
	stackedOn: null,
	behind: false,
	unresolved: { count: 0, exact: true, bots: 0 },
	conversations: 0,
	viewerApproved: false,
	createdAt: 0,
	updatedAt: 1,
};

const list = (pullRequests: PullRequestSummary[]): PullRequestList => ({
	repos: [
		{ owner: "acme", repo: "app", cwds: ["/code/app"], pullRequests },
		{ owner: "acme", repo: "down", cwds: ["/code/down"], error: "gh failed" },
	],
	unmatched: [],
});

/** No session works on any pull request or asks about one. */
const idle: AgentOn = () => null;

/** What `seen` holds that `watch` had not seen. */
const news = (watch: TriggerWatch, seen: Seen): TriggerEvent[] => {
	watch.learn(seen);
	return watch.take();
};

describe("TriggerWatch", () => {
	test("a scope's first answer is no news, and then a pull request whose move becomes yours, or that shows up waiting on you, is", () => {
		const watch = new TriggerWatch();
		expect(news(watch, pullRequestSightings(list([pr]), idle))).toEqual([]);
		expect(news(watch, pullRequestSightings(list([pr]), idle))).toEqual([]);
		const passing = { ...pr, checks: "passing" as const };
		const review = { ...pr, number: 5, role: "reviewer" as const, review: "review-required" as const, checks: "passing" as const };
		expect(news(watch, pullRequestSightings(list([passing, review]), idle))).toEqual([
			{ kind: "pull-request", title: "acme/app#4 is ready to merge", detail: "Fix login, by ada", url: "https://github.com/acme/app/pull/4" },
			{ kind: "pull-request", title: "acme/app#5 waits on your review", detail: "Fix login, by ada", url: "https://github.com/acme/app/pull/5" },
		]);
	});

	test("a Bot's own work on a pull request fires nothing: a session at it, its draft, or its checks running; the failure it ends in fires once", () => {
		const watch = new TriggerWatch();
		const failing = { ...pr, checks: "failing" as const };
		news(watch, pullRequestSightings(list([failing]), idle));
		const working: AgentOn = () => "working";
		expect(news(watch, pullRequestSightings(list([failing]), working))).toEqual([]);
		expect(news(watch, pullRequestSightings(list([{ ...pr, state: "draft", review: "review-required" }]), idle))).toEqual([]);
		expect(news(watch, pullRequestSightings(list([pr]), idle))).toEqual([]);
		expect(news(watch, pullRequestSightings(list([{ ...pr, review: "review-required", checks: "passing" }]), idle))).toEqual([]);
		expect(news(watch, pullRequestSightings(list([failing]), idle)).map(({ title }) => title)).toEqual(["acme/app#4 has failing checks"]);
		expect(news(watch, pullRequestSightings(list([failing]), idle))).toEqual([]);
	});

	test("a scope that did not answer keeps what it knew, so its next answer fires only what changed", () => {
		const watch = new TriggerWatch();
		news(watch, pullRequestSightings(list([pr]), idle));
		expect(news(watch, { scopes: [], sightings: [] })).toEqual([]);
		expect(news(watch, pullRequestSightings(list([{ ...pr, checks: "failing" }]), idle)).map(({ title }) => title)).toEqual(["acme/app#4 has failing checks"]);
	});

	const dm = (id: string, text: string): SlackFound => ({ id, at: 1, kind: "slack", type: "dm", from: "Bo", avatarUrl: null, text, permalink: `https://slack.test/${id}`, count: 1 });

	test("what every source of a check learned waits for one take, and forgetting makes the next answers a new baseline", () => {
		const watch = new TriggerWatch();
		watch.learn(pullRequestSightings(list([pr]), idle));
		watch.learn(slackSightings([dm("slack:D1:1", "Hi")]));
		expect(watch.take()).toEqual([]);
		watch.learn(pullRequestSightings(list([{ ...pr, checks: "failing" }]), idle));
		watch.learn(slackSightings([dm("slack:D1:2", "Lunch?")]));
		expect(watch.take().map(({ kind }) => kind)).toEqual(["pull-request", "slack"]);
		expect(watch.take()).toEqual([]);
		watch.forget();
		expect(news(watch, pullRequestSightings(list([{ ...pr, checks: "passing" }]), idle))).toEqual([]);
	});

	test("forgetting one scope, as Slack signing out does, makes only its next answer a baseline, so signing in fires nothing for messages already waiting", () => {
		const watch = new TriggerWatch();
		news(watch, slackSightings([]));
		news(watch, pullRequestSightings(list([pr]), idle));
		watch.forgetScope(SLACK_SCOPE);
		expect(news(watch, slackSightings([dm("slack:D1:1", "Hi"), dm("slack:D2:1", "Lunch?")]))).toEqual([]);
		expect(news(watch, pullRequestSightings(list([{ ...pr, checks: "failing" }]), idle)).map(({ title }) => title)).toEqual(["acme/app#4 has failing checks"]);
		expect(news(watch, slackSightings([dm("slack:D1:2", "Still there?"), dm("slack:D2:1", "Lunch?")])).map(({ kind }) => kind)).toEqual(["slack"]);
	});
});
