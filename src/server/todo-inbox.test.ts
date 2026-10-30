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

/** Every directory counts in a Workspace of its own, as outside any linked worktree. */
const asNamed = async (cwd: string): Promise<string> => cwd;

describe("TodoInbox", () => {
	test("applies an agent's adds as Todo, its checks as Done, and its edits and deletions, oldest first, and sets aside an uncheck, another status, a move, a change to the sections, or a file that is not a change", async () => {
		const dir = inboxDir();
		const add = { op: "add", id: "a", parentId: null, afterId: null, categoryId: null, text: "Approve the migration", addedBy: "s1", status: "canceled", priority: 1, assignee: "user" };
		writeFileSync(join(dir, "2-x.json"), JSON.stringify({ op: "toggle", id: "a", doneAt: "2026-10-05T09:00:00.000Z" }));
		writeFileSync(join(dir, "1-x.json"), JSON.stringify(add));
		writeFileSync(join(dir, "3-x.json"), JSON.stringify({ op: "remove", id: "mine" }));
		writeFileSync(join(dir, "4-x.json"), "{not json");
		writeFileSync(join(dir, "5-x.json"), JSON.stringify({ op: "toggle", id: "mine", doneAt: null }));
		writeFileSync(join(dir, "6-x.tmp"), JSON.stringify(add));
		writeFileSync(join(dir, "7-x.json"), JSON.stringify({ op: "set-status", id: "mine", status: "canceled", at: "2026-10-05T09:00:00.000Z" }));
		writeFileSync(join(dir, "8-x.json"), JSON.stringify({ op: "edit", id: "a", text: "Approve the new migration" }));
		writeFileSync(join(dir, "9-x.json"), JSON.stringify({ op: "categorize", id: "a", categoryId: "omp" }));
		writeFileSync(join(dir, "91-x.json"), JSON.stringify({ op: "move", id: "mine", afterId: null, categoryId: null }));
		writeFileSync(join(dir, "92-x.json"), JSON.stringify({ op: "remove-category", id: "omp" }));
		const applied: UserTodoChange[] = [];
		await new TodoInbox(dir, change => applied.push(change), asNamed).drain();
		expect(applied.map(change => change.op)).toEqual(["add", "set-status", "remove", "edit", "categorize"]);
		expect(applied[0]).toMatchObject({ text: "Approve the migration", addedBy: "s1", status: "todo", priority: 0, assignee: null });
		expect(applied[1]).toEqual({ op: "set-status", id: "a", status: "done", at: "2026-10-05T09:00:00.000Z" });
		expect(readdirSync(dir).sort()).toEqual(["4-x.json.invalid", "5-x.json.invalid", "6-x.tmp", "7-x.json.invalid", "91-x.json.invalid", "92-x.json.invalid"]);
	});

	test("a directory that does not exist drains nothing", async () => {
		const dir = join(inboxDir(), "gone");
		await new TodoInbox(
			dir,
			() => {
				throw new Error("nothing to apply");
			},
			asNamed,
		).drain();
		expect(existsSync(dir)).toBe(false);
	});

	test("a server that does not own the unattended work leaves the changes for the one that does", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "1-x.json"), JSON.stringify({ op: "add", id: "a", parentId: null, afterId: null, categoryId: null, text: "Approve", addedBy: "s1" }));
		let owns = false;
		const applied: UserTodoChange[] = [];
		const inbox = new TodoInbox(dir, change => applied.push(change), asNamed, { active: () => owns });
		await inbox.drain();
		expect(applied).toEqual([]);
		expect(readdirSync(dir)).toEqual(["1-x.json"]);
		owns = true;
		await inbox.drain();
		expect(applied).toHaveLength(1);
		expect(readdirSync(dir)).toEqual([]);
	});

	test("a todo's Workspace is the one its directory counts in, and a change after it waits for it, so an edit never reaches the list before its add", async () => {
		const dir = inboxDir();
		writeFileSync(join(dir, "1-x.json"), JSON.stringify({ op: "add", id: "a", parentId: null, afterId: null, categoryId: null, workspace: "/code/app-wt/fix", text: "Approve", addedBy: "s1" }));
		writeFileSync(join(dir, "2-x.json"), JSON.stringify({ op: "edit", id: "a", text: "Approve it" }));
		writeFileSync(join(dir, "3-x.json"), JSON.stringify({ op: "set-workspace", id: "a", workspace: "/code/site" }));
		writeFileSync(join(dir, "4-x.json"), JSON.stringify({ op: "set-workspace", id: "a", workspace: null }));
		// Git answers only once the test lets it, so the add's Workspace is still pending while the drain hands over the rest.
		const { promise: git, resolve: answer } = Promise.withResolvers<void>();
		const checkoutOf = async (cwd: string): Promise<string> => {
			await git;
			return cwd === "/code/app-wt/fix" ? "/code/app" : cwd;
		};
		const applied: UserTodoChange[] = [];
		const drained = new TodoInbox(dir, change => applied.push(change), checkoutOf).drain();
		answer();
		await drained;
		expect(applied).toEqual([
			expect.objectContaining({ op: "add", id: "a", workspace: "/code/app" }),
			{ op: "edit", id: "a", text: "Approve it" },
			{ op: "set-workspace", id: "a", workspace: "/code/site" },
			{ op: "set-workspace", id: "a", workspace: null },
		]);
		expect(readdirSync(dir)).toEqual([]);
	});
});
