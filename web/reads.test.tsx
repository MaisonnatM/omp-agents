import { expect, test } from "bun:test";
import type { Analytics, AnalyticsRange } from "../src/shared/analytics";

function analytics(range: AnalyticsRange, requests: number): Analytics {
	return {
		range,
		sync: { phase: "idle" },
		totals: { requests, failed: 0, tokens: { input: 100, output: 200, cacheRead: 0, cacheWrite: 0, total: 300 }, cost: 0.5, cacheRate: 0 },
		providers: [],
		series: [{ start: 1, tokens: 300, cost: 0.5, requests, providers: [] }],
		models: [],
		workspaces: [],
		agents: { main: 300, subagent: 0, advisor: 0 },
		tools: [],
		sessions: [],
	};
}

const analyticsScenario = String.raw`
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const cacheKey = "omp-agents.analytics-cache";
const memory = new Map([[cacheKey, process.env.ANALYTICS_CACHE]]);
globalThis.localStorage = {
	getItem: key => memory.get(key) ?? null,
	setItem: (key, value) => memory.set(key, value),
};
// Static imports would hydrate the cache before storage is installed in this fresh process.
const { analyticsStore } = await import("./reads.ts");
function Summary({ range }) {
	const entry = analyticsStore.use(range);
	return createElement("span", null, entry.read
		? entry.read.data.range + ":" + entry.read.data.totals.requests + ":" + (entry.error ? "failed" : "ok")
		: "loading");
}
const shown = range => renderToStaticMarkup(createElement(Summary, { range }));
const initial = [shown("24h"), shown("7d")];
globalThis.fetch = async () => new Response(process.env.ANALYTICS_FRESH);
await analyticsStore.refresh("24h");
const refreshed = [shown("24h"), shown("7d")];
globalThis.fetch = async () => new Response("unavailable", { status: 503 });
await analyticsStore.refresh("7d");
console.log(JSON.stringify({
	initial,
	refreshed,
	failed: shown("7d"),
	persisted: JSON.parse(memory.get(cacheKey)),
}));
`;

