import { describe, expect, test } from "bun:test";
import type { McpRemoteStatus } from "./shared/mcp-status";
import { createServerSignIn, createSignIn } from "./sign-in";

const ready: McpRemoteStatus = { kind: "ready", tools: [] };
const signedOut: McpRemoteStatus = { kind: "signed-out" };

/** A sign-in run that waits on the browser until its test ends. */
const waitsOnBrowser = async (_: AbortSignal, waiting: (url: string) => void): Promise<void> => {
	waiting("https://example.com/authorize");
	await Promise.withResolvers<void>().promise;
};

describe("SignIn.hold", () => {
	test("reads the status again while no sign-in waits, and repeats the one read during a sign-in that waits on the browser", async () => {
		const signIn = createServerSignIn("timed out");
		expect(await signIn.hold(async () => signedOut)).toEqual(signedOut);
		expect(await signIn.hold(async () => ready)).toEqual(ready);
		await signIn.start(waitsOnBrowser);
		expect(signIn.state()).toEqual({ phase: "waiting", url: "https://example.com/authorize" });
		expect(await signIn.hold(async () => ready)).toEqual(ready);
		expect(await signIn.hold(async () => signedOut)).toEqual(ready);
		signIn.cancel();
		expect(await signIn.hold(async () => signedOut)).toEqual(signedOut);
	});

	test("a failed sign-in holds nothing", async () => {
		const signIn = createServerSignIn("timed out");
		await signIn.start(async () => {
			throw new Error("denied");
		});
		expect(signIn.state()).toEqual({ phase: "failed", error: "denied" });
		expect(await signIn.hold(async () => signedOut)).toEqual(signedOut);
		expect(await signIn.hold(async () => ready)).toEqual(ready);
	});

	test("a sign-in to another account starts holding nothing, and holds only its own account's status", async () => {
		const signIn = createSignIn<string>("timed out");
		await signIn.start("gmail", waitsOnBrowser);
		expect(await signIn.hold("gmail", async () => ready)).toEqual(ready);
		await signIn.start("gmail-2", waitsOnBrowser);
		expect(signIn.state()).toEqual({ signIn: { phase: "waiting", url: "https://example.com/authorize" }, target: "gmail-2" });
		expect(await signIn.hold("gmail-2", async () => signedOut)).toEqual(signedOut);
		expect(await signIn.hold("gmail-2", async () => ready)).toEqual(signedOut);
		expect(await signIn.hold("gmail", async () => signedOut)).toEqual(signedOut);
	});
});
