import { describe, expect, test } from "bun:test";
import type { McpIntegration, McpServerConnection } from "../../../src/shared/accounts";
import { integrationStatus } from "./services";

const server = { name: "google-calendar", url: "https://calendarmcp.googleapis.com/mcp/v1", host: "calendarmcp.googleapis.com" };
const ready: McpServerConnection = { kind: "ready", server, tools: [] };
const signedOut: McpServerConnection = { kind: "signed-out", server };
const setup = (configured: boolean) => ({ clientId: configured ? "30887206948-x.apps.googleusercontent.com" : null, hasClientSecret: configured, callbackPort: 3119, configured });
const calendar = (configured: boolean, connections: McpServerConnection[], signIn: McpIntegration["signIn"] = null): McpIntegration => ({
	id: "google-calendar",
	accounts: connections.map((connection, at) => ({ name: `google-calendar-${at + 1}`, address: null, addressError: null, connection, space: "work" as const })),
	signIn,
	setup: setup(configured),
});
const slack = (configured: boolean, connection: McpIntegration<"slack">["connection"], signIn: McpIntegration["signIn"] = null): McpIntegration => ({
	id: "slack",
	connection,
	signIn,
	setup: { clientId: configured ? "1.2" : null, hasClientSecret: configured, redirectUri: null, callbackPort: 3118, scope: "", configured },
});
const label = (integration: McpIntegration): string => integrationStatus(integration).label;

describe("integrationStatus", () => {
	test("a Google service without its OAuth client is not set up, and one with it reads its first account", () => {
		expect(label(calendar(false, []))).toBe("Not set up");
		expect(label(calendar(true, []))).toBe("Not connected");
		expect(label(calendar(true, [signedOut]))).toBe("Signed out");
	});

	test("a Google service counts its signed-in accounts, and a sign-in for a new account waits on you", () => {
		expect(label(calendar(true, [ready]))).toBe("Connected");
		expect(label(calendar(true, [ready, ready, signedOut]))).toBe("2 accounts");
		expect(label(calendar(true, [ready], { phase: "waiting", url: "https://accounts.google.com", account: null }))).toBe("Waiting for you");
	});

	test("a waiting sign-in again for one existing account leaves the service's badge on its accounts", () => {
		expect(label(calendar(true, [ready], { phase: "waiting", url: "https://accounts.google.com", account: "google-calendar-1" }))).toBe("Connected");
	});

	test("a one-server service without its client is not set up until it is signed in", () => {
		expect(label(slack(false, { kind: "absent" }))).toBe("Not set up");
		expect(label(slack(false, { ...ready, server: { ...server, name: "slack" } }))).toBe("Connected");
		expect(label(slack(true, { kind: "absent" }))).toBe("Not connected");
		expect(label(slack(true, { kind: "absent" }, { phase: "waiting", url: "https://slack.com", account: null }))).toBe("Waiting for you");
	});
});
