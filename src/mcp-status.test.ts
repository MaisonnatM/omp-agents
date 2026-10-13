import { describe, expect, test } from "bun:test";
import { remoteStatusOf } from "./mcp-status";
import { type McpServer, type McpToolDefinition, McpUnauthorized } from "./omp/mcp";
import { ApiError } from "./signed-fetch";
import type { McpRemoteStatus } from "./shared/mcp-status";

const server: McpServer = { name: "linear", url: "https://mcp.linear.app/mcp", credentialId: "mcp:linear", config: { type: "http", url: "https://mcp.linear.app/mcp" } };

const failing = (err: Error) => async (): Promise<never> => {
	throw err;
};
const unreached = failing(new Error("listed the tools"));

describe("remoteStatusOf", () => {
	test("a server that requires a sign-in omp does not hold is signed out without listing its tools", async () => {
		expect(await remoteStatusOf(server, { signedIn: false, signInRequired: true }, false, unreached)).toEqual({ kind: "signed-out" });
	});

	test("a server that lists its tools is ready with them, read with the sign-in omp holds and the freshness asked", async () => {
		const asked: [boolean, boolean][] = [];
		const list = async (_: McpServer, signedIn: boolean, fresh: boolean): Promise<McpToolDefinition[]> => {
			asked.push([signedIn, fresh]);
			return [{ name: "search", description: " Finds issues. " }, { name: "save", description: "  " }];
		};
		const ready: McpRemoteStatus = { kind: "ready", tools: [{ name: "search", description: "Finds issues." }, { name: "save", description: null }] };
		expect(await remoteStatusOf(server, { signedIn: true, signInRequired: true }, true, list)).toEqual(ready);
		expect(await remoteStatusOf(server, { signedIn: false, signInRequired: false }, false, list)).toEqual(ready);
		expect(asked).toEqual([[true, true], [false, false]]);
	});

	test("discovery's 401 is a sign-in to start when omp holds none, and a refused one when it does", async () => {
		const unauthorized = failing(new McpUnauthorized("linear answered 401 Unauthorized"));
		expect(await remoteStatusOf(server, { signedIn: false, signInRequired: false }, false, unauthorized)).toEqual({ kind: "signed-out" });
		expect(await remoteStatusOf(server, { signedIn: true, signInRequired: true }, false, unauthorized)).toEqual({ kind: "refused", error: "The server refused omp's sign-in. Reconnect to sign in again." });
	});

	test("any other failure is failing with its message and the HTTP status the server answered, if any", async () => {
		const forbidden = failing(new ApiError('The "linear" MCP server answered HTTP 403', 403));
		expect(await remoteStatusOf(server, { signedIn: true, signInRequired: true }, false, forbidden)).toEqual({ kind: "failing", error: 'The "linear" MCP server answered HTTP 403', status: 403 });
		const timedOut = failing(new Error("The operation timed out."));
		expect(await remoteStatusOf(server, { signedIn: false, signInRequired: false }, false, timedOut)).toEqual({ kind: "failing", error: "The operation timed out.", status: null });
	});
});
