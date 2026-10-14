import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savedTools, TOOL_POLICY_ENTRY } from "./tool-policy";

const root = mkdtempSync(join(tmpdir(), "omp-tool-policy-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function transcript(entries: object[]): string {
	const path = join(root, `${crypto.randomUUID()}.jsonl`);
	writeFileSync(path, [
		{ type: "session", version: 3, id: "session", cwd: root, timestamp: "2026-10-14T00:00:00.000Z" },
		...entries,
	].map(entry => JSON.stringify(entry)).join("\n") + "\n");
	return path;
}

const policy = (id: string, parentId: string | null, tools: unknown): object => ({
	type: "custom", customType: TOOL_POLICY_ENTRY, id, parentId, data: { tools }, timestamp: "2026-10-14T00:00:00.000Z",
});
const prompt = (id: string, parentId: string | null): object => ({
	type: "message", id, parentId, timestamp: "2026-10-14T00:00:00.000Z", message: { role: "user", content: "Continue", timestamp: 0 },
});

test("resume follows the current branch, not a policy written on an abandoned branch", async () => {
	const path = transcript([policy("original", null, ["bash", "edit"]), policy("abandoned", "original", ["read"]), prompt("current", "original")]);
	expect(await savedTools(path)).toEqual(["bash", "edit"]);
	expect(await savedTools(path, "abandoned")).toEqual(["read"]);
});

test("a fork before the policy does not inherit restrictions added later", async () => {
	const path = transcript([prompt("before", null), policy("restricted", "before", ["bash", "edit"]), prompt("after", "restricted")]);
	expect(await savedTools(path, "before")).toBeNull();
	expect(await savedTools(path, "after")).toEqual(["bash", "edit"]);
});

test.each([null, undefined, [], ["bash", "bash"], ["bash", 1]])("a damaged policy refuses an unrestricted resume (%j)", async tools => {
	const path = transcript([policy("bad", null, tools), prompt("current", "bad")]);
	await expect(savedTools(path)).rejects.toThrow("invalid tool policy");
});
