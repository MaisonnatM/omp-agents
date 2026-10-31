import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { discoverProjectCode } from "../omp/discovery";
import type { ProjectCode } from "../shared/project-trust";
import { ProjectTrustFile, projectOf, untrustedCode } from "./project-trust-file";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	dirs.push(dir);
	return dir;
}

function git(cwd: string, ...args: string[]): void {
	const run = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, stderr: "pipe" });
	if (run.exitCode !== 0) throw new Error(run.stderr.toString());
}

function write(root: string, files: Record<string, string>): void {
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	}
}

/** A git repository holding `files`, committed. */
function repo(files: Record<string, string>): string {
	const dir = tempDir("omp-agents-trust-repo-");
	git(dir, "init", "-q", "-b", "main");
	write(dir, files);
	git(dir, "add", "-A");
	git(dir, "commit", "-q", "--allow-empty", "-m", "init");
	return dir;
}

const trustPath = (): string => join(tempDir("omp-agents-trust-file-"), "project-trust.json");
const kindsAndIds = (code: readonly ProjectCode[]) => code.map(({ kind, id }) => [kind, id]);

const MCP = JSON.stringify({
	mcpServers: {
		local: { command: "node", args: ["server.js"] },
		remote: { url: "https://example.com/mcp", headers: { Authorization: "!cat .token" } },
	},
});

