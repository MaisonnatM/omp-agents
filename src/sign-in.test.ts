import { describe, expect, test } from "bun:test";
import type { McpRemoteStatus } from "./shared/mcp-status";
import { createSignIn } from "./sign-in";

const ready: McpRemoteStatus = { kind: "ready", tools: [] };
const signedOut: McpRemoteStatus = { kind: "signed-out" };

describe("SignIn.hold", () => {
	test("reads the status again while no sign-in waits, and repeats the one read during a sign-in that waits on the browser", async () => {
		const signIn = createSignIn("timed out");
		expect(await signIn.hold(async () => signedOut)).toEqual(signedOut);
		expect(await signIn.hold(async () => ready)).toEqual(ready);
		await signIn.start(async (_, waiting) => {
			waiting("https://example.com/authorize");
			await Promise.withResolvers<void>().promise;
		});
		expect(signIn.state()).toEqual({ phase: "waiting", url: "https://example.com/authorize" });
		expect(await signIn.hold(async () => ready)).toEqual(ready);
		expect(await signIn.hold(async () => signedOut)).toEqual(ready);
		signIn.cancel();
		expect(await signIn.hold(async () => signedOut)).toEqual(signedOut);
	});

	test("a failed sign-in holds nothing", async () => {
		const signIn = createSignIn("timed out");
		await signIn.start(async () => {
			throw new Error("denied");
		});
		expect(signIn.state()).toEqual({ phase: "failed", error: "denied" });
		expect(await signIn.hold(async () => signedOut)).toEqual(signedOut);
		expect(await signIn.hold(async () => ready)).toEqual(ready);
	});
});
