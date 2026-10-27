import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../git";
import { type Checkout, fastForward, readBuild, type RunningBuild, SelfUpdate, UpdateRefused } from "./self-update";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const scratch = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "omp-self-update-"));
	dirs.push(dir);
	return dir;
};

async function commit(dir: string, file: string, text = file): Promise<void> {
	writeFileSync(join(dir, file), text);
	await git(dir, "add", file);
	await git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", file);
}

const head = async (dir: string, ref = "HEAD"): Promise<string> => (await git(dir, "rev-parse", ref)).trim();

/** A bare origin, a checkout of its `main` the server would run, and a second clone that pushes to origin. */
async function checkout(): Promise<{ build: RunningBuild; pusher: string }> {
	const root = scratch();
	const origin = join(root, "origin.git");
	const [server, pusher] = [join(root, "server"), join(root, "pusher")];
	await git(root, "init", "--quiet", "--bare", "--initial-branch=main", origin);
	await git(root, "clone", "--quiet", origin, pusher);
	await git(pusher, "switch", "--quiet", "-c", "main");
	await commit(pusher, "bun.lock", "v1");
	await git(pusher, "push", "--quiet", "origin", "main");
	await git(root, "clone", "--quiet", origin, server);
	return { build: await buildIn(server), pusher };
}

/** The build `dir` holds, which a test needs to be one. */
async function buildIn(dir: string): Promise<RunningBuild> {
	const checkout = await readBuild(dir);
	if (checkout.kind === "unavailable") throw new Error(checkout.reason);
	return checkout.build;
}

async function push(pusher: string, file: string, text = file): Promise<string> {
	await commit(pusher, file, text);
	await git(pusher, "push", "--quiet", "origin", "main");
	return head(pusher);
}

const refusal = (work: Promise<unknown>): Promise<string> =>
	work.then(
		() => "resolved",
		(err: unknown) => (err instanceof UpdateRefused ? err.message : `not a refusal: ${String(err)}`),
	);

describe("readBuild", () => {
	test("names the checkout, its branch, and its commit", async () => {
		const { build } = await checkout();
		expect(build).toEqual({ dir: build.dir, branch: "main", commit: await head(build.dir) });
	});

	test("refuses a detached HEAD and a directory outside git", async () => {
		const { build } = await checkout();
		await git(build.dir, "switch", "--quiet", "--detach");
		expect(await readBuild(build.dir)).toEqual({ kind: "unavailable", reason: `${build.dir} has a detached HEAD, so it follows no branch.` });
		expect(await readBuild(scratch())).toEqual({ kind: "unavailable", reason: "omp-agents does not run from a git checkout." });
	});
});

describe("fastForward", () => {
	test("moves a clean checkout to origin's branch and says bun.lock did not change", async () => {
		const { build, pusher } = await checkout();
		const tip = await push(pusher, "a");
		expect(await fastForward(build)).toEqual({ head: tip, lockChanged: false });
		expect(await head(build.dir)).toBe(tip);
	});

	test("says bun.lock changed since the running build, also once the checkout already moved", async () => {
		const { build, pusher } = await checkout();
		const tip = await push(pusher, "bun.lock", "v2");
		await git(build.dir, "pull", "--quiet", "--ff-only");
		expect(await fastForward(build)).toEqual({ head: tip, lockChanged: true });
	});

	test("updates past untracked files", async () => {
		const { build, pusher } = await checkout();
		const tip = await push(pusher, "a");
		writeFileSync(join(build.dir, "notes.txt"), "mine");
		expect(await fastForward(build)).toEqual({ head: tip, lockChanged: false });
	});

	test("refuses a checkout with changes to tracked files and leaves it as it was", async () => {
		const { build, pusher } = await checkout();
		await push(pusher, "a");
		writeFileSync(join(build.dir, "bun.lock"), "edited");
		expect(await refusal(fastForward(build))).toBe(`${build.dir} has changes to tracked files (bun.lock). Commit or discard them, then update.`);
		expect(await head(build.dir)).toBe(build.commit);
	});

	test("refuses a branch with commits origin lacks", async () => {
		const { build, pusher } = await checkout();
		await push(pusher, "a");
		await commit(build.dir, "local");
		const local = await head(build.dir);
		expect(await refusal(fastForward(build))).toBe("main has commits origin/main lacks, so it cannot fast-forward.");
		expect(await head(build.dir)).toBe(local);
	});

	test("refuses a checkout that moved to another branch since the server started", async () => {
		const { build } = await checkout();
		await git(build.dir, "switch", "--quiet", "-c", "feature");
		expect(await refusal(fastForward(build))).toBe(`${build.dir} is on feature now, not main, which the server runs.`);
	});

	test("refuses, leaving the checkout as it was, when git cannot compare bun.lock with the running build", async () => {
		const { build, pusher } = await checkout();
		await push(pusher, "a");
		const gone = "0".repeat(40);
		expect(await refusal(fastForward({ ...build, commit: gone }))).toBe(`git diff failed in ${build.dir}: fatal: bad object ${gone}`);
		expect(await head(build.dir)).toBe(build.commit);
	});

	test("refuses with git's cause when the fetch fails", async () => {
		const { build } = await checkout();
		const missing = join(scratch(), "missing.git");
		await git(build.dir, "remote", "set-url", "origin", missing);
		expect(await refusal(fastForward(build))).toBe(`git fetch failed in ${build.dir}: fatal: '${missing}' does not appear to be a git repository`);
	});

	test("refuses a branch origin never had", async () => {
		const { build } = await checkout();
		await git(build.dir, "switch", "--quiet", "-c", "local-only");
		expect(await refusal(fastForward(await buildIn(build.dir)))).toBe("origin has no local-only branch to update from.");
	});
});

