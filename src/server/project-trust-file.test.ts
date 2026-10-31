import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { untrustedText } from "../shared/project-trust";
import { ProjectTrustFile, projectOf, UntrustedProjectError } from "./project-trust-file";

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

const MCP = JSON.stringify({
	mcpServers: {
		local: { command: "node", args: ["server.js"] },
		remote: { url: "https://example.com/mcp", headers: { Authorization: "!cat .token" } },
	},
});

describe("the trust gate", () => {
	test("asks for every piece at first, then only for a piece added or changed since", async () => {
		const dir = repo({ ".omp/extensions/a.ts": "export default () => {};", ".omp/mcp.json": MCP });
		const file = new ProjectTrustFile(trustPath());
		const first = await file.untrustedCode(dir);
		expect(first?.root).toBe(dir);
		expect(first?.code.map(({ id, change }) => [id, change])).toEqual([
			[".omp/extensions/a.ts", "new"],
			["mcp:local", "new"],
			["mcp:remote", "new"],
		]);
		file.apply({ op: "trust", root: dir, code: first?.code ?? [] });
		expect(await file.untrustedCode(dir)).toBeNull();
		write(dir, { ".omp/extensions/a.ts": "export default () => { fetch('x'); };" });
		expect((await file.untrustedCode(dir))?.code.map(({ id, change }) => [id, change])).toEqual([[".omp/extensions/a.ts", "changed"]]);
		write(dir, { ".omp/extensions/a.ts": "export default () => {};", ".omp/tools/t.ts": "export default {};" });
		expect((await file.untrustedCode(dir))?.code.map(({ id, change }) => [id, change])).toEqual([[".omp/tools/t.ts", "new"]]);
	});

	test("a project with no code never asks", async () => {
		const dir = repo({ "README.md": "hi" });
		expect(await new ProjectTrustFile(trustPath()).untrustedCode(dir)).toBeNull();
	});

	test("admitting a directory throws the ask while its code is untrusted, and passes once it is trusted", async () => {
		const dir = repo({ ".omp/extensions/a.ts": "export default () => {};" });
		const file = new ProjectTrustFile(trustPath());
		const refused = await file.admit(dir).then(() => null, (error: unknown) => error);
		if (!(refused instanceof UntrustedProjectError)) throw new Error("expected an UntrustedProjectError");
		expect(refused.message).toBe(untrustedText(refused.ask));
		file.apply({ op: "trust", root: dir, code: refused.ask.code });
		expect(await file.admit(dir)).toBeUndefined();
	});

	test("a linked worktree shares its main checkout's trust, and forgetting asks again", async () => {
		const dir = repo({ ".omp/extensions/a.ts": "export default () => {};" });
		const worktree = join(tempDir("omp-agents-trust-wt-"), "wt");
		git(dir, "worktree", "add", "-q", "-b", "feature", worktree);
		expect(await projectOf(worktree)).toEqual({ root: dir, top: realpathSync(worktree) });
		const file = new ProjectTrustFile(trustPath());
		const ask = await file.untrustedCode(worktree);
		expect(ask?.root).toBe(dir);
		file.apply({ op: "trust", root: dir, code: ask?.code ?? [] });
		expect(await file.untrustedCode(dir)).toBeNull();
		expect(await file.untrustedCode(worktree)).toBeNull();
		file.apply({ op: "forget", root: dir });
		expect(await file.untrustedCode(worktree)).not.toBeNull();
	});

	test("another server's trust counts at the next start, and the list counts the pieces trusted", async () => {
		const dir = repo({ ".omp/extensions/a.ts": "export default () => {};" });
		const path = trustPath();
		const page = new ProjectTrustFile(path);
		const other = new ProjectTrustFile(path);
		const ask = await page.untrustedCode(dir);
		other.apply({ op: "trust", root: dir, code: ask?.code ?? [] });
		expect(await page.untrustedCode(dir)).toBeNull();
		expect(page.projects()).toEqual([{ root: dir, rootDisplay: dir, pieces: 1 }]);
	});

	test("a file that holds something else moves aside, and every piece asks again", async () => {
		const dir = repo({ ".omp/extensions/a.ts": "export default () => {};" });
		const path = trustPath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ relative: { a: "b" } }));
		const file = new ProjectTrustFile(path);
		expect(file.value).toEqual({});
		expect(existsSync(`${path}.invalid`)).toBe(true);
		expect((await file.untrustedCode(dir))?.code).toHaveLength(1);
	});
});
