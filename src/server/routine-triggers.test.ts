import { describe, expect, test } from "bun:test";
import type { TriggerEvent } from "../routines";
import { EVENT_LEAD_MS } from "../shared/notices";
import type { PullRequestList, PullRequestSummary } from "../shared/github";
import type { SlackFound } from "../slack-messages";
import { eventSightings, pullRequestSightings, type Seen, slackSightings, TriggerWatch } from "./routine-triggers";

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
	updatedAt: 1,
};

const list = (pullRequests: PullRequestSummary[]): PullRequestList => ({
	repos: [
		{ owner: "acme", repo: "app", cwds: ["/code/app"], pullRequests },
		{ owner: "acme", repo: "down", cwds: ["/code/down"], error: "gh failed" },
	],
	unmatched: [],
});

/** What `seen` holds that `watch` had not seen. */
const news = (watch: TriggerWatch, seen: Seen): TriggerEvent[] => {
	watch.learn(seen);
	return watch.take();
};

describe("TriggerWatch", () => {
	test("a scope's first answer is no news, and then a pull request whose status changes or that shows up is", () => {
		const watch = new TriggerWatch();
		expect(news(watch, pullRequestSightings(list([pr])))).toEqual([]);
		expect(news(watch, pullRequestSightings(list([pr])))).toEqual([]);
		const passing = { ...pr, checks: "passing" as const };
		const review = { ...pr, number: 5, role: "reviewer" as const, review: "review-required" as const, checks: "passing" as const };
		expect(news(watch, pullRequestSightings(list([passing, review])))).toEqual([
			{ kind: "pull-request", title: "acme/app#4 is ready to merge", detail: "Fix login, by ada", url: "https://github.com/acme/app/pull/4" },
			{ kind: "pull-request", title: "acme/app#5 waits on your review", detail: "Fix login, by ada", url: "https://github.com/acme/app/pull/5" },
		]);
	});

	test("a scope that did not answer keeps what it knew, so its next answer fires only what changed", () => {
		const watch = new TriggerWatch();
		news(watch, pullRequestSightings(list([pr])));
		expect(news(watch, { scopes: [], sightings: [] })).toEqual([]);
		expect(news(watch, pullRequestSightings(list([{ ...pr, checks: "failing" }]))).map(({ title }) => title)).toEqual(["acme/app#4 has failing checks"]);
	});

	test("what every source of a check learned waits for one take, and forgetting makes the next answers a new baseline", () => {
		const watch = new TriggerWatch();
		const dm = (id: string, text: string): SlackFound => ({ id, at: 1, kind: "slack", type: "dm", from: "Bo", avatarUrl: null, text, permalink: `https://slack.test/${id}`, count: 1 });
		watch.learn(pullRequestSightings(list([pr])));
		watch.learn(slackSightings([dm("slack:D1:1", "Hi")]));
		expect(watch.take()).toEqual([]);
		watch.learn(pullRequestSightings(list([{ ...pr, checks: "failing" }])));
		watch.learn(slackSightings([dm("slack:D1:2", "Lunch?")]));
		expect(watch.take().map(({ kind }) => kind)).toEqual(["pull-request", "slack"]);
		expect(watch.take()).toEqual([]);
		watch.forget();
		expect(news(watch, pullRequestSightings(list([{ ...pr, checks: "passing" }])))).toEqual([]);
	});

	test("a calendar event is news once, as it comes within the lead, and again when it moves", () => {
		const now = Date.parse("2026-10-05T09:00:00Z");
		const standup = { ref: "local/1", title: "Standup", start: now + EVENT_LEAD_MS + 60_000, end: now + EVENT_LEAD_MS + 20 * 60_000, calendar: null, color: null, url: null };
		const watch = new TriggerWatch();
		const seen = (event: typeof standup, at: number) => news(watch, eventSightings([{ scope: "event:local", events: [event] }], at));
		expect(seen(standup, now)).toEqual([]);
		expect(seen(standup, now + 60_000).map(({ title }) => title)).toEqual([`Standup starts at ${new Date(standup.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`]);
		expect(seen(standup, now + 120_000)).toEqual([]);
		expect(seen({ ...standup, start: standup.start + 60_000 }, now + 180_000)).toHaveLength(1);
	});
});
