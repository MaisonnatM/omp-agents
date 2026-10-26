// The `user_note` tool: lets an agent list and read the user's notes on the omp-agents dashboard's Notes page, add
// one, and append to one. Changes go to the dashboard's note inbox, one file each, which the dashboard server applies
// and deletes, so it stays the only writer of notes.json and a note added while it is down waits for it.
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omp-agents");
const NOTES_FILE = join(CONFIG_DIR, "notes.json");
const TODOS_FILE = join(CONFIG_DIR, "todos.json");
const INBOX_DIR = join(CONFIG_DIR, "note-inbox");

// The shape of src/user-notes-shared.ts, which this file cannot import: change it with that one.
interface Note {
	id: string;
	title: string;
	body?: string;
	todoId?: string | null;
	addedBy?: string | null;
	createdAt: string;
	updatedAt?: string;
}
type Change = { op: "add"; note: Note } | { op: "append"; id: string; text: string; at: string };

function readJson(path: string): unknown {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

/** The changes the inbox holds that the dashboard has not applied yet, oldest first. */
function waiting(): Change[] {
	let names: string[] = [];
	try {
		names = readdirSync(INBOX_DIR).filter(name => name.endsWith(".json")).sort();
	} catch {}
	return names.flatMap(name => {
		const change = readJson(join(INBOX_DIR, name)) as Change | null;
		return change ? [change] : [];
	});
}

/** Pending changes participate in reads so agents see their writes while the dashboard is stopped. */
function readNotes(): Note[] {
	const notes = new Map(((readJson(NOTES_FILE) as { notes?: Note[] } | null)?.notes ?? []).map(note => [note.id, note]));
	for (const change of waiting()) {
		if (change.op === "add" && !notes.has(change.note.id)) notes.set(change.note.id, change.note);
		if (change.op === "append") {
			const note = notes.get(change.id);
			if (note) notes.set(note.id, { ...note, body: note.body ? `${note.body}\n\n${change.text}` : change.text, updatedAt: change.at });
		}
	}
	return [...notes.values()].sort((a, b) => Date.parse(b.updatedAt ?? b.createdAt) - Date.parse(a.updatedAt ?? a.createdAt));
}

/** The title of each top-level todo, done and archived ones too, by id. */
function todoTitles(): Map<string, string> {
	const list = readJson(TODOS_FILE) as { todos?: { id: string; text: string }[]; archive?: { id: string; text: string }[] } | null;
	return new Map([...(list?.todos ?? []), ...(list?.archive ?? [])].map(todo => [todo.id, todo.text]));
}

const untitled = (note: Note): string => note.title || "Untitled";

/** One line per note holding every word of `query`, in any case, the most recently updated first. */
function listText(query: string | undefined): string {
	const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
	const titles = todoTitles();
	const lines = readNotes()
		.filter(note => {
			const text = `${note.title}\n${note.body ?? ""}`.toLowerCase();
			return words.every(word => text.includes(word));
		})
		.map(note => {
			const day = new Date(note.updatedAt ?? note.createdAt).toLocaleDateString("en-CA");
			const todo = note.todoId ? titles.get(note.todoId) : undefined;
			return `- ${untitled(note)} (id ${note.id}, updated ${day}${todo ? `, todo ${JSON.stringify(todo)}` : ""})`;
		});
	if (lines.length > 0) return lines.join("\n");
	return words.length > 0 ? "No note holds every word of the query." : "The user has no notes.";
}

/** Leaves `change` for the dashboard: written under a name it skips, then renamed, so it never reads half a file. */
function leave(change: Change): void {
	mkdirSync(INBOX_DIR, { recursive: true });
	const name = `${Date.now()}-${randomUUID()}`;
	const temp = join(INBOX_DIR, `${name}.tmp`);
	writeFileSync(temp, JSON.stringify(change));
	renameSync(temp, join(INBOX_DIR, `${name}.json`));
}

const reply = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], isError });

export default function notes(pi: ExtensionAPI) {
	const z = pi.zod;
	const params = z.object({
		action: z.enum(["list", "read", "add", "append"]).describe("list the notes, read one, add one, or append to one"),
		query: z.string().max(200).optional().describe("list: only the notes holding every one of these words"),
		id: z.string().max(64).optional().describe("read, append: the note's id, from list"),
		title: z.string().max(200).optional().describe("add: the note's title, one line"),
		body: z.string().max(100_000).optional().describe("add: the note's markdown content"),
		todo_id: z.string().max(64).optional().describe("add: the id of the top-level todo the note belongs to, from user_todo list"),
		text: z.string().max(100_000).optional().describe("append: markdown added as a new paragraph at the note's end"),
	});
	pi.registerTool({
		loadMode: "essential",
		name: "user_note",
		label: "User note",
		description: [
			"The user's own Markdown notes on the omp-agents dashboard's Notes page.",
			"Add one when the user asks you to note or save something, or when a finding should outlive this session; append to one to add to it.",
			"Never use it for a step the user must take; that is user_todo.",
			"You cannot edit what a note already says or remove one.",
		].join(" "),
		parameters: params,
		async execute(_id, raw, _signal, _onUpdate, ctx) {
			const parsed = params.safeParse(raw);
			if (!parsed.success) return reply("Invalid user_note input.", true);
			// A model often sends an empty string for a parameter it means to leave out.
			const { action, query, id, title, body, todo_id: todoId, text } = Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [key, value || undefined])) as typeof parsed.data;
			switch (action) {
				case "list":
					return reply(listText(query));
				case "read": {
					const note = readNotes().find(entry => entry.id === id);
					return note ? reply(`${untitled(note)}\n\n${note.body ?? ""}`) : reply(`No note has id ${id ?? "(none given)"}.`, true);
				}
				case "add": {
					const line = title?.replace(/\s+/g, " ").trim();
					if (!line) return reply("add needs a title.", true);
					if (todoId && !todoTitles().has(todoId)) return reply(`No todo has id ${todoId}.`, true);
					const sessionId = ctx.sessionManager.getSessionId();
					const same = readNotes().find(note => note.addedBy === sessionId && note.title === line);
					if (same) return reply(`This session already added it (id ${same.id}); append to it instead.`);
					const at = new Date().toISOString();
					const note: Note = { id: randomUUID(), title: line, body: body ?? "", todoId: todoId ?? null, addedBy: sessionId, createdAt: at, updatedAt: at };
					leave({ op: "add", note });
					return reply(`Added to the user's notes (id ${note.id}).`);
				}
				case "append": {
					if (!text?.trim()) return reply("append needs text.", true);
					const note = readNotes().find(entry => entry.id === id);
					if (!note) return reply(`No note has id ${id ?? "(none given)"}.`, true);
					leave({ op: "append", id: note.id, text, at: new Date().toISOString() });
					return reply(`Appended to ${JSON.stringify(untitled(note))}.`);
				}
			}
		},
	});
}
