import { describe, expect, test } from "bun:test";
import { connectionOf, type McpProbes } from "./integrations";
import { type McpServer, McpRefused } from "./omp/mcp";

const found: McpServer = { name: "linear", url: "https://mcp.linear.app/mcp", credentialId: "mcp:linear" };
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
		const failing = await connectionOf(
			found,
			probes(true, async () => {
				throw new Error("HTTP 502");
			}),
		);
		expect(failing).toEqual({ kind: "failing", server, error: "HTTP 502" });
	});
});
