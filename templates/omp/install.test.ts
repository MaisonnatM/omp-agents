import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { blobId, INSTALLED_RECORD, type InstalledRecord, overlayFiles, planKitFiles, planMcpServers, planSettings, readInstalledRecord, settingsOf, writeMcpServers } from "./install";

const known = new Set(["modelRoles", "retry.fallbackChains", "task.isolation.merge"]);

describe("settingsOf", () => {
	test("walks mappings down to omp's setting keys, keeping record settings whole", () => {
		const template = { modelRoles: { default: "a/b" }, retry: { fallbackChains: { "a/b.1": ["c/d"] } }, task: { isolation: { merge: "patch" } } };
		expect(settingsOf(template, known)).toEqual([
			["modelRoles", { default: "a/b" }],
			["retry.fallbackChains", { "a/b.1": ["c/d"] }],
			["task.isolation.merge", "patch"],
		]);
	});

	test("refuses a key omp does not know", () => {
		expect(() => settingsOf({ task: { isolation: { merj: "patch" } } }, known)).toThrow("omp has no setting task.isolation.merj");
	});
});

describe("overlayFiles", () => {
	test("a later layer replaces AGENTS.md and adds the git workflow", () => {
		const files = overlayFiles([
			[
				{ rel: "AGENTS.md", text: "public" },
				{ rel: "docs/model-routing.md", text: "models" },
			],
			[
				{ rel: "AGENTS.md", text: "maintainer" },
				{ rel: "docs/git-workflow.md", text: "graphite" },
			],
		]);
		expect(files).toEqual([
			{ rel: "AGENTS.md", text: "maintainer" },
			{ rel: "docs/git-workflow.md", text: "graphite" },
			{ rel: "docs/model-routing.md", text: "models" },
		]);
	});

	test("one layer keeps only the files it was given", () => {
		expect(overlayFiles([[{ rel: "AGENTS.md", text: "public" }]])).toEqual([{ rel: "AGENTS.md", text: "public" }]);
	});
});

describe("planSettings", () => {
	const settings: [string, unknown][] = [
		["modelRoles", { default: "a/b" }],
		["task.isolation.merge", "patch"],
	];

	test("adds what you have not set, leaves what already matches, and keeps what you chose", () => {
		const user = { modelRoles: { default: "x/y" }, task: { isolation: { merge: "patch" } } };
		expect(planSettings(settings, user, false).map(s => s.action)).toEqual(["keep", "same"]);
		expect(planSettings(settings, {}, false).map(s => s.action)).toEqual(["create", "create"]);
	});

	test("--force overwrites what you chose", () => {
		expect(planSettings(settings, { modelRoles: { default: "x/y" } }, true).map(s => s.action)).toEqual(["update", "create"]);
	});
});

const scratches: string[] = [];
afterAll(() => {
	for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-kit-"));
	scratches.push(dir);
	return dir;
}

function put(root: string, files: Record<string, string>): void {
	for (const [rel, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, rel)), { recursive: true });
		writeFileSync(join(root, rel), text);
	}
}

function record(agentDir: string, value: InstalledRecord): void {
	writeFileSync(join(agentDir, INSTALLED_RECORD), JSON.stringify(value));
}

