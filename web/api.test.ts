import { expect, test } from "bun:test";
import { ApiError, readJson } from "./api";

test("a body that is not JSON reports its status and text, not a JSON parse error", async () => {
	await expect(readJson(new Response("not found", { status: 404, statusText: "Not Found" }))).rejects.toThrow("HTTP 404 Not Found: not found");
	await expect(readJson(Response.json({ error: "AGENTS.md changed on disk", conflict: true }, { status: 409 }))).rejects.toMatchObject({
		message: "AGENTS.md changed on disk",
		conflict: true,
	});
	expect(await readJson<{ cwd: null }>(Response.json({ cwd: null }))).toEqual({ cwd: null });
});

test.each([null, false, 42, "unavailable", [], { error: 123, conflict: "yes" }].map(body => ({ body })))("malformed JSON error envelope %j retains HTTP context", async ({ body }) => {
	const failure = await readJson(Response.json(body, { status: 502 })).catch(error => error);
	expect(failure).toBeInstanceOf(ApiError);
	expect(failure).toMatchObject({ message: "HTTP 502", conflict: false });
});
