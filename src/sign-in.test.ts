import { describe, expect, test } from "bun:test";
import type { McpRemoteStatus } from "./shared/mcp-status";
import { createSignIn } from "./sign-in";

const ready: McpRemoteStatus = { kind: "ready", tools: [] };
const signedOut: McpRemoteStatus = { kind: "signed-out" };

/** A sign-in run that waits on the browser until its test ends. */
const waitsOnBrowser = async (_: AbortSignal, waiting: (url: string) => void): Promise<void> => {
	waiting("https://example.com/authorize");
	await Promise.withResolvers<void>().promise;
};

describe("SignIn.hold", () => {
	test("reads the status again while no sign-in waits, and repeats the last one while one waits on the browser", async () => {
		const signIn = createSignIn("timed out");
		expect(await signIn.hold(async () => signedOut)).toEqual(signedOut);
		expect(await signIn.hold(async () => ready)).toEqual(ready);
		await signIn.start(waitsOnBrowser);
		expect(signIn.state()).toEqual({ phase: "waiting", url: "https://example.com/authorize" });
		expect(await signIn.hold(async () => signedOut)).toEqual(ready);
		signIn.cancel();
		expect(await signIn.hold(async () => signedOut)).toEqual(signedOut);
	});

	test("reads a server that has no status yet even while its sign-in waits, and a failed sign-in holds nothing", async () => {
		const signIn = createSignIn("timed out");
		await signIn.start(waitsOnBrowser);
		expect(await signIn.hold(async () => signedOut)).toEqual(signedOut);
		expect(await signIn.hold(async () => ready)).toEqual(signedOut);
		await signIn.start(async () => {
			throw new Error("denied");
		});
		expect(signIn.state()).toEqual({ phase: "failed", error: "denied" });
		expect(await signIn.hold(async () => ready)).toEqual(ready);
	});
});
