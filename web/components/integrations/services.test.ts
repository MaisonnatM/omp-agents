import { describe, expect, test } from "bun:test";
import type { McpIntegration, McpServerConnection } from "../../../src/shared/accounts";
import { integrationStatus } from "./services";

const server = { name: "slack", url: "https://mcp.slack.com/mcp", host: "mcp.slack.com" };
const ready: McpServerConnection = { kind: "ready", server, tools: [] };
const slack = (configured: boolean, connection: McpIntegration<"slack">["connection"], signIn: McpIntegration["signIn"] = null): McpIntegration => ({
	id: "slack",
	connection,
	signIn,
	setup: { clientId: configured ? "1.2" : null, hasClientSecret: configured, redirectUri: null, callbackPort: 3118, scope: "", configured },
});
const label = (integration: McpIntegration): string => integrationStatus(integration).label;

describe("integrationStatus", () => {
	test("a service without its client is not set up until it is signed in", () => {
		expect(label(slack(false, { kind: "absent" }))).toBe("Not set up");
		expect(label(slack(false, ready))).toBe("Connected");
		expect(label(slack(true, { kind: "absent" }))).toBe("Not connected");
		expect(label(slack(true, { kind: "signed-out", server }))).toBe("Signed out");
	});

	test("a sign-in waiting on you shows over the connection", () => {
		expect(label(slack(true, ready, { phase: "waiting", url: "https://slack.com" }))).toBe("Waiting for you");
	});
});
