import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { McpIntegration } from "../../../src/shared/accounts";
import { McpIntegrationRow } from "./mcp-integration";

const server = { name: "slack", url: "https://mcp.slack.com/mcp", host: "mcp.slack.com" };

describe("McpIntegrationRow", () => {
	test("a failing server shows its error with Check again", () => {
		const slack: McpIntegration = {
			id: "slack",
			connection: { kind: "failing", server, error: 'The "slack" MCP server answered HTTP 502', status: 502 },
			signIn: null,
			setup: { clientId: "1.2", hasClientSecret: true, redirectUri: "https://example.com/callback", callbackPort: 3118, scope: "chat:write", configured: true },
		};
		const html = renderToStaticMarkup(<McpIntegrationRow integration={slack} />);
		expect(html).toContain("answered HTTP 502");
		expect(html).toContain("Check again");
	});
});
