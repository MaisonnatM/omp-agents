import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { dirs } from "../omp/modules";
import { PLAIN_LAUNCH } from "../omp/rpc";
import { PrivateSessions } from "./private-sessions";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	rmSync(dirs.getHistoryDbPath(), { force: true });
	rmSync(dirs.getCustomSessionFilesDir(), { recursive: true, force: true });
});

function writeSession(file: string, sessionId: string): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-11-03T10:00:00.000Z", cwd: "/work" })}\n`);
}

/** omp's marker for session file `file`, written outside its sessions root, named by a short hash of its path that another file can share. */
function writeMarker(file: string, named = file): string {
	const marker = join(dirs.getCustomSessionFilesDir(), dirs.hashPath(file));
	mkdirSync(dirname(marker), { recursive: true });
	writeFileSync(marker, named);
	return marker;
}

/** omp's `history.db`, as its history and session index write it, with one prompt, title, and recap for each session in `prompts`. */
function seedHistory(prompts: Record<string, string>): void {
	const db = new Database(dirs.getHistoryDbPath());
	db.run(`
CREATE TABLE history (id INTEGER PRIMARY KEY AUTOINCREMENT, prompt TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL DEFAULT 0, cwd TEXT, session_id TEXT, use_count INTEGER NOT NULL DEFAULT 1);
CREATE VIRTUAL TABLE history_fts USING fts5(prompt, content='history', content_rowid='id');
CREATE TRIGGER history_ai AFTER INSERT ON history BEGIN INSERT INTO history_fts(rowid, prompt) VALUES (new.id, new.prompt); END;
CREATE TABLE session_titles (session_id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE session_recaps (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, cwd TEXT NOT NULL, recap TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0);
`);
	for (const [sessionId, prompt] of Object.entries(prompts)) {
		db.run("INSERT INTO history (prompt, cwd, session_id) VALUES (?, '/work', ?)", [prompt, sessionId]);
		db.run("INSERT INTO session_titles (session_id, title) VALUES (?, ?)", [sessionId, `Title of ${sessionId}`]);
		db.run("INSERT INTO session_recaps (session_id, cwd, recap) VALUES (?, '/work', ?)", [sessionId, `Recap of ${sessionId}`]);
	}
	db.close();
}

/** The sessions `history.db` still holds rows of, per table, and the rows its full-text index still finds for `word`. */
function historyOf(word: string) {
	const db = new Database(dirs.getHistoryDbPath(), { readonly: true });
	try {
		const ids = (table: string) => db.query<{ session_id: string }, []>(`SELECT session_id FROM ${table} ORDER BY session_id`).all().map(row => row.session_id);
		return {
			history: ids("history"),
			titles: ids("session_titles"),
			recaps: ids("session_recaps"),
			matches: db.query<{ rowid: number }, [string]>("SELECT rowid FROM history_fts WHERE history_fts MATCH ?").all(word).length,
		};
	} finally {
		db.close();
	}
}

/** Private sessions under a fresh root, and the session ids each purge unpinned. */
function setup() {
	const root = mkdtempSync(join(tmpdir(), "omp-agents-private-"));
	roots.push(root);
	const unpinned: string[][] = [];
	const sessions = new PrivateSessions({ root, unpin: ids => void unpinned.push(ids) });
	/** Launches private session `instanceId` in `/work` and writes its file and its subagent's where omp's `--session-dir` puts them. */
	const launched = async (instanceId: string, sessionId: string) => {
		const { rpc: { args } } = await sessions.launch(instanceId, "/work", PLAIN_LAUNCH);
		const sessionDir = args[args.indexOf("--session-dir") + 1]!;
		const main = join(sessionDir, `2026-11-03T10-00-00-000Z_${sessionId}.jsonl`);
		writeSession(main, sessionId);
		writeSession(join(sessionDir, `2026-11-03T10-00-00-000Z_${sessionId}`, "0-Explore.jsonl"), `${sessionId}-sub`);
		return main;
	};
	return { root, sessions, unpinned, launched };
}