test.each([
	{ name: "cached ranges stay separate", data: analytics("24h", 12), shown: "<span>24h:12:ok</span>" },
	{ name: "a damaged token summary is discarded", data: { ...analytics("24h", 12), totals: { tokens: null } }, shown: "<span>loading</span>" },
	{ name: "a legacy chart without provider buckets is discarded", data: { ...analytics("24h", 12), series: [{ start: 1 }] }, shown: "<span>loading</span>" },
])("analytics cache: $name", async ({ data, shown }) => {
	const child = Bun.spawn([process.execPath, "--eval", analyticsScenario], {
		cwd: import.meta.dir,
		env: {
			...process.env,
			ANALYTICS_CACHE: JSON.stringify({ "24h": { data, at: 1 }, "7d": { data: analytics("7d", 31), at: 1 } }),
			ANALYTICS_FRESH: JSON.stringify(analytics("24h", 42)),
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	const result = JSON.parse(stdout);
	expect(result.initial).toEqual([shown, "<span>7d:31:ok</span>"]);
	expect(result.refreshed).toEqual(["<span>24h:42:ok</span>", "<span>7d:31:ok</span>"]);
	expect(result.failed).toBe("<span>7d:31:failed</span>");
	expect(result.persisted["24h"].data.totals.requests).toBe(42);
	expect(result.persisted["7d"].data.totals.requests).toBe(31);
});

const integrationsScenario = String.raw`
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const memory = new Map([["omp-agents.integrations-cache", process.env.INTEGRATIONS_CACHE]]);
globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
// A static import would hydrate the cache before storage is installed in this fresh process.
const { integrationsStore } = await import("./reads.ts");
function Slack() {
	const connection = integrationsStore.use().read?.data.integrations.slack.connection;
	return createElement("span", null, connection ? connection.kind + ":" + (connection.tools?.map(tool => tool.name).join(",") ?? "") : "loading");
}
console.log(renderToStaticMarkup(createElement(Slack)));
`;

const server = { name: "slack", url: "https://mcp.slack.com/mcp", host: "mcp.slack.com" };

test.each([
	{ name: "a ready connection's tools stay usable", connection: { kind: "ready", server, tools: [{ name: "search_messages", description: null }] }, shown: "<span>ready:search_messages</span>" },
	{ name: "a connection without tools stays usable", connection: { kind: "signed-out", server }, shown: "<span>signed-out:</span>" },
	{ name: "a ready connection that lists tool names is discarded", connection: { kind: "ready", server, tools: ["search_messages"] }, shown: "<span>loading</span>" },
	{ name: "an integration without a connection is discarded", connection: undefined, shown: "<span>loading</span>" },
])("integrations cache: $name", async ({ connection, shown }) => {
	const setup = { clientId: null, hasClientSecret: false, callbackPort: 3119, configured: false };
	const integrations = {
		slack: { id: "slack", connection, signIn: null, setup: { ...setup, redirectUri: null, scope: "chat:write" } },
		"google-calendar": { id: "google-calendar", accounts: [], signIn: null, setup },
		gmail: { id: "gmail", accounts: [], signIn: null, setup },
	};
	const child = Bun.spawn([process.execPath, "--eval", integrationsScenario], {
		cwd: import.meta.dir,
		env: { ...process.env, INTEGRATIONS_CACHE: JSON.stringify({ "": { data: { integrations }, at: 1 } }) },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	expect(stdout.trim()).toBe(shown);
});

const refreshScenario = String.raw`
import { act, createElement } from "react";

// React DOM mounts a component that renders nothing with only these parts of a document.
const noop = () => {};
const document = { addEventListener: noop, removeEventListener: noop };
const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: document, addEventListener: noop, removeEventListener: noop };
document.documentElement = container;
Object.assign(globalThis, { window: globalThis, document, HTMLIFrameElement: class {}, IS_REACT_ACT_ENVIRONMENT: true });
const answers = [];
globalThis.fetch = () => {
	const { promise, resolve } = Promise.withResolvers();
	answers.push(resolve);
	return promise;
};
const { createRoot } = await import("react-dom/client");
const { useRead } = await import("./reads.ts");

const seen = [];
function Probe({ url, version }) {
	const { data, error, refreshing } = useRead(url, version);
	const state = JSON.stringify({ n: data?.n ?? null, error, refreshing });
	if (seen.at(-1) !== state) seen.push(state);
	return null;
}
const root = createRoot(container);
const render = (url, version) => act(async () => root.render(createElement(Probe, { url, version })));
const answer = (status, body) => act(async () => answers.shift()(new Response(JSON.stringify(body), { status })));
await render("/api/a", 0);
await answer(200, { n: 1 });
await render("/api/a", 1);
await answer(200, { n: 2 });
await render("/api/a", 2);
await answer(500, { error: "stats offline" });
await render("/api/b", 2);
console.log(JSON.stringify(seen.map(state => JSON.parse(state))));
`;

test("useRead is refreshing while a new version reads over the last answer, until that read answers or fails", async () => {
	const child = Bun.spawn([process.execPath, "--eval", refreshScenario], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	expect(JSON.parse(stdout)).toEqual([
		{ n: null, error: null, refreshing: false },
		{ n: 1, error: null, refreshing: false },
		{ n: 1, error: null, refreshing: true },
		{ n: 2, error: null, refreshing: false },
		{ n: 2, error: null, refreshing: true },
		{ n: 2, error: "stats offline", refreshing: false },
		{ n: null, error: null, refreshing: false },
	]);
});

const mailThreadScenario = String.raw`
import { act, createElement } from "react";

const noop = () => {};
const document = { addEventListener: noop, removeEventListener: noop };
const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml", ownerDocument: document, addEventListener: noop, removeEventListener: noop };
document.documentElement = container;
Object.assign(globalThis, { window: globalThis, document, HTMLIFrameElement: class {}, IS_REACT_ACT_ENVIRONMENT: true });
const requests = [];
globalThis.fetch = url => {
	const { promise, resolve } = Promise.withResolvers();
	requests.push({ url, resolve });
	return promise;
};
const { createRoot } = await import("react-dom/client");
const { useMailThread } = await import("./reads.ts");

const seen = [];
function Probe({ arrived }) {
	const { read, refreshing } = useMailThread("gmail-2", "18f2a", arrived);
	const state = JSON.stringify({ subject: read?.data.subject ?? null, refreshing });
	if (seen.at(-1) !== state) seen.push(state);
	return null;
}
const root = createRoot(container);
const render = arrived => act(async () => root.render(createElement(Probe, { arrived })));
const answer = (index, subject) => act(async () => requests[index].resolve(Response.json({ id: "18f2a", subject, url: "", messages: [] })));
await render(null);
await answer(0, "first");
await render(0);
await render(Date.now() + 60_000);
await answer(1, "after a reply");
console.log(JSON.stringify({ urls: requests.map(({ url }) => url), seen: seen.map(state => JSON.parse(state)) }));
`;

test("a conversation is read once and again when the Email page lists a later message arrival", async () => {
	const child = Bun.spawn([process.execPath, "--eval", mailThreadScenario], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
	expect(JSON.parse(stdout)).toEqual({
		urls: ["/api/gmail/thread?account=gmail-2&id=18f2a", "/api/gmail/thread?account=gmail-2&id=18f2a&fresh"],
		seen: [
			{ subject: null, refreshing: false },
			{ subject: null, refreshing: true },
			{ subject: "first", refreshing: false },
			{ subject: "first", refreshing: true },
			{ subject: "after a reply", refreshing: false },
		],
	});
});