describe("the project code census", () => {
	test("finds every piece omp would run from a project, through omp's own discovery, each with a hash", async () => {
		const dir = repo({
			".omp/extensions/a.ts": "export default () => {};",
			".omp/extensions/pkg/index.ts": "import './helper';",
			".omp/extensions/pkg/helper.ts": "export {};",
			".omp/tools/t.ts": "export default {};",
			".omp/tools/readme.md": "# not a tool",
			".omp/commands/deploy/index.ts": "export default {};",
			".omp/mcp.json": MCP,
			".omp/skills/s/SKILL.md": "---\nname: s\ndescription: d\n---\nbody",
			".omp/config.yml": "extensions:\n  - ./x.ts\n",
			"lsp.json": "{}",
		});
		const code = await discoverProjectCode(dir, dir);
		expect(kindsAndIds(code)).toEqual([
			["extension", ".omp/extensions/a.ts"],
			["extension", ".omp/extensions/pkg/index.ts"],
			["tool", ".omp/tools/t.ts"],
			["command", ".omp/commands/deploy/index.ts"],
			["mcp-server", "mcp:local"],
			["mcp-server", "mcp:remote"],
			["settings", ".omp/config.yml"],
			["lsp", "lsp.json"],
		]);
		expect(code.every(({ hash }) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
	});

	test("a URL MCP server is a piece, since its header values may run commands", async () => {
		const dir = repo({ ".omp/mcp.json": JSON.stringify({ mcpServers: { remote: { url: "https://example.com/mcp", headers: { Authorization: "!cat .token" } } } }) });
		expect(kindsAndIds(await discoverProjectCode(dir, dir))).toEqual([["mcp-server", "mcp:remote"]]);
	});

	test("a settings file is a piece whatever keys it sets, since many name commands", async () => {
		const dir = repo({ ".omp/config.yml": "python:\n  interpreter: ./run-me\n" });
		expect(kindsAndIds(await discoverProjectCode(dir, dir))).toEqual([["settings", ".omp/config.yml"]]);
	});

	test("a project of skills and agents only runs no code", async () => {
		const dir = repo({ ".omp/skills/s/SKILL.md": "---\nname: s\ndescription: d\n---\nbody", ".omp/agents/a.md": "---\nname: a\ndescription: d\n---\nbody", "AGENTS.md": "# rules" });
		expect(await discoverProjectCode(dir, dir)).toEqual([]);
	});

	test("an edit to a file beside a package's entry changes the package's hash; a change since the last census shows", async () => {
		const dir = repo({ ".omp/extensions/pkg/index.ts": "import './helper';", ".omp/extensions/pkg/helper.ts": "export {};" });
		const [before] = await discoverProjectCode(dir, dir);
		write(dir, { ".omp/extensions/pkg/helper.ts": "export const x = 1;" });
		const [after] = await discoverProjectCode(dir, dir);
		expect(after?.id).toBe(".omp/extensions/pkg/index.ts");
		expect(after?.hash).not.toBe(before?.hash);
		write(dir, { ".omp/tools/t.ts": "export default {};" });
		expect(kindsAndIds(await discoverProjectCode(dir, dir))).toContainEqual(["tool", ".omp/tools/t.ts"]);
	});
});

describe("the trust gate", () => {
	test("asks for every piece at first, then only for a piece added or changed since", async () => {
		const dir = repo({ ".omp/extensions/a.ts": "export default () => {};", ".omp/mcp.json": MCP });
		const file = new ProjectTrustFile(trustPath());
		const first = await untrustedCode(file, dir);
		expect(first?.root).toBe(dir);
		expect(first?.code.map(({ id, change }) => [id, change])).toEqual([
			[".omp/extensions/a.ts", "new"],
			["mcp:local", "new"],
			["mcp:remote", "new"],
		]);
		file.apply({ op: "trust", root: dir, code: first?.code ?? [] });
		expect(await untrustedCode(file, dir)).toBeNull();
		write(dir, { ".omp/extensions/a.ts": "export default () => { fetch('x'); };" });
		expect((await untrustedCode(file, dir))?.code.map(({ id, change }) => [id, change])).toEqual([[".omp/extensions/a.ts", "changed"]]);
		write(dir, { ".omp/extensions/a.ts": "export default () => {};", ".omp/tools/t.ts": "export default {};" });
		expect((await untrustedCode(file, dir))?.code.map(({ id, change }) => [id, change])).toEqual([[".omp/tools/t.ts", "new"]]);
	});

	test("a project with no code never asks", async () => {
		const dir = repo({ "README.md": "hi" });
		expect(await untrustedCode(new ProjectTrustFile(trustPath()), dir)).toBeNull();
	});

	test("a linked worktree shares its main checkout's trust, and forgetting asks again", async () => {
		const dir = repo({ ".omp/extensions/a.ts": "export default () => {};" });
		const worktree = join(tempDir("omp-agents-trust-wt-"), "wt");
		git(dir, "worktree", "add", "-q", "-b", "feature", worktree);
		expect(await projectOf(worktree)).toEqual({ root: dir, top: realpathSync(worktree) });
		const file = new ProjectTrustFile(trustPath());
		const ask = await untrustedCode(file, worktree);
		expect(ask?.root).toBe(dir);
		file.apply({ op: "trust", root: dir, code: ask?.code ?? [] });
		expect(await untrustedCode(file, dir)).toBeNull();
		expect(await untrustedCode(file, worktree)).toBeNull();
		file.apply({ op: "forget", root: dir });
		expect(await untrustedCode(file, worktree)).not.toBeNull();
	});

	test("another server's trust counts at the next start, and the list names each piece trusted", async () => {
		const dir = repo({ ".omp/extensions/a.ts": "export default () => {};" });
		const path = trustPath();
		const page = new ProjectTrustFile(path);
		const other = new ProjectTrustFile(path);
		const ask = await untrustedCode(page, dir);
		other.apply({ op: "trust", root: dir, code: ask?.code ?? [] });
		expect(await untrustedCode(page, dir)).toBeNull();
		expect(page.projects()).toEqual([{ root: dir, rootDisplay: dir, ids: [".omp/extensions/a.ts"] }]);
	});

	test("a file that holds something else moves aside, and every piece asks again", async () => {
		const dir = repo({ ".omp/extensions/a.ts": "export default () => {};" });
		const path = trustPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ relative: { a: "b" } }));
		const file = new ProjectTrustFile(path);
		expect(file.value).toEqual({});
		expect(existsSync(`${path}.invalid`)).toBe(true);
		expect((await untrustedCode(file, dir))?.code).toHaveLength(1);
	});
});
