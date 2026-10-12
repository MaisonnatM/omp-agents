import { describe, expect, test } from "bun:test";
import { statusOf } from "./mcp-servers";
import { McpUnauthorized } from "./omp/mcp";

const unauthorized = async (): Promise<never> => {
	throw new McpUnauthorized("HTTP 401");
};

describe("statusOf", () => {
	test("a server that lists its tools is ready with them", async () => {
		expect(await statusOf(false, async () => [{ name: "search", description: null }])).toEqual({ kind: "ready", tools: [{ name: "search", description: null }] });
	});

	test("a 401 asks for a sign-in when omp holds none, and says the server refused it when omp does", async () => {
		expect(await statusOf(false, unauthorized)).toEqual({ kind: "signed-out" });
		expect(await statusOf(true, unauthorized)).toEqual({ kind: "refused", error: "The server refused omp's sign-in. Reconnect to sign in again." });
	});

	test("any other error leaves the server failing with its message, signed in or not", async () => {
		const timedOut = async (): Promise<never> => {
			throw new Error("timed out after 20s");
		};
		expect(await statusOf(true, timedOut)).toEqual({ kind: "failing", error: "timed out after 20s" });
		expect(await statusOf(false, timedOut)).toEqual({ kind: "failing", error: "timed out after 20s" });
	});
});
