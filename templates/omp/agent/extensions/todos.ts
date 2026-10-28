// The `user_todo` tool: lets an agent read the omp-agents dashboard's Todo list, add a todo for a step outside the
// session that only the user can take, check one off, edit one's title, notes, due day, or section, and delete one.
// A session is told at each prompt which open todo links to it and which open todos it added, so it checks them off
// once done and does not add them twice.
// Changes go to the dashboard's todo inbox, one file each, which the dashboard server applies and deletes, so it
// stays the only writer of todos.json and a todo filed while it is down waits for it.
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { addSection, type Section, sectionNamed } from "./todos/sections";

const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omp-agents");
const TODOS_FILE = join(CONFIG_DIR, "todos.json");
const INBOX_DIR = join(CONFIG_DIR, "todo-inbox");

interface Leaf {
	id: string;
	text: string;
	doneAt?: string | null;
	due?: string | null;
}
interface Todo extends Leaf {
	categoryId?: string | null;
	children?: Leaf[];
	links?: { kind: string; sessionId?: string }[];
	addedBy?: string | null;
}
interface List {
	categories?: Section[];
	todos?: Todo[];
}

const isDone = (todo: Leaf): boolean => (todo.doneAt ?? null) !== null;

/** The open top-level todos that concern session `sessionId`: the one that links to it, such as the one it was started for, and the ones it added. */
function todosOf(list: List, sessionId: string): { linked: Todo | undefined; added: Todo[] } {
	const open = (list.todos ?? []).filter(todo => !isDone(todo));
	const linked = open.find(todo => todo.links?.some(link => link.kind === "session" && link.sessionId === sessionId));
	return { linked, added: open.filter(todo => todo.addedBy === sessionId) };
}

function readList(): List {
	try {
		return JSON.parse(readFileSync(TODOS_FILE, "utf8")) as List;
	} catch {
		return {};
	}
}

/** One line per todo still to do, children indented under their parent. */
function listText(list: List): string {
	const names = new Map((list.categories ?? []).map(({ id, name }) => [id, name]));
	const line = (todo: Leaf, indent: string, category?: string): string =>
		`${indent}- ${todo.text} (id ${todo.id}${category ? `, ${category}` : ""}${todo.due ? `, due ${todo.due}` : ""})`;
	const lines = (list.todos ?? [])
		.filter(todo => !isDone(todo))
		.flatMap(todo => [
			line(todo, "", todo.categoryId ? names.get(todo.categoryId) : undefined),
			...(todo.children ?? []).filter(child => !isDone(child)).map(child => line(child, "  ")),
		]);
	let waiting = 0;
	try {
		waiting = readdirSync(INBOX_DIR).filter(name => name.endsWith(".json")).length;
	} catch {}
	const pending = waiting > 0 ? `\n${waiting} change(s) wait for the dashboard to apply them.` : "";
	return (lines.length > 0 ? lines.join("\n") : "The user's todo list has nothing left to do.") + pending;
}

/** Leaves `change` for the dashboard: written under a name it skips, then renamed, so it never reads half a file. */
function leave(change: Record<string, unknown>): void {
	mkdirSync(INBOX_DIR, { recursive: true });
	const name = `${Date.now()}-${randomUUID()}`;
	const temp = join(INBOX_DIR, `${name}.tmp`);
	writeFileSync(temp, JSON.stringify(change));
	renameSync(temp, join(INBOX_DIR, `${name}.json`));
}

/** Top-level todo or todo under one `id`, from the list or none: a change to an id the list lacks would apply to nothing. */
function findTodo(list: List, id: string): { todo: Leaf; topLevel: boolean } | undefined {
	for (const todo of list.todos ?? []) {
		if (todo.id === id) return { todo, topLevel: true };
		const child = todo.children?.find(leaf => leaf.id === id);
		if (child) return { todo: child, topLevel: false };
	}
	return undefined;
}

const reply = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], isError });

