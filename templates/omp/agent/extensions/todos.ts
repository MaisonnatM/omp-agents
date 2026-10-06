// The `user_todo` tool: lets an agent read the omp-agents dashboard's Todo list, add a todo for a step only the user
// can take, and check one off; a session that a todo links to is told so, to check it off once its work is done.
// Changes go to the dashboard's todo inbox, one file each, which the dashboard server applies and deletes, so it
// stays the only writer of todos.json and a todo filed while it is down waits for it.
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omp-agents");
const TODOS_FILE = join(CONFIG_DIR, "todos.json");
const INBOX_DIR = join(CONFIG_DIR, "todo-inbox");

interface Leaf {
	id: string;
	text: string;
	doneAt?: string | null;
	done?: boolean;
	due?: string | null;
}
interface Todo extends Leaf {
	categoryId?: string | null;
	children?: Leaf[];
	links?: { kind: string; sessionId?: string }[];
}
interface List {
	categories?: { id: string; name: string }[];
	todos?: Todo[];
}

const isDone = (todo: Leaf): boolean => (todo.doneAt ?? null) !== null || todo.done === true;

/** The open todo that links to session `sessionId`, such as the one it was started for. */
const todoOf = (list: List, sessionId: string): Todo | undefined =>
	list.todos?.find(todo => !isDone(todo) && todo.links?.some(link => link.kind === "session" && link.sessionId === sessionId));

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

export default function todos(pi: ExtensionAPI) {
	const z = pi.zod;
	const params = z.object({
		action: z.enum(["list", "add", "check"]).describe("list the todos left, add one, or check one off"),
		text: z.string().min(1).max(2000).optional().describe("add: the todo's title, one line, an action the user takes"),
		notes: z.string().max(100_000).optional().describe("add: markdown notes, such as the PR or command it needs"),
		due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("add: the day it is due, YYYY-MM-DD"),
		id: z.string().min(1).max(64).optional().describe("check: the todo's id, from list"),
	});
	pi.registerTool({
		loadMode: "essential",
		name: "user_todo",
		label: "User todo",
		description: [
			"The user's own todo list in the omp-agents dashboard.",
			"Use add when you stop on a step only the user can take (approve, review, decide, run on their machine), so it does not stay buried in your reply.",
			"When you finish the work a todo asks for, check it off.",
			"Never add your own work items; use your todo tool for those. You cannot remove or edit todos.",
		].join(" "),
		parameters: params,
		async execute(_id, raw, _signal, _onUpdate, ctx) {
			const parsed = params.safeParse(raw);
			if (!parsed.success) return { content: [{ type: "text", text: "Invalid user_todo input." }], isError: true };
			const { action, text, notes, due, id } = parsed.data;
			switch (action) {
				case "list":
					return { content: [{ type: "text", text: listText(readList()) }] };
				case "add": {
					const title = text?.replace(/\s+/g, " ").trim();
					if (!title) return { content: [{ type: "text", text: "add needs text." }], isError: true };
					const todoId = randomUUID();
					leave({
						op: "add",
						id: todoId,
						parentId: null,
						afterId: null,
						categoryId: null,
						text: title,
						body: notes ?? "",
						due: due ?? null,
						addedBy: ctx.sessionManager.getSessionId(),
					});
					return { content: [{ type: "text", text: `Added to the user's todo list (id ${todoId}).` }] };
				}
				case "check": {
					if (!id) return { content: [{ type: "text", text: "check needs the todo's id." }], isError: true };
					leave({ op: "toggle", id, doneAt: new Date().toISOString() });
					return { content: [{ type: "text", text: `Checked todo ${id}.` }] };
				}
			}
		},
	});
	// Read on every prompt, so a todo linked or checked mid-session shows in the next turn.
	pi.on("before_agent_start", (event, ctx) => {
		const todo = todoOf(readList(), ctx.sessionManager.getSessionId());
		if (!todo) return;
		return {
			systemPrompt: [
				...event.systemPrompt,
				`This session works on the user's todo ${JSON.stringify(todo.text)} (id ${todo.id}). Once you have finished the work it asks for, check it off with the user_todo tool. Leave it open while the work still waits on the user's answer or approval.`,
			],
		};
	});
}
