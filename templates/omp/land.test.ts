import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bypass } from "./agent/extensions/land/gate";
import { land } from "./agent/extensions/land/lander";

const dirs: string[] = [];
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A bare remote, a clone of it on `main`, and a linked worktree on `feature` with one commit. */
function repo(config: object | null) {
	const root = mkdtempSync(join(tmpdir(), "land-test-"));
	dirs.push(root);
	const remote = join(root, "remote.git");
	const clone = join(root, "clone");
	execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
	execFileSync("git", ["clone", "-q", remote, clone], { stdio: "ignore" });
	git(clone, "switch", "-q", "-c", "main");
	git(clone, "config", "user.name", "t");
	git(clone, "config", "user.email", "t@t");
	writeFileSync(join(clone, "a.txt"), "one\n");
	if (config) {
		mkdirSync(join(clone, ".omp"));
		writeFileSync(join(clone, ".omp/land.json"), JSON.stringify(config));
	}
	git(clone, "add", "-A");
	git(clone, "commit", "-qm", "base");
	git(clone, "push", "-q", "origin", "main");
	const feature = join(root, "feature");
	git(clone, "worktree", "add", "-q", "-b", "feature", feature);
	writeFileSync(join(feature, "b.txt"), "feature\n");
	git(feature, "add", "-A");
	git(feature, "commit", "-qm", "feature work");
	return { root, remote, clone, feature, tip: git(feature, "rev-parse", "HEAD") };
}

describe("land", () => {
	test("pushes a merge commit of the branch on the remote target, records the divergence, and fast-forwards the clean local target", async () => {
		const r = repo({ checks: ["test -f b.txt", ["true", "test -f a.txt"]] });
		const result = await land({ cwd: r.feature, divergence: "None" });
		expect(result.kind).toBe("landed");
		const remoteMain = git(r.remote, "rev-parse", "main");
		expect(result.kind === "landed" && result.sha).toBe(remoteMain);
		expect(git(r.remote, "rev-parse", "main^2")).toBe(r.tip);
		expect(git(r.remote, "log", "-1", "--format=%B", "main")).toBe("Land feature\n\nDivergence: None");
		expect(git(r.clone, "rev-parse", "main")).toBe(remoteMain);
		expect(git(r.clone, "worktree", "list").split("\n")).toHaveLength(2);
	});

	test("a check that fails twice keeps the target where it was and returns the check's output", async () => {
		const r = repo({ checks: ["echo broken-on-merge; exit 3"] });
		const before = git(r.remote, "rev-parse", "main");
		const result = await land({ cwd: r.feature, divergence: "None" });
		expect(result).toMatchObject({ kind: "failed", command: "echo broken-on-merge; exit 3", why: "it exited with code 3 twice", tail: "broken-on-merge" });
		expect(git(r.remote, "rev-parse", "main")).toBe(before);
	});

	test("a check that passes only when run again lands and is named flaky", async () => {
		const r = repo({ checks: ["[ -f ran ] || { touch ran; exit 1; }"] });
		const result = await land({ cwd: r.feature, divergence: "None" });
		expect(result).toMatchObject({ kind: "landed", flaky: ["[ -f ran ] || { touch ran; exit 1; }"] });
	});

	test("a check that falls silent is stopped and fails", async () => {
		const r = repo({ checks: ["sleep 30"] });
		const started = Date.now();
		const result = await land({ cwd: r.feature, divergence: "None", silenceMs: 200 });
		expect(result).toMatchObject({ kind: "failed", why: "it was stopped: no output for 0.2 s" });
		expect(Date.now() - started).toBeLessThan(10_000);
	});

	test("a conflict with the target names the conflicting files and pushes nothing", async () => {
		const r = repo({ checks: ["true"] });
		writeFileSync(join(r.clone, "b.txt"), "main\n");
		git(r.clone, "add", "-A");
		git(r.clone, "commit", "-qm", "main side");
		git(r.clone, "push", "-q", "origin", "main");
		const before = git(r.remote, "rev-parse", "main");
		expect(await land({ cwd: r.feature, divergence: "None" })).toEqual({ kind: "conflict", paths: ["b.txt"] });
		expect(git(r.remote, "rev-parse", "main")).toBe(before);
	});

	test("a target that moves during the checks lands again on the new tip", async () => {
		const root = mkdtempSync(join(tmpdir(), "land-race-"));
		dirs.push(root);
		const other = join(root, "other");
		const mark = join(root, "raced");
		const r = repo({ checks: ["true"] });
		const check = `[ -f ${mark} ] || { touch ${mark}; git clone -q ${r.remote} ${other} && git -C ${other} -c user.name=t -c user.email=t@t commit -q --allow-empty -m other && git -C ${other} push -q origin HEAD:main; }`;
		writeFileSync(join(r.feature, ".omp/land.json"), JSON.stringify({ checks: [check] }));
		git(r.feature, "commit", "-qam", "race check");
		const result = await land({ cwd: r.feature, divergence: "None" });
		expect(result.kind).toBe("landed");
		const otherTip = git(other, "rev-parse", "HEAD");
		expect(result.kind === "landed" && result.base).toBe(otherTip);
		expect(git(r.remote, "rev-parse", "main^1")).toBe(otherTip);
	});

	test("refuses a repository without a config and a checkout with uncommitted changes", async () => {
		const bare = repo(null);
		expect((await land({ cwd: bare.feature, divergence: "None" })).kind).toBe("refused");
		const r = repo({ checks: ["true"] });
		writeFileSync(join(r.feature, "a.txt"), "changed\n");
		expect(await land({ cwd: r.feature, divergence: "None" })).toMatchObject({ kind: "refused", reason: expect.stringContaining("uncommitted") });
	});

	test("nothing lands when the branch is already on the target", async () => {
		const r = repo({ checks: ["true"] });
		expect(await land({ cwd: r.clone, divergence: "None" })).toEqual({ kind: "nothing", target: "origin/main" });
	});
});