export default function todos(pi: ExtensionAPI) {
	const z = pi.zod;
	const params = z.object({
		action: z
			.enum(["list", "add", "check", "edit", "delete"])
			.describe("list the todos left, add one, check one off, edit one, or delete one"),
		text: z.string().max(2000).optional().describe("add, edit: the todo's title, one line, an action the user takes"),
		notes: z.string().max(100_000).optional().describe("add, edit: markdown notes, such as the PR or command it needs; edit replaces them"),
		due: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional().describe("add, edit: the day it is due, YYYY-MM-DD; edit: empty clears it"),
		section: z
			.string()
			.max(200)
			.optional()
			.describe("add, edit: the name of an existing Todo page section to file it in; omit for none; add: an unknown one files it in none; edit: empty moves it out of its section"),
		id: z.string().max(64).optional().describe("check, edit, delete: the todo's id, from list"),
	});
	pi.registerTool({
		loadMode: "essential",
		name: "user_todo",
		label: "User todo",
		description: [
			"The user's own todo list in the omp-agents dashboard.",
			"Use add only for a step outside this conversation that only the user can take, such as setting up an account, a console, or a credential, running something on their machine, or reviewing a pull request.",
			"Never add a todo to ask for an approval, an answer, or a reply in this session; ask in your reply instead.",
			"Never add your own work items; use your todo tool for those.",
			"When you finish the work a todo asks for, or the user has done the step it names, check it off.",
			"Edit or delete a todo only when the user asks, or to fix or drop one this session added; prefer check over delete for a step that was done.",
			"Sections must already exist; you cannot create, rename, or remove one. An add naming a section that does not exist files the todo in no section.",
		].join(" "),
		parameters: params,
		async execute(_id, raw, _signal, _onUpdate, ctx) {
			const parsed = params.safeParse(raw);
			if (!parsed.success) return reply("Invalid user_todo input.", true);
			const { action, text, notes, due, section, id } = parsed.data;
			const title = text?.replace(/\s+/g, " ").trim();
			const sectionName = section?.trim();
			switch (action) {
				case "list":
					return reply(listText(readList()));
				case "add": {
					if (!title) return reply("add needs text.", true);
					const list = readList();
					const { categoryId, note } = addSection(list.categories, sectionName);
					const sessionId = ctx.sessionManager.getSessionId();
					const same = todosOf(list, sessionId).added.find(todo => todo.text === title);
					if (same) return reply(`This session already added it (id ${same.id}).`);
					const todoId = randomUUID();
					leave({
						op: "add",
						id: todoId,
						parentId: null,
						afterId: null,
						categoryId,
						text: title,
						body: notes ?? "",
						due: due || null,
						addedBy: sessionId,
					});
					return reply(`Added to the user's todo list (id ${todoId}).${note}`);
				}
				case "check": {
					if (!id) return reply("check needs the todo's id.", true);
					leave({ op: "toggle", id, doneAt: new Date().toISOString() });
					return reply(`Checked todo ${id}.`);
				}
				case "edit": {
					if (!id) return reply("edit needs the todo's id.", true);
					if (text !== undefined && !title) return reply("edit cannot clear a todo's title.", true);
					if (text === undefined && notes === undefined && due === undefined && section === undefined)
						return reply("edit needs text, notes, due, or section.", true);
					const list = readList();
					const found = findTodo(list, id);
					if (!found) return reply(`No todo with id ${id} in the list.`, true);
					let categoryId: string | null | undefined;
					if (section !== undefined) {
						if (!found.topLevel) return reply("Only a top-level todo has a section.", true);
						const category = sectionName ? sectionNamed(list.categories, sectionName) : undefined;
						if (category && "error" in category) return reply(category.error, true);
						categoryId = category?.id ?? null;
					}
					if (title) leave({ op: "edit", id, text: title });
					if (notes !== undefined) leave({ op: "edit-body", id, body: notes });
					if (due !== undefined) leave({ op: "set-due", id, due: due || null });
					if (categoryId !== undefined) leave({ op: "categorize", id, categoryId });
					return reply(`Edited todo ${id}.`);
				}
				case "delete": {
					if (!id) return reply("delete needs the todo's id.", true);
					const found = findTodo(readList(), id);
					if (!found) return reply(`No todo with id ${id} in the list.`, true);
					leave({ op: "remove", id });
					return reply(`Deleted todo ${id}: ${found.todo.text}`);
				}
			}
		},
	});
	// Read on every prompt, so a todo linked, added, or checked mid-session shows in the next turn.
	pi.on("before_agent_start", (event, ctx) => {
		const { linked, added } = todosOf(readList(), ctx.sessionManager.getSessionId());
		const notes: string[] = [];
		if (linked)
			notes.push(
				`This session works on the user's todo ${JSON.stringify(linked.text)} (id ${linked.id}). Once you have finished the work it asks for, check it off with the user_todo tool. Leave it open while the work still waits on the user's answer or approval.`,
			);
		const filed = added.filter(todo => todo !== linked);
		if (filed.length > 0)
			notes.push(
				`This session added these todos to the user's list, still open:\n${filed.map(todo => `- ${todo.text} (id ${todo.id})`).join("\n")}\nCheck one off with the user_todo tool once the user has done it or it no longer applies, and do not add it again.`,
			);
		if (notes.length === 0) return;
		return { systemPrompt: [...event.systemPrompt, ...notes] };
	});
}
