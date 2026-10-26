// The `user_note` tool: lets an agent list and read the user's notes on the omp-agents dashboard's Notes page, add
// one, and append to one. Changes go to the dashboard's note inbox, one file each, which the dashboard server applies
// and deletes, so it stays the only writer of notes.json and a note added while it is down waits for it.
// A note added from a project's session, or from a `task` subagent under one, belongs to that project by default.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omp-agents");
const NOTES_FILE = join(CONFIG_DIR, "notes.json");
const TODOS_FILE = join(CONFIG_DIR, "todos.json");
const PROJECTS_FILE = join(CONFIG_DIR, "projects.json");
const INBOX_DIR = join(CONFIG_DIR, "note-inbox");

// The shape of src/user-notes-shared.ts, which this file cannot import: change it with that one.
interface Note {
	id: string;
	title: string;
	body?: string;
	todoId?: string | null;
	projectId?: string | null;
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

// The subset of src/shared/projects.ts this reads; change both together.
interface Project {
	id: string;
	name: string;
	coordinator?: { sessionId: string };
	workers?: { sessionId: string }[];
}

function readProjects(): Project[] {
	const list = readJson(PROJECTS_FILE) as { projects?: Project[] } | null;
	return Array.isArray(list?.projects) ? list.projects : [];
}

// A copy of `ancestorSessionIds` in projects.ts, since an installed projects.ts may predate it; change both together.
function ancestorSessionIds(sessionFile: string): string[] {
	const ids: string[] = [];
	let current = resolve(sessionFile);
	for (let depth = 0; depth < 8; depth++) {
		const parent = `${dirname(current)}.jsonl`;
		if (!existsSync(parent)) break;
		const name = basename(parent, ".jsonl");
		ids.push(name.slice(name.indexOf("_") + 1));
		current = parent;
	}
	return ids;
}

type SessionContext = { sessionManager: { getSessionId(): string; getSessionFile?(): string | undefined } };

/** The project the session coordinates or works in, or for a `task` subagent its nearest ancestor's, as `roleOf` in projects.ts finds it. */
function sessionProject(projects: readonly Project[], ctx: SessionContext): Project | undefined {
	const owner = (sessionId: string) => projects.find(project => project.coordinator?.sessionId === sessionId || project.workers?.some(worker => worker.sessionId === sessionId));
	const own = owner(ctx.sessionManager.getSessionId());
	if (own) return own;
	const file = ctx.sessionManager.getSessionFile?.();
	for (const id of file ? ancestorSessionIds(file) : []) {
		const project = owner(id);
		if (project) return project;
	}
	return undefined;
}

const untitled = (note: Note): string => note.title || "Untitled";

/** One line per note holding every word of `query`, in any case, and in project `projectId` when given, the most recently updated first. */
function listText(query: string | undefined, projectId: string | undefined, projects: readonly Project[]): string {
	const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
	const titles = todoTitles();
	const names = new Map(projects.map(project => [project.id, project.name]));
	const lines = readNotes()
		.filter(note => {
			const text = `${note.title}\n${note.body ?? ""}`.toLowerCase();
			return (!projectId || note.projectId === projectId) && words.every(word => text.includes(word));
		})
		.map(note => {
			const day = new Date(note.updatedAt ?? note.createdAt).toLocaleDateString("en-CA");
			const todo = note.todoId ? titles.get(note.todoId) : undefined;
			const project = note.projectId ? `, project ${note.projectId} ${JSON.stringify(names.get(note.projectId) ?? "Deleted project")}` : "";
			return `- ${untitled(note)} (id ${note.id}, updated ${day}${todo ? `, todo ${JSON.stringify(todo)}` : ""}${project})`;
		});
	if (lines.length > 0) return lines.join("\n");
	if (projectId) return `No note of project ${JSON.stringify(names.get(projectId))}${words.length > 0 ? " holds every word of the query" : " exists"}.`;
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
		project_id: z.string().max(64).optional().describe("add: the id of the project the note belongs to, as list shows it; defaults to this session's project. list: only that project's notes"),
		text: z.string().max(100_000).optional().describe("append: markdown added as a new paragraph at the note's end"),
	});
	pi.registerTool({
		loadMode: "essential",
		name: "user_note",
		label: "User note",
		description: [
			"The user's own Markdown notes on the omp-agents dashboard's Notes page.",
			"Add one when the user asks you to note or save something, or when a finding should outlive this session; append to one to add to it.",
			"A note added from a dashboard project's session belongs to that project unless project_id names another.",
			"Never use it for a step the user must take; that is user_todo.",
			"You cannot edit what a note already says or remove one.",
		].join(" "),
		parameters: params,
		async execute(_id, raw, _signal, _onUpdate, ctx) {
			const parsed = params.safeParse(raw);
			if (!parsed.success) return reply("Invalid user_note input.", true);
			// A model often sends an empty string for a parameter it means to leave out.
			const { action, query, id, title, body, todo_id: todoId, project_id: projectId, text } = Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [key, value || undefined])) as typeof parsed.data;
			const projects = readProjects();
			if (projectId && !projects.some(project => project.id === projectId)) return reply(`No project has id ${projectId}.`, true);
			switch (action) {
				case "list":
					return reply(listText(query, projectId, projects));
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
					const project = projects.find(entry => entry.id === projectId) ?? sessionProject(projects, ctx);
					const at = new Date().toISOString();
					const note: Note = { id: randomUUID(), title: line, body: body ?? "", todoId: todoId ?? null, projectId: project?.id ?? null, addedBy: sessionId, createdAt: at, updatedAt: at };
					leave({ op: "add", note });
					return reply(`Added to the user's notes (id ${note.id}${project ? `, project ${JSON.stringify(project.name)}` : ""}).`);
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