describe("SelfUpdate", () => {
	/** A self-update of `checkout` that records its installs and restarts. */
	function recorded(checkout: Checkout) {
		const installs: string[] = [];
		const { promise: restarted, resolve: restart } = Promise.withResolvers<void>();
		const update = new SelfUpdate(checkout, restart, async dir => void installs.push(dir));
		return { update, installs, restarted };
	}

	test("lists feature commits newest first, marking those only origin holds as not installed", async () => {
		const { build, pusher } = await checkout();
		const say = async (message: string): Promise<string> => {
			await git(pusher, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "--allow-empty", "-m", message);
			await git(pusher, "push", "--quiet", "origin", "main");
			return head(pusher);
		};
		const shown = await say("feat(ui): show the bell (#12)");
		await say("fix: keep the bell");
		await say("Add failing tests for the bell");
		const added = await say("Add a What's new page");
		const { update } = recorded({ kind: "checkout", build });
		await update.newCommits();
		const changelog = await update.changelog();
		if (changelog.kind !== "checkout") throw new Error(changelog.reason);
		expect(changelog.entries.map(({ commit, title, area, pr, installed }) => ({ commit, title, area, pr, installed }))).toEqual([
			{ commit: added, title: "Add a What's new page", area: null, pr: null, installed: false },
			{ commit: shown, title: "Show the bell", area: "ui", pr: 12, installed: false },
		]);
	});

	test("counts origin's new commits past the running build", async () => {
		const { build, pusher } = await checkout();
		const { update } = recorded({ kind: "checkout", build });
		expect(await update.newCommits()).toBeNull();
		await push(pusher, "a");
		await push(pusher, "b");
		expect(await update.newCommits()).toEqual({ branch: "main", running: build.commit, commits: 2 });
		expect(await update.status()).toEqual({ kind: "checkout", branch: "main", running: build.commit, behind: 2 });
	});

	test("restarts once the checkout moved, installing only when bun.lock changed", async () => {
		const { build, pusher } = await checkout();
		const tip = await push(pusher, "a");
		const { update, installs, restarted } = recorded({ kind: "checkout", build });
		expect(await update.update()).toEqual({ kind: "restarting", from: build.commit, to: tip, installed: false });
		await restarted;
		expect(installs).toEqual([]);
	});

	test("installs before restarting when bun.lock changed, and answers a second update with the first", async () => {
		const { build, pusher } = await checkout();
		const tip = await push(pusher, "bun.lock", "v2");
		const { update, installs, restarted } = recorded({ kind: "checkout", build });
		const outcome = { kind: "restarting", from: build.commit, to: tip, installed: true } as const;
		expect(await update.update()).toEqual(outcome);
		await push(pusher, "later");
		expect(await update.update()).toEqual(outcome);
		await restarted;
		expect(installs).toEqual([build.dir]);
	});

	test("a check queued behind an update that restarts fetches nothing", async () => {
		const { build, pusher } = await checkout();
		const tip = await push(pusher, "bun.lock", "v2");
		const update = new SelfUpdate({ kind: "checkout", build }, () => {}, async () => void (await push(pusher, "later")));
		const updated = update.update();
		const queued = update.newCommits();
		expect(await updated).toEqual({ kind: "restarting", from: build.commit, to: tip, installed: true });
		expect(await queued).toBeNull();
		expect(await head(build.dir, "refs/remotes/origin/main")).toBe(tip);
	});

	test("answers current without restarting when origin holds nothing new", async () => {
		const { build } = await checkout();
		const { update, installs } = recorded({ kind: "checkout", build });
		expect(await update.update()).toEqual({ kind: "current" });
		expect(installs).toEqual([]);
	});

	test("refuses where the server cannot update itself", async () => {
		const { update } = recorded({ kind: "unavailable", reason: "The packaged app updates itself." });
		expect(await update.status()).toEqual({ kind: "unavailable", reason: "The packaged app updates itself." });
		expect(await update.newCommits()).toBeNull();
		expect(await refusal(update.update())).toBe("The packaged app updates itself.");
	});
});
