import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { McpIntegration, McpServerConnection } from "../../../src/shared/accounts";
import { McpIntegrationRow } from "./mcp-integration";

const ENABLE = 'href="https://console.developers.google.com/apis/api/calendarmcp.googleapis.com/overview?project=30887206948"';
const server = { name: "google-calendar", url: "https://calendarmcp.googleapis.com/mcp/v1", host: "calendarmcp.googleapis.com" };
const failing = (status: number | null, error = `The "google-calendar" MCP server answered HTTP ${status}`) => ({ kind: "failing" as const, server, error, status });
const calendar = (...connections: McpServerConnection[]): McpIntegration => ({
	id: "google-calendar",
	accounts: connections.map((connection, at) => ({ name: at === 0 ? "google-calendar" : `google-calendar-${at + 1}`, address: `me${at}@example.com`, connection, workspaces: [] })),
	signIn: null,
	setup: { clientId: "30887206948-fot6diel47j76ceoft65e8sjojbstop1.apps.googleusercontent.com", hasClientSecret: true, callbackPort: 3119, configured: true },
});
const row = (integration: McpIntegration): string => renderToStaticMarkup(<McpIntegrationRow integration={integration} workspaces={null} />);

describe("McpIntegrationRow", () => {
	test("a Google account answered 403 links to the API's enable page in the client's project, and still offers Check again", () => {
		const html = row(calendar(failing(403)));
		expect(html).toContain("Enable Calendar MCP API");
		expect(html).toContain(ENABLE);
		expect(html).toContain("Check again");
		expect(html).toContain("the Calendar MCP API is off in your OAuth client&#x27;s Google Cloud project");
		expect(html).not.toContain("answered HTTP 403");
	});

	test("another failure shows the server's error with Check again alone", () => {
		const html = row(calendar(failing(502)));
		expect(html).toContain("answered HTTP 502");
		expect(html).toContain("Check again");
		expect(html).not.toContain("Enable Calendar MCP API");
	});

	test("a Google service with a saved client lists each account by its address and offers Add account", () => {
		const html = row(calendar({ kind: "ready", server, tools: [] }, { kind: "ready", server, tools: [] }));
		expect(html).toContain("me0@example.com");
		expect(html).toContain("me1@example.com");
		expect(html).toContain("google-calendar-2");
		expect(html).toContain("Add account");
		expect(html).toContain("2 accounts");
	});

	test("a 403 from a server that is not Google's gets no enable link", () => {
		const linear: McpIntegration = { id: "linear", connection: { ...failing(403, 'The "linear" MCP server answered HTTP 403'), server: { name: "linear", url: "https://mcp.linear.app/mcp", host: "mcp.linear.app" } }, signIn: null, setup: null };
		const html = row(linear);
		expect(html).toContain("answered HTTP 403");
		expect(html).not.toContain("console.developers.google.com");
	});
});
