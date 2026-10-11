import { describe, expect, test } from "bun:test";
import { connectionOf, type McpProbes } from "./integrations";
import { fixLinkOf, type McpServer, McpNeedsFix } from "./omp/mcp";

const GOOGLE_CALENDAR_BODY = '{"id":2,"jsonrpc":"2.0","result":{"content":[{"text":"Calendar MCP API has not been used in project 30887206948 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/calendarmcp.googleapis.com/overview?project=30887206948 then retry."}]}}';
const GMAIL_BODY = '{"id":2,"jsonrpc":"2.0","result":{"content":[{"text":"Gmail MCP API has not been used in project 30887206948 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/gmailmcp.googleapis.com/overview?project=30887206948 then retry."}]}}';

describe("google API enable link", () => {
	test("fixLinkOf reads the URL Google puts in its 403 error text", () => {
		expect(fixLinkOf(GOOGLE_CALENDAR_BODY)).toEqual({ url: "https://console.developers.google.com/apis/api/calendarmcp.googleapis.com/overview?project=30887206948" });
		expect(fixLinkOf(GMAIL_BODY)).toEqual({ url: "https://console.developers.google.com/apis/api/gmailmcp.googleapis.com/overview?project=30887206948" });
	});

	test("fixLinkOf ignores a 403 that names no enable URL", () => {
		expect(fixLinkOf("Server answered HTTP 502")).toBeNull();
		expect(fixLinkOf("{}")).toBeNull();
	});

	test("connectionOf surfaces the enable URL when checkMcpServer's error carries it", async () => {
		const found: McpServer = { name: "google-calendar", url: "https://calendarmcp.googleapis.com/mcp/v1", credentialId: "mcp:google-calendar" };
		const server = { name: "google-calendar", url: "https://calendarmcp.googleapis.com/mcp/v1", host: "calendarmcp.googleapis.com" };
		const probes: McpProbes = {
			signedIn: async () => true,
			tools: async () => {
				const fix = fixLinkOf(GOOGLE_CALENDAR_BODY);
				if (!fix) throw new Error("expected the live body to name the enable URL");
				throw new McpNeedsFix("The \"google-calendar\" MCP server needs the API enabled in its Google Cloud project.", fix);
			},
		};
		expect(await connectionOf(found, probes)).toEqual({
			kind: "failing",
			server,
			error: "The \"google-calendar\" MCP server needs the API enabled in its Google Cloud project.",
			fix: { url: "https://console.developers.google.com/apis/api/calendarmcp.googleapis.com/overview?project=30887206948" },
		});
	});
});
