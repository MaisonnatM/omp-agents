import { expect, test } from "bun:test";
import { readJson } from "./api";

test("a body that is not JSON reports its status and text, not a JSON parse error", async () => {
	await expect(readJson(new Response("not found", { status: 404, statusText: "Not Found" }))).rejects.toThrow("HTTP 404 Not Found: not found");
	await expect(readJson(Response.json({ error: "AGENTS.md changed on disk", conflict: true }, { status: 409 }))).rejects.toMatchObject({
		message: "AGENTS.md changed on disk",
		conflict: true,
	});
	expect(await readJson<{ cwd: null }>(Response.json({ cwd: null }))).toEqual({ cwd: null });
});
