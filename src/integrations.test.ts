import { describe, expect, test } from "bun:test";
import { connectionOf, type McpProbes } from "./integrations";
import { ApiError, type McpServer, McpRefused, McpUnauthorized } from "./omp/mcp";

const found: McpServer = { name: "linear", url: "https://mcp.linear.app/mcp", credentialId: "mcp:linear", config: { type: "http", url: "https://mcp.linear.app/mcp" } };
const server = { name: "linear", url: "https://mcp.linear.app/mcp", host: "mcp.linear.app" };

const probes = (signedIn: boolean, tools: () => Promise<string[]>): McpProbes => ({ signedIn: async () => signedIn, tools });
const unreached = async (): Promise<string[]> => {
	throw new Error("listed the tools without a sign-in");
};

describe("connectionOf", () => {
	test("no server in omp's config is absent, and a server without a sign-in is signed out without listing its tools", async () => {
		expect(await connectionOf(null, probes(true, unreached))).toEqual({ kind: "absent" });
		expect(await connectionOf(found, probes(false, unreached))).toEqual({ kind: "signed-out", server });
	});

	test("a signed-in server is ready with its tools, refused when it refuses the sign-in, and failing on any other error", async () => {
		expect(await connectionOf(found, probes(true, async () => ["list_issues"]))).toEqual({ kind: "ready", server, tools: ["list_issues"] });
		const refused = await connectionOf(
			found,
			probes(true, async () => {
				throw new McpRefused("refused omp's sign-in");
			}),
		);
		expect(refused).toEqual({ kind: "refused", server, error: "refused omp's sign-in" });
		expect(await connectionOf(found, probes(true, async () => {
			throw new McpUnauthorized("linear answered 401 Unauthorized");
		}))).toEqual({ kind: "refused", server, error: "linear answered 401 Unauthorized" });
		const timedOut = await connectionOf(
			found,
			probes(true, async () => {
				throw new Error("The operation timed out.");
			}),
		);
		expect(timedOut).toEqual({ kind: "failing", server, error: "The operation timed out.", status: null });
	});

	test("a failing server keeps the HTTP status it answered", async () => {
		const forbidden = await connectionOf(
			found,
			probes(true, async () => {
				throw new ApiError('The "linear" MCP server answered HTTP 403', 403);
			}),
		);
		expect(forbidden).toEqual({ kind: "failing", server, error: 'The "linear" MCP server answered HTTP 403', status: 403 });
	});
});

