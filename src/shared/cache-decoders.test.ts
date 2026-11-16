import { describe, expect, test } from "bun:test";
import { decodeIntegrationsAnswer, type IntegrationsAnswer } from "./accounts";
import { type Analytics, decodeAnalytics, type Usage } from "./analytics";
import { type CalendarEventsAnswer, decodeCalendarEventsAnswer, decodeGoogleStatus, decodeLocalEventsAnswer, type GoogleStatus, type LocalEventsAnswer } from "./calendar";
import { decodePullRequestList, type PullRequestList, type PullRequestSummary } from "./github";
import { decodeEmailAnswer, type EmailAnswer } from "./gmail";

const server = { name: "slack", url: "https://mcp.slack.com/mcp", host: "mcp.slack.com" };
const googleSetup = { clientId: null, hasClientSecret: false, callbackPort: 3119, configured: false };
const integrations: IntegrationsAnswer = {
	integrations: {
		slack: {
			id: "slack",
			connection: { kind: "failing", server, error: "timeout", status: null },
			signIn: { phase: "waiting", url: "https://slack.com/oauth", account: null },
			setup: { clientId: "1.2", hasClientSecret: true, redirectUri: "https://example.com/callback", callbackPort: 3120, scope: "chat:write", configured: true },
		},
		"google-calendar": { id: "google-calendar", accounts: [], signIn: { phase: "failed", error: "denied", account: null }, setup: googleSetup },
		gmail: { id: "gmail", accounts: [{ name: "gmail-2", address: "me@example.com", addressError: null, connection: { kind: "signed-out", server } }], signIn: null, setup: googleSetup },
	},
};

const usage: Usage = { requests: 2, failed: 0, tokens: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 }, cost: 0.1, cacheRate: 0 };
const analytics: Analytics = {
	range: "24h",
	sync: { phase: "syncing", current: 1, total: 2 },
	totals: usage,
	providers: [{ provider: "anthropic", tokens: 3, cost: 0.1, requests: 2 }],
	series: [{ start: 1, tokens: 3, cost: 0.1, requests: 2, providers: [{ provider: "anthropic", tokens: 3, cost: 0.1, requests: 2 }] }],
	models: [{ ...usage, selector: "anthropic/claude", tokensPerSecond: null }],
	workspaces: [{ ...usage, cwd: "/tmp" }],
	agents: { main: 3, subagent: 0, advisor: 0 },
	tools: [{ name: "read", calls: 1, errors: 0, tokenShare: 3 }],
	sessions: [{ sessionId: "s", title: null, listed: true, workspace: "/tmp", usage, subagentTokens: 0, models: ["anthropic/claude"], lastAt: 1 }],
};

const google: GoogleStatus = { failed: [{ account: "google-calendar-2", error: "refused" }], calendars: [{ account: "google-calendar", id: "me@example.com", name: "Me", color: "#123456", group: "mine", writable: true, shown: true, error: null }] };

const events: CalendarEventsAnswer = {
	events: [
		{ account: "google-calendar", calendarId: "me@example.com", eventId: "e1", writable: true, title: "Standup", calendar: "Me", color: "#123456", url: "https://calendar.google.com/e1", when: { allDay: false, start: 1, end: 2 } },
		{ account: "google-calendar", calendarId: "me@example.com", eventId: "e2", writable: false, title: "Holiday", calendar: "Me", color: "#123456", url: "https://calendar.google.com/e2", when: { allDay: true, firstDay: "2026-10-13", lastDay: "2026-10-13" } },
	],
};

const local: LocalEventsAnswer = { events: [{ id: "l1", title: "Dentist", when: { allDay: false, start: 1, end: 2 }, sessionId: null }] };

const email: EmailAnswer = {
	accounts: [{ account: "gmail", error: null }],
	threads: [{ account: "gmail", id: "t1", from: "Ada", subject: "Hi", snippet: "Hello", at: 1, unread: true, count: 2, url: "https://mail.google.com/t1" }],
};

const person = { login: "ada", avatarUrl: null };
const pr: PullRequestSummary = {
	owner: "acme",
	repo: "app",
	number: 1,
	title: "Fix",
	author: person,
	reviewers: [{ ...person, state: "requested" }],
	role: "author",
	state: "open",
	review: "review-required",
	checks: "passing",
	conflicts: false,
	additions: 1,
	deletions: 0,
	head: "fix",
	base: "main",
	stackedOn: null,
	behind: false,
	unresolved: { count: 0, exact: true, bots: 0 },
	conversations: 0,
	viewerApproved: false,
	createdAt: 0,
	updatedAt: 1,
};
const listed = { owner: "acme", repo: "app", cwds: ["/code/app"], pullRequests: [pr] };
const pullRequests: PullRequestList = { repos: [listed, { owner: "acme", repo: "down", cwds: ["/code/down"], error: "gh failed" }], unmatched: ["/code/local"] };

