import { afterEach, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { descriptionSnapshot, editDescription, type DescriptionChange } from "./agent/extensions/github/description";

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function directory(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-pr-description-"));
	directories.push(dir);
	return dir;
}
const snapshot = { body: "## Summary\nOriginal text.\n- [ ] Review\n", updatedAt: "2026-10-26T12:00:00Z" };

test("a failed read with empty stdout never reaches the write or creates a fake original", async () => {
	const dir = directory();
	const write = mock(async () => {});
	await expect(editDescription("acme-app-7", { kind: "append", text: "Reviewed" }, {
		read: async () => { throw Object.assign(new Error("GraphQL quota exhausted"), { stdout: "" }); }, write,
	}, dir)).rejects.toThrow("quota exhausted");
	expect(write).not.toHaveBeenCalled();
	expect(readdirSync(dir)).toEqual([]);
});

test("surgical replacement preserves surrounding bytes and a private original", async () => {
	const write = mock(async (_body: string) => {});
	const read = mock(async () => snapshot);
	const result = await editDescription("acme/app#7", { kind: "replace-text", oldText: "- [ ] Review", newText: "- [x] Review" }, { read, write }, directory());
	expect(write).toHaveBeenCalledWith("## Summary\nOriginal text.\n- [x] Review\n");
	expect(read).toHaveBeenCalledTimes(2);
	expect(readFileSync(result.originalFile, "utf8")).toBe(snapshot.body);
	expect(statSync(result.originalFile).mode & 0o777).toBe(0o600);
});

test.each([
	[{ kind: "replace-text", oldText: "Missing anchor", newText: "x" }, "anchor is absent"],
	[{ kind: "replace-text", oldText: "\n", newText: "x" }, "anchor is ambiguous"],
	[{ kind: "replace-text", oldText: snapshot.body, newText: "" }, "unintended empty"],
	[{ kind: "replace", original: snapshot.body, body: " \n" }, "unintended empty"],
	[{ kind: "replace", original: "Outdated", body: "new" }, "changed since it was read"],
	[{ kind: "append", text: "" }, "must not be empty"],
] satisfies [DescriptionChange, string][])('refuses unsafe edit %j', async (change, failure) => {
	const dir = directory();
	const write = mock(async () => {});
	await expect(editDescription("acme-app-7", change, { read: async () => snapshot, write }, dir)).rejects.toThrow(failure);
	expect(write).not.toHaveBeenCalled();
	expect(readFileSync(join(dir, readdirSync(dir)[0]!), "utf8")).toBe(snapshot.body);
});

test.each([
	{ ...snapshot, body: "Another author's edit" },
	{ ...snapshot, updatedAt: "2026-10-26T12:01:00Z" },
])("refuses a concurrent body or revision change: %j", async current => {
	const write = mock(async () => {});
	const read = mock(async () => snapshot).mockResolvedValueOnce(snapshot).mockResolvedValueOnce(current);
	await expect(editDescription("acme-app-7", { kind: "append", text: "Reviewed" }, { read, write }, directory())).rejects.toThrow("changed during this edit");
	expect(write).not.toHaveBeenCalled();
});

test("a failed concurrent-change read never writes", async () => {
	const write = mock(async () => {});
	const read = mock(async () => snapshot).mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new Error("quota exhausted"));
	await expect(editDescription("acme-app-7", { kind: "append", text: "Reviewed" }, { read, write }, directory())).rejects.toThrow("Original description preserved");
	expect(write).not.toHaveBeenCalled();
});

test("an explicit clear requires the current original and allowEmpty", async () => {
	const write = mock(async (_body: string) => {});
	await editDescription("acme-app-7", { kind: "replace", original: snapshot.body, body: "", allowEmpty: true }, { read: async () => snapshot, write }, directory());
	expect(write).toHaveBeenCalledWith("");
});

test("a successful no-op does not write", async () => {
	const write = mock(async () => {});
	const result = await editDescription("acme-app-7", { kind: "replace", original: snapshot.body, body: snapshot.body }, { read: async () => snapshot, write }, directory());
	expect(result.changed).toBe(false);
	expect(write).not.toHaveBeenCalled();
});

test("a null REST body is a real empty original, not a failed read", () => {
	expect(descriptionSnapshot({ body: null, updated_at: snapshot.updatedAt })).toEqual({ body: "", updatedAt: snapshot.updatedAt });
	for (const answer of [{}, { body: "" }, { body: 2, updated_at: snapshot.updatedAt }]) expect(() => descriptionSnapshot(answer)).toThrow("complete PR description");
});
