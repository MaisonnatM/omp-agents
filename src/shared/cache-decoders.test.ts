import { describe, expect, test } from "bun:test";
import { decodeIntegrationsAnswer, type IntegrationsAnswer } from "./accounts";
import { type Analytics, decodeAnalytics, type Usage } from "./analytics";
import { decodePullRequestList, type PullRequestList, type PullRequestSummary } from "./github";
import { decodeTicketsAnswer, type TicketsAnswer } from "./tickets";

const server = { name: "linear", url: "https://mcp.linear.app/mcp", host: "mcp.linear.app" };
const integrations: IntegrationsAnswer = {
	integrations: {
		linear: { id: "linear", connection: { kind: "ready", server, tools: [{ name: "list_issues", description: null }] }, signIn: null, setup: null },
		slack: {
			id: "slack",
			connection: { kind: "failing", server, error: "timeout", status: null },
			signIn: { phase: "waiting", url: "https://slack.com/oauth" },
			setup: { clientId: "1.2", hasClientSecret: true, redirectUri: "https://example.com/callback", callbackPort: 3120, scope: "chat:write", configured: true },
		},
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
			"every integration an empty record": { integrations: { linear: {}, slack: {} } },
			"an integration without its connection": { integrations: { ...integration, linear: { ...integration.linear, connection: undefined } } },
			"a connection of an unknown kind": { integrations: { ...integration, slack: { ...integration.slack, connection: { kind: "maybe", server } } } },
			"a ready connection without its server": { integrations: { ...integration, linear: { ...integration.linear, connection: { kind: "ready", tools: [] } } } },
			"a ready connection that lists tool names": { integrations: { ...integration, linear: { ...integration.linear, connection: { kind: "ready", server, tools: ["list_issues"] } } } },
			"a Slack setup without its callback port": { integrations: { ...integration, slack: { ...integration.slack, setup: { ...integration.slack.setup, callbackPort: undefined } } } },
			"an integration under another id": { integrations: { ...integration, slack: { ...integration.slack, id: "linear" } } },
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
