import { afterAll, describe, expect, test } from "bun:test";
import { artifactText } from "./artifact-links";

const realFetch = globalThis.fetch;
let answers: Response[] = [];
globalThis.fetch = (async () => answers.shift() ?? new Response("unexpected request", { status: 500 })) as unknown as typeof fetch;
afterAll(() => {
	globalThis.fetch = realFetch;
});

describe("artifactText", () => {
	test("a version is read once, by every reader that asks while it loads and after", async () => {
		answers = [new Response("first"), new Response("second")];
		expect(await Promise.all([artifactText("/api/artifact?once"), artifactText("/api/artifact?once")])).toEqual(["first", "first"]);
		expect(await artifactText("/api/artifact?once")).toBe("first");
	});

	test("a failed read never stands in for the text, and the next reader asks again", async () => {
		answers = [new Response("Artifact version not found", { status: 404 }), new Response("saved copy")];
		await expect(artifactText("/api/artifact?retry")).rejects.toThrow();
		expect(await artifactText("/api/artifact?retry")).toBe("saved copy");
	});
});
