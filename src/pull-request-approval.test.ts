import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git";
import { patchId } from "./pull-request-approval";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function commit(cwd: string, file: string, text: string, message: string): Promise<string> {
	writeFileSync(join(cwd, file), text);
	await git(cwd, "add", file);
	await git(cwd, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", message);
	return (await git(cwd, "rev-parse", "HEAD")).trim();
}

test("a branch rebased onto a newer base keeps its patch id, and one more change to it does not", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "omp-agents-patch-id-"));
	dirs.push(cwd);
	await git(cwd, "init", "-q", "-b", "main");
	await commit(cwd, "a.txt", "one\n", "base");
	await git(cwd, "switch", "-q", "-c", "feature");
	const approved = await commit(cwd, "b.txt", "feature\n", "feature");
	await git(cwd, "switch", "-q", "main");
	await commit(cwd, "a.txt", "one\ntwo\n", "trunk moves");
	await git(cwd, "switch", "-q", "feature");
	await git(cwd, "-c", "user.name=t", "-c", "user.email=t@t", "rebase", "-q", "main");
	const rebased = (await git(cwd, "rev-parse", "HEAD")).trim();
	const edited = await commit(cwd, "b.txt", "feature, changed\n", "unreviewed change");

	expect(rebased).not.toBe(approved);
	const id = await patchId(cwd, "main", approved);
	expect(id).toMatch(/^[0-9a-f]{40}$/);
	expect(await patchId(cwd, "main", rebased)).toBe(id);
	expect(await patchId(cwd, "main", edited)).not.toBe(id);
});
