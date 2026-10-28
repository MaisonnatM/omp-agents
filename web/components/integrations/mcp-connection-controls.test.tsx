import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { type McpServerRow, type OwnServer, ownServers } from "../../../src/shared/mcp-servers";
import type { SignInControls } from "../../use-sign-in";
import { ConnectionCallout, type ConnectionCalloutProps } from "./mcp-connection-controls";
import { McpServerItem } from "./mcp-server-row";

const idle: SignInControls = { starting: false, waitingUrl: null, failure: null, connect: async () => {} };
const failing = { message: "Server unreachable", checking: false, check: () => {} };
const refused = { message: "Server refused" };
const callout = (props: Partial<ConnectionCalloutProps>): string =>
	renderToStaticMarkup(<ConnectionCallout approveOn="Notion" signIn={idle} question={null} refused={null} failing={null} {...props} />);

describe("ConnectionCallout", () => {
	test("a waiting sign-in wins over the row's question and every failure", () => {
		const html = callout({ signIn: { ...idle, waitingUrl: "https://auth.example/approve", failure: "denied" }, question: <p>Question</p>, refused, failing });
		expect(html).toContain("Approve omp on Notion in the tab that opened");
		expect(html).toContain('href="https://auth.example/approve"');
		expect(html).not.toContain("Question");
	});

	test("the row's question wins over a sign-in failure", () => {
		const html = callout({ signIn: { ...idle, failure: "denied" }, question: <p>Question</p>, refused });
		expect(html).toContain("Question");
		expect(html).not.toContain("denied");
	});

	test("a sign-in failure wins over the row's own error, which wins over a refused sign-in", () => {
		expect(callout({ signIn: { ...idle, failure: "denied" }, error: "Cannot change notion: busy", refused })).toContain("Sign-in failed: denied");
		const html = callout({ error: "Cannot change notion: busy", refused });
		expect(html).toContain("Cannot change notion: busy");
		expect(html).not.toContain("Server refused");
	});

	test("a refused sign-in offers Reconnect unless the row names another fix, before an unreachable server", () => {
		const html = callout({ refused, failing });
		expect(html).toContain("Server refused");
		expect(html).toContain("Reconnect");
		expect(html).not.toContain("Server unreachable");
		expect(callout({ refused: { message: "Set it up", fix: <button type="button">Set up</button> } })).not.toContain("Reconnect");
	});

	test("an unreachable server offers its fix before Check again", () => {
		const html = callout({ failing: { ...failing, fix: <a href="https://enable.example">Enable</a> } });
		expect(html).toContain("Server unreachable");
		expect(html.indexOf("Enable")).toBeLessThan(html.indexOf("Check again"));
	});
});

const notion = (status: OwnServer["status"], signedIn: boolean): OwnServer => ({
	name: "notion",
	transport: "http",
	url: "https://mcp.notion.com/mcp",
	host: "mcp.notion.com",
	command: null,
	source: { label: "omp's mcp.json", path: "/tmp/mcp.json", editable: true },
	signedIn,
	status,
	signIn: null,
	catalogId: null,
});

describe("McpServerItem", () => {
	test("a signed-out server shows its badge and Connect", () => {
		const html = renderToStaticMarkup(<McpServerItem server={notion({ kind: "signed-out" }, false)} />);
		expect(html).toContain("Signed out");
		expect(html).toContain("Connect");
	});

	test("a refused server shows its error with Reconnect", () => {
		const html = renderToStaticMarkup(<McpServerItem server={notion({ kind: "refused", error: "The server refused omp's sign-in" }, true)} />);
		expect(html).toContain("Needs reconnecting");
		expect(html).toContain("The server refused omp&#x27;s sign-in");
		expect(html).toContain("Reconnect");
	});

	test("a ready server counts its tools", () => {
		const html = renderToStaticMarkup(<McpServerItem server={notion({ kind: "ready", tools: [{ name: "search", description: null }] }, true)} />);
		expect(html).toContain("Connected");
		expect(html).toMatch(/>1<\/span> tools/);
	});
});

describe("ownServers", () => {
	test("keeps the servers that are not integrations and names each integration once, in Settings › Integrations' order", () => {
		const local = notion({ kind: "local" }, false);
		const integration = (name: string, id: "gmail" | "linear" | "slack"): McpServerRow => ({ ...local, name, status: { kind: "integration", id } });
		const { own, integrations } = ownServers([integration("gmail-work", "gmail"), local, integration("slack", "slack"), integration("gmail-home", "gmail"), integration("linear", "linear")]);
		expect(own.map(server => server.name)).toEqual(["notion"]);
		expect(integrations).toEqual(["linear", "slack", "gmail"]);
	});
});
