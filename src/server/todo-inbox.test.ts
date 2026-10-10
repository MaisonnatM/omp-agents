import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserTodoChange } from "../user-todos-shared";
import { TodoInbox } from "./todo-inbox";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function inboxDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-agents-inbox-"));
	dirs.push(dir);
	mkdirSync(join(dir, "todo-inbox"));
	return join(dir, "todo-inbox");
}

describe("TodoInbox", () => {
	test("applies an agent's adds as Todo and its checks as Done, oldest first, and sets aside an uncheck, a removal, or a file that is not a change", async () => {
		const dir = inboxDir();
		const add = { op: "add", id: "a", parentId: null, afterId: null, categoryId: null, text: "Approve the migration", addedBy: "s1", status: "canceled", priority: 1, assignee: "user" };
		writeFileSync(join(dir, "2-x.json"), JSON.stringify({ op: "toggle", id: "a", doneAt: "2026-10-05T09:00:00.000Z" }));
		writeFileSync(join(dir, "1-x.json"), JSON.stringify(add));
		writeFileSync(join(dir, "3-x.json"), JSON.stringify({ op: "remove", id: "mine" }));
		writeFileSync(join(dir, "4-x.json"), "{not json");
		writeFileSync(join(dir, "5-x.json"), JSON.stringify({ op: "toggle", id: "mine", doneAt: null }));
		writeFileSync(join(dir, "6-x.tmp"), JSON.stringify(add));
		writeFileSync(join(dir, "7-x.json"), JSON.stringify({ op: "set-status", id: "mine", status: "canceled", at: "2026-10-05T09:00:00.000Z" }));
		const applied: UserTodoChange[] = [];
		await new TodoInbox(dir, change => applied.push(change)).drain();
		expect(applied.map(change => change.op)).toEqual(["add", "set-status"]);
		expect(applied[0]).toMatchObject({ text: "Approve the migration", addedBy: "s1", status: "todo", priority: 0, assignee: null });
		expect(applied[1]).toEqual({ op: "set-status", id: "a", status: "done", at: "2026-10-05T09:00:00.000Z" });
		expect(readdirSync(dir).sort()).toEqual(["3-x.json.invalid", "4-x.json.invalid", "5-x.json.invalid", "6-x.tmp", "7-x.json.invalid"]);
	});

	test("a directory that does not exist drains nothing", async () => {
		const dir = join(inboxDir(), "gone");
		await new TodoInbox(dir, () => {
			throw new Error("nothing to apply");
		}).drain();
		expect(existsSync(dir)).toBe(false);
	});

	test("a server that does not own the unattended work leaves the changes for the one that does", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "1-x.json"), JSON.stringify({ op: "add", id: "a", parentId: null, afterId: null, categoryId: null, text: "Approve", addedBy: "s1" }));
		let owns = false;
		const applied: UserTodoChange[] = [];
		const inbox = new TodoInbox(dir, change => applied.push(change), { active: () => owns });
		await inbox.drain();
		expect(applied).toEqual([]);
		expect(readdirSync(dir)).toEqual(["1-x.json"]);
		owns = true;
		await inbox.drain();
		expect(applied).toHaveLength(1);
		expect(readdirSync(dir)).toEqual([]);
	});
});
