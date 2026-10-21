import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalJson, mergeFile, portablePath, localPath, portableText, readLocal, SettingsSync, sourceControlStore } from "./settings-sync";
import { neverSynced, parseSyncSettings, SYNC_ITEMS } from "./shared/settings-sync";
import { SourceControl } from "./source-control";
import { runChecked } from "./proc";

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

describe("what syncs", () => {
	test("never syncs credentials, databases, sessions, locks, or the dashboard's machine files, and every item's own path is allowed", () => {
		for (const path of ["omp/agent.db", "omp/agent.db-wal", "omp/mcp.json", "omp/secrets.yml", "omp/secret-placeholder.key", "omp/sessions/a/b.jsonl", "omp/config.yml.lock", "omp/skills/x/.env", "omp/skills/x/id_ed25519", "omp/skills/x/node_modules/y.js", "dashboard/token", "dashboard/interrupted.json", "dashboard/merges.json", "dashboard/server.lock"]) {
			expect([path, neverSynced(path)]).toEqual([path, true]);
		}
		for (const path of ["omp/config.yml", "omp/AGENTS.md", "omp/skills/x/SKILL.md", "dashboard/source-control.json"]) expect([path, neverSynced(path)]).toEqual([path, false]);
		expect(SYNC_ITEMS.filter(item => neverSynced(item.path))).toEqual([]);
	});

	test("reads only the portable files of omp's directory, and leaves links, binaries, and files holding a token on this machine", async () => {
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
		const { files, skipped } = await readLocal(SYNC_ITEMS, { omp, home: "/Users/nobody", stores: { "source-control": { read: () => settings, accepts: () => true, write: () => {} } } });
		expect(Object.fromEntries(files)).toEqual({
			"omp/config.yml": text("theme: dark\n"),
			"omp/AGENTS.md": text("Be brief.\n"),
			"omp/skills/alpha/SKILL.md": text("# Alpha\n"),
			"omp/skills/alpha/run.sh": { text: "#!/bin/sh\n", executable: true },
			"dashboard/source-control.json": text('{\n\t"cleanUp": true,\n\t"on": false,\n\t"repos": {}\n}\n'),
		});
		expect(skipped.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
			{ path: "omp/skills/alpha/logo.png", reason: "binary" },
			{ path: "omp/skills/beta/SKILL.md", reason: "credential" },
			{ path: "omp/skills/gamma", reason: "link" },
		]);
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

/** One machine: its home, omp's directory, the dashboard's files, and its settings sync on `remote`. */
function machine(root: string, remote: string) {
	const home = join(root, "home");
	const omp = join(home, ".omp", "agent");
	mkdirSync(omp, { recursive: true });
	const sourceControl = new SourceControl(join(root, "config", "source-control.json"));
	const sync = new SettingsSync(join(root, "config", "settings-sync.json"), join(root, "data", "settings-sync.git"), { omp, home, stores: { "source-control": sourceControlStore(sourceControl, home) } });
	sync.configure({ remote, branch: "main", excluded: [] });
	return { home, omp, sourceControl, sync };
}

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
		expect((await a.sync.sync()).last).toMatchObject({ kind: "synced", received: [], sent: ["dashboard/source-control.json", "omp/AGENTS.md", "omp/skills/alpha/SKILL.md"] });
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
		const root = scratch();
		const remote = join(root, "remote.git");
		await runChecked(["git", "init", "--bare", "--quiet", remote]);
		const a = machine(join(root, "a"), remote);
		const b = machine(join(root, "b"), remote);
		put(join(a.omp, "AGENTS.md"), "From A.\n");
		await a.sync.sync();
		put(join(b.omp, "AGENTS.md"), "From B.\n");
		b.sync.configure({ remote, branch: "main", excluded: ["omp-agents-md"] });
		expect((await b.sync.sync()).last).toMatchObject({ kind: "synced", received: [], sent: [] });
		expect(readFileSync(join(b.omp, "AGENTS.md"), "utf8")).toBe("From B.\n");
		expect(await runChecked(["git", "--git-dir", remote, "show", "main:omp/AGENTS.md"])).toBe("From A.\n");
	});

	test("reports a remote it cannot reach as a failed sync", async () => {
		const root = scratch();
		const a = machine(join(root, "a"), join(root, "missing.git"));
		const last = (await a.sync.sync()).last;
		expect(last?.kind).toBe("failed");
	});
});
