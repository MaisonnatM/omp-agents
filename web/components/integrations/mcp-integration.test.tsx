import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { McpIntegrationRow } from "./mcp-integration";
import type { McpIntegration } from "../../../src/shared/accounts";

const integration = (connection: McpIntegration["connection"]): McpIntegration => ({
	id: "google-calendar",
	connection,
	signIn: null,
	setup: { clientId: "30887206948-fot6diel47j76ceoft65e8sjojbstop1.apps.googleusercontent.com", hasClientSecret: true, callbackPort: 3119, configured: true },
});

describe("McpIntegrationRow", () => {
	test("a failing connection with a fix link renders the Open the fix button, not Check again", () => {
		const html = renderToStaticMarkup(
			<McpIntegrationRow
				integration={integration({
					kind: "failing",
					server: { name: "google-calendar", url: "https://calendarmcp.googleapis.com/mcp/v1", host: "calendarmcp.googleapis.com" },
					error: 'The "google-calendar" MCP server needs the API enabled in its Google Cloud project.',
					fix: { url: "https://console.developers.google.com/apis/api/calendarmcp.googleapis.com/overview?project=30887206948" },
				})}
			/>,
		);
		expect(html).toContain("Open the fix");
		expect(html).toContain('href="https://console.developers.google.com/apis/api/calendarmcp.googleapis.com/overview?project=30887206948"');
		expect(html).toContain('target="_blank"');
		expect(html).not.toContain("Check again");
	});

	test("a failing connection without a fix renders Check again", () => {
		const html = renderToStaticMarkup(
			<McpIntegrationRow
				integration={integration({
					kind: "failing",
					server: { name: "google-calendar", url: "https://calendarmcp.googleapis.com/mcp/v1", host: "calendarmcp.googleapis.com" },
					error: "HTTP 502",
				})}
			/>,
		);
		expect(html).toContain("Check again");
		expect(html).not.toContain("Open the fix");
	});
});
