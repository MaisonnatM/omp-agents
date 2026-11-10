import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { IntegrationsAnswer, McpServerConnection } from "../../src/shared/accounts";
import type { PstackStatus } from "../../src/shared/readiness";
import { ToolsStep, type ToolsFacts } from "./get-started-tools";

const server = (name: string, host: string) => ({ name, url: `https://${host}/mcp`, host });
const ready = (name: string, host: string): McpServerConnection => ({ kind: "ready", server: server(name, host), tools: [] });
const googleSetup = { clientId: "30887206948-x.apps.googleusercontent.com", hasClientSecret: true, callbackPort: 3119, configured: true };
const account = (name: string, host: string) => ({ name, address: `me@${host}`, addressError: null, connection: ready(name, host), space: "work" as const });

const integrations: IntegrationsAnswer = {
	integrations: {
		linear: { id: "linear", connection: ready("linear", "mcp.linear.app"), signIn: null, setup: null },
		slack: { id: "slack", connection: ready("slack", "mcp.slack.com"), signIn: null, setup: { clientId: "1.2", hasClientSecret: true, redirectUri: null, callbackPort: 3118, scope: "", configured: true } },
		"google-calendar": { id: "google-calendar", accounts: [account("google-calendar", "calendarmcp.googleapis.com")], signIn: null, setup: googleSetup },
		gmail: { id: "gmail", accounts: [account("gmail", "gmailmcp.googleapis.com")], signIn: null, setup: googleSetup },
	},
};

const facts = (pstack: PstackStatus): ToolsFacts => ({
	github: { kind: "known", value: { state: "signed-in", account: "octocat" } },
	integrations: { read: { data: integrations, at: 0 }, error: null, refreshing: false },
	kit: { kind: "known", value: { pending: 0, kept: 0, total: 1, pstack } },
});
const step = (pstack: PstackStatus): string => renderToStaticMarkup(<ToolsStep facts={facts(pstack)} onKitStep={() => {}} onRefresh={() => {}} refreshing={false} />);

describe("ToolsStep", () => {
	test("with everything connected and pstack loaded, it says so and lists all six as Ready", () => {
		const html = step({ installed: true, skills: 57 });
		expect(html).toContain("Everything is set up.");
		expect(html).toContain('aria-label="Ready"');
		expect(html).not.toContain('aria-label="Action needed"');
	});

	test("missing pstack needs action, opens first, and points at the Starter kit step instead of installing the kit itself", () => {
		const html = step({ installed: false, skills: 0 });
		expect(html).not.toContain("Everything is set up.");
		expect(html).toContain('aria-label="Action needed"');
		expect(html).toContain('aria-label="Fold pstack"');
		expect(html).not.toContain("Install starter kit");
	});

	test("pstack installed with no linked skills still needs action", () => {
		const html = step({ installed: true, skills: 0 });
		expect(html).toContain("Skills not linked");
		expect(html).toContain("no session loads its skills yet");
		expect(html).toContain("Go to Starter kit");
	});
});
