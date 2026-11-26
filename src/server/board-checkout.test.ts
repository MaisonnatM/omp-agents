import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TrustAsk } from "../shared/project-trust";
import { boardCheckout, landBoardBranch } from "./board-checkout";
import { UntrustedProjectError } from "./project-trust-file";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "board-checkout-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function git(dir: string, ...args: string[]): string {
	const run = Bun.spawnSync(["git", "-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { stderr: "pipe" });
	if (run.exitCode !== 0) throw new Error(run.stderr.toString());
	return run.stdout.toString().trim();
}

/** A repository named `name` on `main`, whose `.omp/land.json` runs `setup` in each worktree it adds, when given. */
function repo(name: string, setup?: string[]): string {
	const dir = join(scratch, name);
	mkdirSync(join(dir, ".omp"), { recursive: true });
	git(dir, "init", "-q", "-b", "main");
	if (setup) writeFileSync(join(dir, ".omp/land.json"), JSON.stringify({ setup, checks: ["true"] }));
	writeFileSync(join(dir, "README.md"), "app\n");
	git(dir, "add", "-A");
	git(dir, "commit", "-q", "-m", "init");
	return dir;
}

const trusted = async (): Promise<void> => {};
const ask: TrustAsk = { root: "/repo", rootDisplay: "/repo", code: [{ kind: "land-config", id: ".omp/land.json", name: ".omp/land.json", hash: "h", change: "new" }] };
const untrusted = async (): Promise<void> => {
	throw new UntrustedProjectError(ask);
};
const worktrees = (dir: string): number => git(dir, "worktree", "list", "--porcelain").split("\n").filter(line => line.startsWith("worktree ")).length;

describe("a Board task's checkout", () => {
	test("runs no setup in a project the user has not trusted, and leaves no worktree behind", async () => {
		const ran = join(scratch, "untrusted-ran");
		const dir = repo("untrusted", [`touch ${ran}`]);
		await expect(boardCheckout(dir, "board/1", untrusted)).rejects.toThrow(UntrustedProjectError);
		expect(existsSync(ran)).toBe(false);
		expect(worktrees(dir)).toBe(1);
	});

	test("removes the worktree whose setup failed, so the next round runs the setup again", async () => {
		const runs = join(scratch, "retry-runs");
		const ok = join(scratch, "retry-ok");
		const dir = repo("retry", [`echo run >> ${runs}; test -f ${ok}`]);
		await expect(boardCheckout(dir, "board/1", trusted)).rejects.toThrow(/exited with code 1/);
		expect(worktrees(dir)).toBe(1);
		writeFileSync(ok, "");
		const checkout = await boardCheckout(dir, "board/1", trusted);
		expect(checkout).toBe(`${dir}-wt/board-1`);
		expect(readFileSync(runs, "utf8").trim().split("\n")).toHaveLength(2);
		expect(await boardCheckout(dir, "board/1", trusted)).toBe(checkout);
		expect(readFileSync(runs, "utf8").trim().split("\n")).toHaveLength(2);
	});
});

describe("Merge on main", () => {
	test("from a branch no worktree holds runs no setup and leaves no worktree behind", async () => {
		const ran = join(scratch, "land-ran");
		const dir = repo("land", [`touch ${ran}`]);
		git(dir, "branch", "board/1");
		expect(await landBoardBranch(dir, "board/1", undefined, untrusted)).toEqual({ outcome: "refused", text: new UntrustedProjectError(ask).message });
		expect(existsSync(ran)).toBe(false);
		expect(worktrees(dir)).toBe(1);
		expect(existsSync(`${dir}-wt`)).toBe(false);
	});

	test("in a repository with no land config is refused, not failed", async () => {
		const dir = repo("no-config");
		git(dir, "branch", "board/1");
		const landed = await landBoardBranch(dir, "board/1", undefined, trusted);
		expect(landed.outcome).toBe("refused");
		expect(worktrees(dir)).toBe(1);
	});
});