function git(dir: string, ...args: string[]): void {
	const proc = Bun.spawnSync(["git", "-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { stderr: "pipe" });
	if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
}

const actions = (plan: { files: { rel: string; action: string }[] }) => Object.fromEntries(plan.files.map(file => [file.rel, file.action]));

describe("planKitFiles", () => {
	test("updates an outdated file the last install wrote, and keeps one you edited since", () => {
		const kit = scratch();
		const agentDir = scratch();
		put(kit, { "agent/extensions/ship.ts": "v2", "agent/docs/routing.md": "v2", "agent/new.md": "new" });
		put(agentDir, { "extensions/ship.ts": "v1", "docs/routing.md": "v1, with my edit" });
		record(agentDir, { maintainer: false, files: { "extensions/ship.ts": blobId("v1"), "docs/routing.md": blobId("v1") } });
		expect(actions(planKitFiles(kit, agentDir))).toEqual({ "docs/routing.md": "keep", "extensions/ship.ts": "update", "new.md": "create" });
		expect(actions(planKitFiles(kit, agentDir, { force: true }))["docs/routing.md"]).toBe("update");
	});

	test("without a record, keeps a file that matches no version of the kit", () => {
		const kit = scratch();
		const agentDir = scratch();
		put(kit, { "agent/a.md": "v2" });
		put(agentDir, { "a.md": "v1" });
		expect(actions(planKitFiles(kit, agentDir))).toEqual({ "a.md": "keep" });
	});

	test("updates a file that matches a version the kit's git history holds, and keeps one that matches none", () => {
		const repo = scratch();
		const kit = join(repo, "templates", "omp");
		git(repo, "init", "--quiet");
		put(kit, { "agent/a.md": "v1", "agent/b.md": "v1", "maintainer/c.md": "v1" });
		git(repo, "add", ".");
		git(repo, "commit", "--quiet", "-m", "v1");
		put(kit, { "agent/a.md": "v2", "agent/b.md": "v2", "maintainer/c.md": "v2" });
		git(repo, "commit", "--quiet", "-am", "v2");
		const agentDir = scratch();
		put(agentDir, { "a.md": "v1", "b.md": "v1 edited", "c.md": "v1" });
		expect(actions(planKitFiles(kit, agentDir, { maintainer: true }))).toEqual({ "a.md": "update", "b.md": "keep", "c.md": "update" });
	});

	test("copies maintainer/ when the last install did", () => {
		const kit = scratch();
		const agentDir = scratch();
		put(kit, { "agent/AGENTS.md": "public", "maintainer/AGENTS.md": "maintainer" });
		put(agentDir, { "AGENTS.md": "maintainer" });
		record(agentDir, { maintainer: true, files: { "AGENTS.md": blobId("maintainer") } });
		expect(planKitFiles(kit, agentDir)).toMatchObject({ maintainer: true, files: [{ rel: "AGENTS.md", action: "same" }] });
	});

	test("removes a file the kit's history held and no longer ships, keeps one you edited even with --force, and leaves one maintainer/ still ships", () => {
		const repo = scratch();
		const kit = join(repo, "templates", "omp");
		git(repo, "init", "--quiet");
		put(kit, { "agent/a.md": "v1", "agent/old.md": "v1", "agent/edited.md": "v1", "maintainer/m.md": "v1" });
		git(repo, "add", ".");
		git(repo, "commit", "--quiet", "-m", "v1");
		git(repo, "rm", "--quiet", "templates/omp/agent/old.md", "templates/omp/agent/edited.md");
		git(repo, "commit", "--quiet", "-m", "v2");
		const agentDir = scratch();
		put(agentDir, { "a.md": "v1", "old.md": "v1", "edited.md": "v1 edited", "m.md": "v1", "mine.md": "mine" });
		const obsolete = (force: boolean) => planKitFiles(kit, agentDir, { force }).obsolete.map(file => [file.rel, file.action]);
		expect(obsolete(false)).toEqual([
			["edited.md", "keep"],
			["old.md", "remove"],
		]);
		expect(obsolete(true)).toEqual(obsolete(false));
	});

	test("never plans a path outside the agent directory, one through a file, or one a shipped file matches but for case", () => {
		const kit = scratch();
		const parent = scratch();
		const agentDir = join(parent, "agent");
		put(kit, { "agent/foo.md": "v1" });
		put(parent, { "outside.md": "x", "agent/foo.md": "v1", "agent/x": "a file" });
		record(agentDir, { maintainer: false, files: { "Foo.md": blobId("v1"), "../outside.md": blobId("x"), "x/y.md": blobId("y") } });
		expect(planKitFiles(kit, agentDir).obsolete).toEqual([]);
	});
});

describe("omp-template --files", () => {
	const installer = join(import.meta.dir, "install.ts");
	const files = (agentDir: string) => Bun.spawnSync([process.execPath, installer, "--files"], { env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, stdout: "pipe", stderr: "pipe" });

	test("changes nothing before an install recorded what it wrote", () => {
		const agentDir = scratch();
		put(agentDir, { "extensions/ship.ts": "old" });
		const proc = files(agentDir);
		expect(proc.exitCode).toBe(0);
		expect(proc.stdout.toString()).toContain("No starter kit install is recorded");
		expect(readFileSync(join(agentDir, "extensions/ship.ts"), "utf8")).toBe("old");
	});

	test("updates the files you never edited, keeps the one you edited, and adds back none you deleted", () => {
		const agentDir = scratch();
		const kitShip = readFileSync(join(import.meta.dir, "agent/extensions/ship.ts"), "utf8");
		put(agentDir, { "extensions/ship.ts": "installed before", "extensions/land.ts": "installed before, then edited" });
		record(agentDir, { maintainer: false, files: { "extensions/ship.ts": blobId("installed before"), "extensions/land.ts": blobId("installed before"), "extensions/notes.ts": blobId("installed before") } });
		const proc = files(agentDir);
		expect(proc.exitCode).toBe(0);
		expect(readFileSync(join(agentDir, "extensions/ship.ts"), "utf8")).toBe(kitShip);
		expect(readFileSync(join(agentDir, "extensions/land.ts"), "utf8")).toBe("installed before, then edited");
		expect(existsSync(join(agentDir, "extensions/notes.ts"))).toBe(false);
		expect(readFileSync(join(agentDir, "extensions/todos.ts"), "utf8")).toBe(readFileSync(join(import.meta.dir, "agent/extensions/todos.ts"), "utf8"));
		const after = readInstalledRecord(agentDir);
		expect(after?.files["extensions/ship.ts"]).toBe(blobId(kitShip));
		expect(after?.files["extensions/land.ts"]).toBe(blobId("installed before"));
	});

	test("removes a recorded file the kit no longer ships, the directory it leaves empty, and its record entry, and stops at a directory of yours or a symlink", () => {
		const agentDir = scratch();
		const linked = scratch();
		put(agentDir, { "extensions/gone/old.ts": "installed before", "extensions/kept/old.ts": "installed before", "extensions/kept/mine.ts": "mine" });
		put(linked, { "old.ts": "installed before" });
		symlinkSync(linked, join(agentDir, "extensions/linked"));
		const old = blobId("installed before");
		record(agentDir, { maintainer: false, files: { "extensions/gone/old.ts": old, "extensions/kept/old.ts": old, "extensions/linked/old.ts": old } });
		const proc = files(agentDir);
		expect(proc.exitCode).toBe(0);
		expect(proc.stdout.toString()).toContain("remove     file extensions/gone/old.ts, which the kit no longer ships");
		expect(existsSync(join(agentDir, "extensions/gone"))).toBe(false);
		expect(readdirSync(join(agentDir, "extensions/kept"))).toEqual(["mine.ts"]);
		expect(lstatSync(join(agentDir, "extensions/linked")).isSymbolicLink()).toBe(true);
		expect(readdirSync(linked)).toEqual([]);
		expect(Object.keys(readInstalledRecord(agentDir)?.files ?? {}).filter(rel => rel.endsWith("old.ts"))).toEqual([]);
	});
});

describe("MCP servers", () => {
	test("adds chrome-devtools beside your servers and other keys, and never rewrites one you list", () => {
		const agentDir = scratch();
		const path = join(agentDir, "mcp.json");
		writeFileSync(path, JSON.stringify({ note: "mine", mcpServers: { sentry: { type: "http", url: "https://mcp.sentry.dev/mcp" } } }));
		const first = planMcpServers(agentDir);
		expect(first.map(step => [step.name, step.action])).toEqual([["chrome-devtools", "create"]]);
		writeMcpServers(path, first);
		const written = JSON.parse(readFileSync(path, "utf8"));
		expect(written.note).toBe("mine");
		expect(Object.keys(written.mcpServers)).toEqual(["sentry", "chrome-devtools"]);

		writeFileSync(path, JSON.stringify({ mcpServers: { "chrome-devtools": { type: "stdio", command: "my-chrome" } } }));
		const again = planMcpServers(agentDir);
		expect(again.map(step => step.action)).toEqual(["same"]);
		writeMcpServers(path, again);
		expect(JSON.parse(readFileSync(path, "utf8")).mcpServers["chrome-devtools"].command).toBe("my-chrome");
	});

	test("creates mcp.json when you have none", () => {
		const agentDir = scratch();
		writeMcpServers(join(agentDir, "mcp.json"), planMcpServers(agentDir));
		expect(Object.keys(JSON.parse(readFileSync(join(agentDir, "mcp.json"), "utf8")).mcpServers)).toEqual(["chrome-devtools"]);
	});
});