const integration = integrations.integrations;

/** Each cached store's decoder, a whole answer it keeps, and the partial records an older or damaged cache could hold. */
const cases: { name: string; decode: (raw: unknown) => unknown; whole: unknown; partial: Record<string, unknown> }[] = [
	{
		name: "integrations",
		decode: decodeIntegrationsAnswer,
		whole: integrations,
		partial: {
			"every integration an empty record": { integrations: { slack: {}, "google-calendar": {}, gmail: {} } },
			"an integration without its connection": { integrations: { ...integration, slack: { ...integration.slack, connection: undefined } } },
			"a connection of an unknown kind": { integrations: { ...integration, slack: { ...integration.slack, connection: { kind: "maybe", server } } } },
			"an account's connection that is absent": { integrations: { ...integration, gmail: { ...integration.gmail, accounts: [{ name: "gmail", address: null, addressError: null, connection: { kind: "absent" } }] } } },
			"a ready connection without its server": { integrations: { ...integration, slack: { ...integration.slack, connection: { kind: "ready", tools: [] } } } },
			"a ready connection that lists tool names": { integrations: { ...integration, slack: { ...integration.slack, connection: { kind: "ready", server, tools: ["send_message"] } } } },
			"a Google setup without its callback port": { integrations: { ...integration, gmail: { ...integration.gmail, setup: { ...googleSetup, callbackPort: undefined } } } },
			"an integration under another id": { integrations: { ...integration, gmail: { ...integration.gmail, id: "slack" } } },
		},
	},
	{
		name: "analytics",
		decode: decodeAnalytics,
		whole: analytics,
		partial: {
			"a damaged token summary": { ...analytics, totals: { tokens: null } },
			"a chart without provider buckets": { ...analytics, series: [{ start: 1 }] },
			"a model without its usage": { ...analytics, models: [{ selector: "anthropic/claude", tokensPerSecond: null }] },
		},
	},
	{
		name: "Google calendars",
		decode: decodeGoogleStatus,
		whole: google,
		partial: {
			"a calendar from before shown and writable": { calendars: [{ id: "me@example.com", name: "Me", color: "#123456", group: "mine", error: null }] },
			"a calendar without its name": { calendars: [{ ...google.calendars[0], name: undefined }] },
		},
	},
	{
		name: "calendar events",
		decode: decodeCalendarEventsAnswer,
		whole: events,
		partial: {
			"an event from before calendarId": { events: [{ ...events.events[0], calendarId: undefined }] },
			"an event without its times": { events: [{ ...events.events[0], when: { allDay: false } }] },
		},
	},
	{
		name: "local events",
		decode: decodeLocalEventsAnswer,
		whole: local,
		partial: {
			"an event without its days": { events: [{ id: "l1", title: "Dentist", when: { allDay: true }, sessionId: null }] },
		},
	},
	{
		name: "Gmail inbox",
		decode: decodeEmailAnswer,
		whole: email,
		partial: { "a conversation without its unread flag": { ...email, threads: [{ ...email.threads[0], unread: undefined }] } },
	},
	{
		name: "pull requests",
		decode: decodePullRequestList,
		whole: pullRequests,
		partial: {
			"a pull request from before its diff size": { ...pullRequests, repos: [{ ...listed, pullRequests: [{ ...pr, additions: undefined }] }] },
			"a pull request without its author": { ...pullRequests, repos: [{ ...listed, pullRequests: [{ ...pr, author: undefined }] }] },
			"a repository with neither pull requests nor an error": { ...pullRequests, repos: [{ owner: "acme", repo: "app", cwds: [] }] },
		},
	},
];

describe.each(cases)("$name cache", ({ decode, whole, partial }) => {
	test("keeps a whole answer", () => {
		expect(decode(JSON.parse(JSON.stringify(whole)))).toEqual(whole);
	});

	test("drops an empty record or something other than an object", () => {
		for (const raw of [{}, null, [], "answer", 1]) expect(decode(raw)).toBeNull();
	});

	test.each(Object.entries(partial))("drops %s", (_, raw) => {
		expect(decode(JSON.parse(JSON.stringify(raw)))).toBeNull();
	});
});
