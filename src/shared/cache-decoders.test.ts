import { describe, expect, test } from "bun:test";
import { decodeIntegrationsAnswer, type IntegrationsAnswer } from "./accounts";
import { type Analytics, decodeAnalytics, type Usage } from "./analytics";
import { type CalendarEventsAnswer, decodeCalendarEventsAnswer, decodeGoogleStatus, decodeLocalEventsAnswer, type GoogleStatus, type LocalEventsAnswer } from "./calendar";
import { decodePullRequestList, type PullRequestList, type PullRequestSummary } from "./github";
import { decodeInboxAnswer, type InboxAnswer } from "./gmail";
import { decodeTicketsAnswer, type TicketsAnswer } from "./tickets";

const server = { name: "linear", url: "https://mcp.linear.app/mcp", host: "mcp.linear.app" };
const googleSetup = { clientId: null, hasClientSecret: false, callbackPort: 3119, configured: false };
const integrations: IntegrationsAnswer = {
	integrations: {
		linear: { id: "linear", connection: { kind: "ready", server, tools: [{ name: "list_issues", description: null }] }, signIn: null, setup: null },
		slack: {
			id: "slack",
			connection: { kind: "failing", server, error: "timeout", status: null },
			signIn: { phase: "waiting", url: "https://slack.com/oauth", account: null },
			setup: { clientId: "1.2", hasClientSecret: true, redirectUri: "https://example.com/callback", callbackPort: 3120, scope: "chat:write", configured: true },
		},
		"google-calendar": { id: "google-calendar", accounts: [], signIn: { phase: "failed", error: "denied", account: null }, setup: googleSetup },
		gmail: { id: "gmail", accounts: [{ name: "gmail-2", address: "me@example.com", connection: { kind: "signed-out", server }, workspaces: ["/repo"] }], signIn: null, setup: googleSetup },
	},
};

const usage: Usage = { requests: 2, failed: 0, tokens: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 }, cost: 0.1, cacheRate: 0 };
const analytics: Analytics = {
	range: "24h",
	sync: { phase: "idle", current: 1, total: 1, lastSyncedAt: 1, error: null },
	totals: usage,
	providers: [{ provider: "anthropic", tokens: 3, cost: 0.1, requests: 2 }],
	series: [{ start: 1, tokens: 3, cost: 0.1, requests: 2, providers: [{ provider: "anthropic", tokens: 3, cost: 0.1, requests: 2 }] }],
	models: [{ ...usage, selector: "anthropic/claude", tokensPerSecond: null }],
	workspaces: [{ ...usage, cwd: "/tmp" }],
	agents: { main: 3, subagent: 0, advisor: 0 },
	tools: [{ name: "read", calls: 1, errors: 0, tokenShare: 3 }],
	sessions: [{ sessionId: "s", title: null, listed: true, cwd: "/tmp", usage, subagentTokens: 0, models: ["anthropic/claude"], lastAt: 1 }],
};

const google: GoogleStatus = { failed: [{ account: "google-calendar-2", error: "refused" }], calendars: [{ account: "google-calendar", id: "me@example.com", name: "Me", color: "#123456", group: "mine", writable: true, shown: true, error: null }] };

const events: CalendarEventsAnswer = {
	events: [
		{ account: "google-calendar", calendarId: "me@example.com", eventId: "e1", writable: true, title: "Standup", calendar: "Me", color: "#123456", url: "https://calendar.google.com/e1", when: { allDay: false, start: 1, end: 2 } },
		{ account: "google-calendar", calendarId: "me@example.com", eventId: "e2", writable: false, title: "Holiday", calendar: "Me", color: "#123456", url: "https://calendar.google.com/e2", when: { allDay: true, firstDay: "2026-10-13", lastDay: "2026-10-13" } },
	],
};

const local: LocalEventsAnswer = { events: [{ id: "l1", title: "Dentist", when: { allDay: false, start: 1, end: 2 } }] };

const inbox: InboxAnswer = {
	accounts: [{ account: "gmail", address: "me@example.com", error: null }],
	threads: [{ account: "gmail", id: "t1", from: "Ada", subject: "Hi", snippet: "Hello", at: 1, unread: true, count: 2, url: "https://mail.google.com/t1" }],
};

const tickets: TicketsAnswer = {
	tickets: [
		{
			id: "ENG-1",
			title: "Ticket",
			url: "https://linear.app/team/issue/ENG-1",
			status: "Todo",
			statusType: "unstarted",
			priority: 3,
			labels: [{ name: "bug", color: "#f00" }],
			project: null,
			team: "ENG",
			dueDate: null,
			createdAt: "2026-09-01T12:00:00.000Z",
			updatedAt: "2026-10-01T12:00:00.000Z",
			branch: "eng-1-ticket",
			parentId: null,
		},
	],
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
	stackedOn: null,
	unresolved: { count: 0, exact: true },
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
			"every integration an empty record": { integrations: { linear: {}, slack: {}, "google-calendar": {}, gmail: {} } },
			"an integration without its connection": { integrations: { ...integration, linear: { ...integration.linear, connection: undefined } } },
			"a connection of an unknown kind": { integrations: { ...integration, slack: { ...integration.slack, connection: { kind: "maybe", server } } } },
			"an account's connection that is absent": { integrations: { ...integration, gmail: { ...integration.gmail, accounts: [{ name: "gmail", address: null, connection: { kind: "absent" }, workspaces: [] }] } } },
			"a ready connection without its server": { integrations: { ...integration, linear: { ...integration.linear, connection: { kind: "ready", tools: [] } } } },
			"a ready connection that lists tool names": { integrations: { ...integration, linear: { ...integration.linear, connection: { kind: "ready", server, tools: ["list_issues"] } } } },
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
		partial: { "an event without its days": { events: [{ id: "l1", title: "Dentist", when: { allDay: true } }] } },
	},
	{
		name: "Gmail inbox",
		decode: decodeInboxAnswer,
		whole: inbox,
		partial: { "a conversation without its unread flag": { ...inbox, threads: [{ ...inbox.threads[0], unread: undefined }] } },
	},
	{
		name: "tickets",
		decode: decodeTicketsAnswer,
		whole: tickets,
		partial: {
			"a ticket from before its opening date": { tickets: [{ ...tickets.tickets[0], createdAt: undefined }] },
			"a ticket from before its parent": { tickets: [{ ...tickets.tickets[0], parentId: undefined }] },
			"a ticket of an unknown status type": { tickets: [{ ...tickets.tickets[0], statusType: "doing" }] },
		},
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
