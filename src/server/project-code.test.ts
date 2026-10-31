import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ProjectCode } from "../shared/project-trust";
import { projectCensus } from "./project-code";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, files: Record<string, string>): void {
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	}
}

/** A git repository holding `files`, committed. */
function repo(files: Record<string, string>): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "omp-agents-census-repo-")));
	dirs.push(dir);
	const git = (...args: string[]): void => {
		const run = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stderr: "pipe" });
		if (run.exitCode !== 0) throw new Error(run.stderr.toString());
	};
	git("init", "-q", "-b", "main");
	write(dir, files);
	git("add", "-A");
	git("commit", "-q", "--allow-empty", "-m", "init");
	return dir;
}

const kindsAndIds = (code: readonly ProjectCode[]) => code.map(({ kind, id }) => [kind, id]);

describe("the project code census", () => {
	test("finds every piece omp would run from a project, through omp's own discovery, each with a hash", async () => {
		const dir = repo({
			".omp/extensions/a.ts": "export default () => {};",
			".omp/extensions/pkg/index.ts": "import './helper';",
			".omp/extensions/pkg/helper.ts": "export {};",
			".omp/tools/t.ts": "export default {};",
			".omp/tools/readme.md": "# not a tool",
			".omp/commands/deploy/index.ts": "export default {};",
			".omp/mcp.json": JSON.stringify({
				mcpServers: {
					local: { command: "node", args: ["server.js"] },
					remote: { url: "https://example.com/mcp", headers: { Authorization: "!cat .token" } },
				},
			}),
			".omp/skills/s/SKILL.md": "---\nname: s\ndescription: d\n---\nbody",
			".omp/config.yml": "extensions:\n  - ./x.ts\n",
			"lsp.json": "{}",
		});
		const code = await projectCensus(dir, dir);
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
		expect(code.map(({ name }) => name)).toEqual([".omp/extensions/a.ts", ".omp/extensions/pkg/index.ts", ".omp/tools/t.ts", ".omp/commands/deploy/index.ts", "local", "remote", ".omp/config.yml", "lsp.json"]);
		expect(code.every(({ hash }) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
	});

	test("a URL MCP server is a piece, since its header values may run commands", async () => {
		const dir = repo({ ".omp/mcp.json": JSON.stringify({ mcpServers: { remote: { url: "https://example.com/mcp", headers: { Authorization: "!cat .token" } } } }) });
		expect(kindsAndIds(await projectCensus(dir, dir))).toEqual([["mcp-server", "mcp:remote"]]);
	});

	test("an MCP server's hash does not depend on the order its settings were written in", async () => {
		const a = repo({ ".omp/mcp.json": JSON.stringify({ mcpServers: { db: { command: "node", args: ["s.js"] } } }) });
		const b = repo({ ".omp/mcp.json": JSON.stringify({ mcpServers: { db: { args: ["s.js"], command: "node" } } }) });
		const [first] = await projectCensus(a, a);
		const [second] = await projectCensus(b, b);
		expect(first?.hash).toBe(second?.hash ?? "");
	});

	test("a settings file is a piece whatever keys it sets, since many name commands", async () => {
		const dir = repo({ ".omp/config.yml": "python:\n  interpreter: ./run-me\n" });
		expect(kindsAndIds(await projectCensus(dir, dir))).toEqual([["settings", ".omp/config.yml"]]);
	});

	test("a project of skills and agents only runs no code", async () => {
		const dir = repo({ ".omp/skills/s/SKILL.md": "---\nname: s\ndescription: d\n---\nbody", ".omp/agents/a.md": "---\nname: a\ndescription: d\n---\nbody", "AGENTS.md": "# rules" });
		expect(await projectCensus(dir, dir)).toEqual([]);
	});

	test("an edit to a file beside a package's entry changes the package's hash; a change since the last census shows", async () => {
		const dir = repo({ ".omp/extensions/pkg/index.ts": "import './helper';", ".omp/extensions/pkg/helper.ts": "export {};" });
		const [before] = await projectCensus(dir, dir);
		write(dir, { ".omp/extensions/pkg/helper.ts": "export const x = 1;" });
		const [after] = await projectCensus(dir, dir);
		expect(after?.id).toBe(".omp/extensions/pkg/index.ts");
		expect(after?.hash).not.toBe(before?.hash);
		write(dir, { ".omp/tools/t.ts": "export default {};" });
		expect(kindsAndIds(await projectCensus(dir, dir))).toContainEqual(["tool", ".omp/tools/t.ts"]);
	});
});