test("purging a private session deletes its files, its subagents', and omp's history, titles, recaps, search index, and marker of them, and nothing of another session", async () => {
	const { sessions, unpinned, launched } = setup();
	const main = await launched("i1", "s-private");
	seedHistory({ "s-private": "book the clinic appointment", "s-private-sub": "find the clinic address", "s-other": "fix the flaky build" });
	const privateMarker = writeMarker(main);
	const sharedMarker = writeMarker(join(main.slice(0, -".jsonl".length), "0-Explore.jsonl"), "/elsewhere/s-other.jsonl");
	expect(sessions.has("i1")).toBe(true);
	expect(sessions.holds(main)).toBe(true);

	await sessions.purge("i1");

	expect(existsSync(main)).toBe(false);
	expect(sessions.has("i1")).toBe(false);
	expect(historyOf("clinic")).toEqual({ history: ["s-other"], titles: ["s-other"], recaps: ["s-other"], matches: 0 });
	expect(historyOf("build").matches).toBe(1);
	expect(existsSync(privateMarker)).toBe(false);
	expect(readFileSync(sharedMarker, "utf8")).toBe("/elsewhere/s-other.jsonl");
	expect(unpinned.map(ids => ids.toSorted())).toEqual([["s-private", "s-private-sub"]]);
});

test("a purge cut short leaves the session private with its files, the next one finishes it, and one after that changes nothing", async () => {
	const { sessions, launched } = setup();
	const main = await launched("i1", "s-private");
	writeFileSync(dirs.getHistoryDbPath(), "not a database\n".repeat(100));

	await expect(sessions.purge("i1")).rejects.toThrow("file is not a database");
	expect(sessions.has("i1")).toBe(true);
	expect(existsSync(main)).toBe(true);

	rmSync(dirs.getHistoryDbPath());
	seedHistory({ "s-private": "book the clinic appointment", "s-other": "fix the flaky build" });
	await sessions.purge("i1");
	expect(sessions.has("i1")).toBe(false);
	expect(existsSync(main)).toBe(false);
	expect(historyOf("clinic")).toEqual({ history: ["s-other"], titles: ["s-other"], recaps: ["s-other"], matches: 0 });

	await sessions.purge("i1");
	expect(historyOf("build")).toEqual({ history: ["s-other"], titles: ["s-other"], recaps: ["s-other"], matches: 1 });
});

test("two purges of one session at once, as a failed start's and its omp's exit, both finish and leave nothing", async () => {
	const { sessions, unpinned, launched } = setup();
	const main = await launched("i1", "s-private");
	seedHistory({ "s-private": "book the clinic appointment", "s-other": "fix the flaky build" });

	await Promise.all([sessions.purge("i1"), sessions.purge("i1")]);

	expect(sessions.has("i1")).toBe(false);
	expect(existsSync(main)).toBe(false);
	expect(historyOf("clinic")).toEqual({ history: ["s-other"], titles: ["s-other"], recaps: ["s-other"], matches: 0 });
	expect(unpinned).toHaveLength(1);
});

test("the sweep purges the private sessions whose omp no longer runs and keeps the running ones", async () => {
	const { root, sessions, launched } = setup();
	const live = await launched("i-live", "s-live");
	const gone = await launched("i-gone", "s-gone");
	seedHistory({ "s-live": "plan the weekly meals", "s-gone": "book the clinic appointment" });

	await sessions.sweep(instanceId => instanceId === "i-live");

	expect(sessions.has("i-live")).toBe(true);
	expect(existsSync(live)).toBe(true);
	expect(sessions.has("i-gone")).toBe(false);
	expect(existsSync(gone)).toBe(false);
	expect(historyOf("clinic")).toEqual({ history: ["s-live"], titles: ["s-live"], recaps: ["s-live"], matches: 0 });

	rmSync(root, { recursive: true });
	await expect(sessions.sweep(() => false)).resolves.toBeUndefined();
});
