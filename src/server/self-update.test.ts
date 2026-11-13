import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../git";
import { errorText } from "../json";
import { aim, type Checkout, readBuild, type RunningBuild, SelfUpdate, UpdateRefused } from "./self-update";
import { UpdateJournal } from "./update-journal";

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
	const build = await readBuild(dir);
	if ("reason" in build) throw new Error(build.reason);
	return build;
}

async function push(pusher: string, file: string, text = file): Promise<string> {
	await commit(pusher, file, text);
	await git(pusher, "push", "--quiet", "origin", "main");
	return head(pusher);
}

/** `build`'s checkout as the server on port 4317 holds it, whose rollbacks reinstall with `true` for bun. */
async function journaled(build: RunningBuild): Promise<Extract<Checkout, { kind: "checkout" }>> {
	const journal = await UpdateJournal.at(build.dir, 4317, "true");
	if (journal === null) throw new Error(`${build.dir} has no git directory`);
	return { kind: "checkout", build, journal };
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

describe("aim", () => {
	test("names origin's commit and says bun.lock did not change, moving nothing", async () => {
		const { build, pusher } = await checkout();
		const tip = await push(pusher, "a");
		expect(await aim(build)).toEqual({ to: tip, lockChanged: false });
		expect(await head(build.dir)).toBe(build.commit);
	});

	test("says bun.lock changed since the running build, also once the checkout already moved", async () => {
		const { build, pusher } = await checkout();
		const tip = await push(pusher, "bun.lock", "v2");
		await git(build.dir, "pull", "--quiet", "--ff-only");
		expect(await aim(build)).toEqual({ to: tip, lockChanged: true });
	});

	test("aims past untracked files", async () => {
		const { build, pusher } = await checkout();
		const tip = await push(pusher, "a");
		writeFileSync(join(build.dir, "notes.txt"), "mine");
		expect(await aim(build)).toEqual({ to: tip, lockChanged: false });
	});

	test("refuses a checkout with changes to tracked files", async () => {
		const { build, pusher } = await checkout();
		await push(pusher, "a");
		writeFileSync(join(build.dir, "bun.lock"), "edited");
		expect(await refusal(aim(build))).toBe(`${build.dir} has changes to tracked files (bun.lock). Commit or discard them, then update.`);
	});

	test("refuses a branch with commits origin lacks", async () => {
		const { build, pusher } = await checkout();
		await push(pusher, "a");
		await commit(build.dir, "local");
		expect(await refusal(aim(build))).toBe("main has commits origin/main lacks, so it cannot fast-forward.");
	});

	test("refuses a checkout that moved to another branch since the server started", async () => {
		const { build } = await checkout();
		await git(build.dir, "switch", "--quiet", "-c", "feature");
		expect(await refusal(aim(build))).toBe(`${build.dir} is on feature now, not main, which the server runs.`);
	});

	test("refuses when git cannot compare bun.lock with the running build", async () => {
		const { build, pusher } = await checkout();
		await push(pusher, "a");
		const gone = "0".repeat(40);
		expect(await refusal(aim({ ...build, commit: gone }))).toBe(`git diff failed in ${build.dir}: fatal: bad object ${gone}`);
	});

	test("refuses with git's cause when the fetch fails", async () => {
		const { build } = await checkout();
		const missing = join(scratch(), "missing.git");
		await git(build.dir, "remote", "set-url", "origin", missing);
		expect(await refusal(aim(build))).toBe(`git fetch failed in ${build.dir}: fatal: '${missing}' does not appear to be a git repository`);
	});

	test("refuses a branch origin never had", async () => {
		const { build } = await checkout();
		await git(build.dir, "switch", "--quiet", "-c", "local-only");
		expect(await refusal(aim(await buildIn(build.dir)))).toBe("origin has no local-only branch to update from.");
	});
});

describe("SelfUpdate", () => {
	/** A self-update of `checkout` that records its installs, its starter kit updates, and restarts. */
	function recorded(checkout: Checkout, install: (dir: string) => Promise<void> = async () => {}) {
		const installs: string[] = [];
		const kitInstalls: string[] = [];
		const { promise: restarted, resolve: restart } = Promise.withResolvers<void>();
		const update = new SelfUpdate(checkout, restart, {
			install: async dir => {
				installs.push(dir);
				await install(dir);
			},
			installKit: async dir => void kitInstalls.push(dir),
		});
		return { update, installs, kitInstalls, restarted };
	}
	const noKit = { installKit: async () => {} };

	test("lists CHANGELOG.md's lines newest day first, marking those only origin holds as not installed", async () => {
		const { build, pusher } = await checkout();
		const entriesOf = async (running: RunningBuild) => {
			const update = new SelfUpdate(await journaled(running), () => {}, noKit);
			await update.news();
			const changelog = await update.changelog();
			if (changelog.kind !== "checkout") throw new Error(changelog.reason);
			return changelog.entries;
		};
		expect(await entriesOf(build)).toEqual([]);

		await push(pusher, "CHANGELOG.md", ["# What's new in omp-agents", "", "Plain words.", "", "## 2026-10-27", "", "- You can rename a session.", "- Fixed: the list kept scrolling.", ""].join("\n"));
		expect(await entriesOf(build)).toEqual([
			{ day: "2026-10-27", text: "You can rename a session.", installed: false },
			{ day: "2026-10-27", text: "Fixed: the list kept scrolling.", installed: false },
		]);

		await git(build.dir, "pull", "--quiet", "--ff-only");
		await push(
			pusher,
			"CHANGELOG.md",
			[
				"# What's new in omp-agents",
				"",
				"- A line before any day.",
				"",
				"## 2026-10-28",
				"",
				"- You can approve a pull request in one click.",
				"",
				"## 2026-10-27",
				"",
				"Some prose under a day.",
				"- You can rename a session.",
				"- You can rename a session.",
				"",
				"## 2026-10-28",
				"",
				"- Behind the scenes: the dashboard reads GitHub less often.",
				"",
			].join("\n"),
		);
		expect(await entriesOf(await buildIn(build.dir))).toEqual([
			{ day: "2026-10-28", text: "You can approve a pull request in one click.", installed: false },
			{ day: "2026-10-28", text: "Behind the scenes: the dashboard reads GitHub less often.", installed: false },
			{ day: "2026-10-27", text: "You can rename a session.", installed: true },
			{ day: "2026-10-27", text: "Fixed: the list kept scrolling.", installed: true },
		]);
	});

	test("counts origin's new commits past the running build", async () => {
		const { build, pusher } = await checkout();
		const { update } = recorded(await journaled(build));
		expect(await update.news()).toBeNull();
		await push(pusher, "a");
		await push(pusher, "b");
		expect(await update.news()).toEqual({ kind: "dashboard", branch: "main", running: build.commit, commits: 2 });
		expect(await update.status()).toEqual({ kind: "checkout", branch: "main", running: build.commit, behind: 2, failed: null });
	});

	test("restarts once the checkout moved, installing only when bun.lock changed, and the starter kit's files update at the new build's first start only", async () => {
		const { build, pusher } = await checkout();
		const tip = await push(pusher, "a");
		const checkoutNow = await journaled(build);
		const { update, installs, kitInstalls, restarted } = recorded(checkoutNow);
		expect(await update.update()).toEqual({ kind: "restarting", from: build.commit, to: tip, installed: false });
		await restarted;
		expect(installs).toEqual([]);
		expect(kitInstalls).toEqual([]);
		expect(checkoutNow.journal.read()).toEqual({ state: "starting", move: { branch: "main", from: build.commit, to: tip, lockChanged: false } });

		const next = recorded(await journaled(await buildIn(build.dir)));
		next.update.started();
		expect(next.kitInstalls).toEqual([build.dir]);
		expect(checkoutNow.journal.read()).toBeNull();
		next.update.started();
		expect(next.kitInstalls).toEqual([build.dir]);
	});

	test("a failed install takes the checkout back to the running build and restarts nothing", async () => {
		const { build, pusher } = await checkout();
		await push(pusher, "bun.lock", "v2");
		const checkoutNow = await journaled(build);
		let restarts = 0;
		const update = new SelfUpdate(checkoutNow, () => restarts++, {
			install: async () => {
				throw new Error("bun install --frozen-lockfile failed");
			},
			...noKit,
		});
		expect(await update.update().catch(errorText)).toBe("bun install --frozen-lockfile failed");
		expect(await head(build.dir)).toBe(build.commit);
		expect(checkoutNow.journal.read()).toBeNull();
		await Bun.sleep(400);
		expect(restarts).toBe(0);
	});

	test("a move git refuses keeps the checkout at the running build", async () => {
		const { build, pusher } = await checkout();
		await push(pusher, "a");
		writeFileSync(join(build.dir, "a"), "mine");
		const checkoutNow = await journaled(build);
		const { update } = recorded(checkoutNow);
		expect(await refusal(update.update())).toStartWith(`git merge failed in ${build.dir}:`);
		expect(await head(build.dir)).toBe(build.commit);
		expect(checkoutNow.journal.read()).toBeNull();
	});

	test("after the desktop shell rolled back a build that did not start, the update reports it and refuses it until origin moves past it", async () => {
		const { build, pusher } = await checkout();
		const tip = await push(pusher, "a");
		const before = await journaled(build);
		const first = recorded(before);
		await first.update.update();
		await first.restarted;
		expect(await before.journal.recover({ failure: "exited with code 1", error: "TypeError: boom" })).toMatchObject({ kind: "reverted", blocked: true });

		const back = await journaled(await buildIn(build.dir));
		const { update } = recorded(back);
		update.started();
		const failed = { commit: tip, failure: "exited with code 1" };
		expect(await update.news()).toEqual({ kind: "dashboard-failed", branch: "main", running: build.commit, failed });
		expect(await update.status()).toMatchObject({ failed });
		expect(await refusal(update.update())).toStartWith(`${tip.slice(0, 7)} did not start (exited with code 1), so omp-agents went back to ${build.commit.slice(0, 7)}. Its last error was "TypeError: boom`);
		expect(await head(build.dir)).toBe(build.commit);

		const later = await push(pusher, "b");
		expect(await update.news()).toMatchObject({ kind: "dashboard", commits: 2 });
		expect(await update.update()).toEqual({ kind: "restarting", from: build.commit, to: later, installed: false });
	});

	test("installs before restarting when bun.lock changed, and answers a second update with the first", async () => {
		const { build, pusher } = await checkout();
		const tip = await push(pusher, "bun.lock", "v2");
		const { update, installs, restarted } = recorded(await journaled(build));
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
		const update = new SelfUpdate(await journaled(build), () => {}, { install: async () => void (await push(pusher, "later")), installKit: async () => {} });
		const updated = update.update();
		const queued = update.news();
		expect(await updated).toEqual({ kind: "restarting", from: build.commit, to: tip, installed: true });
		expect(await queued).toBeNull();
		expect(await head(build.dir, "refs/remotes/origin/main")).toBe(tip);
	});

	test("answers current without restarting when origin holds nothing new", async () => {
		const { build } = await checkout();
		const { update, installs, kitInstalls } = recorded(await journaled(build));
		expect(await update.update()).toEqual({ kind: "current" });
		expect(installs).toEqual([]);
		expect(kitInstalls).toEqual([]);
	});

	test("refuses where the server cannot update itself", async () => {
		const { update } = recorded({ kind: "unavailable", reason: "The packaged app updates itself." });
		expect(await update.status()).toEqual({ kind: "unavailable", reason: "The packaged app updates itself." });
		expect(await update.news()).toBeNull();
		expect(await refusal(update.update())).toBe("The packaged app updates itself.");
	});
});