describe("land gate", () => {
	const r = repo({ checks: ["true"] });
	const plain = repo(null);
	const blocked = (line: string[], dir: string | null) => bypass(line, dir) !== undefined;

	test("blocks every way a bash command reaches the target", () => {
		expect(blocked(["git", "push", "origin", "main"], r.feature)).toBe(true);
		expect(blocked(["git", "push", "--no-verify", "origin", "feature:refs/heads/main"], r.feature)).toBe(true);
		expect(blocked(["git", "-C", r.feature, "push", "origin", "+HEAD:main"], "/")).toBe(true);
		expect(blocked(["git", "push"], r.clone)).toBe(true);
		expect(blocked(["git", "push", "origin", "HEAD"], r.clone)).toBe(true);
		expect(blocked(["git", "push", "--all"], r.feature)).toBe(true);
		expect(blocked(["git", "merge", "feature"], r.clone)).toBe(true);
		expect(blocked(["gh", "pr", "merge", "7", "--squash"], r.feature)).toBe(true);
		expect(blocked(["git", "push", "origin", "main"], null)).toBe(true);
	});

	test("lets branch pushes, catching up the target, and repositories without a config through", () => {
		expect(blocked(["git", "push", "-u", "origin", "feature"], r.feature)).toBe(false);
		expect(blocked(["git", "push"], r.feature)).toBe(false);
		expect(blocked(["git", "merge", "--ff-only", "origin/main"], r.clone)).toBe(false);
		expect(blocked(["git", "merge", "--abort"], r.clone)).toBe(false);
		expect(blocked(["git", "merge", "main"], r.feature)).toBe(false);
		expect(blocked(["git", "push", "origin", "main"], plain.clone)).toBe(false);
		expect(blocked(["gh", "pr", "merge", "7"], plain.clone)).toBe(false);
	});
});
