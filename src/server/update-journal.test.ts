import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../git";
import { heldBack, type Move, UpdateJournal } from "./update-journal";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const scratch = (): string => {
	const dir = mkdtempSync(join(tmpdir(), "omp-update-journal-"));
	dirs.push(dir);
	return dir;
};

async function commit(dir: string, file: string, text = file): Promise<string> {
	writeFileSync(join(dir, file), text);
	await git(dir, "add", file);
	await git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", file);
	return head(dir);
}

const head = async (dir: string): Promise<string> => (await git(dir, "rev-parse", "HEAD")).trim();

/** A stand-in for bun that notes each run in `log` and exits `code`. */
function fakeBun(code: number): { bun: string; runs: () => string[] } {
	const dir = scratch();
	const log = join(dir, "runs");
	const bun = join(dir, "bun");
	writeFileSync(bun, `#!/bin/sh\necho "$@" >> '${log}'\nexit ${code}\n`, { mode: 0o755 });
	return { bun, runs: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) };
}

/** A checkout of `main` moved from one commit to the next, as an update leaves it. */
async function moved(lockChanged = false): Promise<{ dir: string; move: Move }> {
	const dir = scratch();
	await git(dir, "init", "--quiet", "--initial-branch=main");
	const from = await commit(dir, "app.ts", "v1");
	const to = await commit(dir, "app.ts", "v2");
	return { dir, move: { branch: "main", from, to, lockChanged } };
}

const journalIn = async (dir: string, bun = fakeBun(0).bun): Promise<UpdateJournal> => (await UpdateJournal.at(dir, 4317, bun))!;

const exited = { failure: "exited with code 1", error: "TypeError: boom" };
const silent = { failure: "did not answer within 60 s", error: null };

describe("UpdateJournal.recover", () => {
	test("a move cut short goes back to the commit that ran, installs again when bun.lock changed, and keeps no record", async () => {
		const { dir, move } = await moved(true);
		const bun = fakeBun(0);
		const journal = await journalIn(dir, bun.bun);
		journal.begin(move);
		expect(await journal.recover(null)).toEqual({ kind: "reverted", move, blocked: false });
		expect(await head(dir)).toBe(move.from);
		expect(readFileSync(join(dir, "app.ts"), "utf8")).toBe("v1");
		expect(bun.runs()).toEqual(["install --frozen-lockfile"]);
		expect(journal.read()).toBeNull();
		expect(await journal.recover(null)).toEqual({ kind: "none" });
		expect(await head(dir)).toBe(move.from);
	});

	test("a build that did not start goes back to the commit that ran, and the record then blocks that build", async () => {
		const { dir, move } = await moved();
		const bun = fakeBun(0);
		const journal = await journalIn(dir, bun.bun);
		journal.handOver(move);
		expect(await journal.recover(exited)).toEqual({ kind: "reverted", move, blocked: true });
		expect(await head(dir)).toBe(move.from);
		expect(bun.runs()).toEqual([]);
		expect(journal.blocking(move.to)).toEqual({ state: "rolled-back", move, failed: exited });
		expect(journal.blocking("0123456789abcdef")).toBeNull();
		expect(await journal.recover(exited)).toEqual({ kind: "none" });
		expect(await head(dir)).toBe(move.from);
	});

	test("a build about to start for the first time is left alone when nothing failed", async () => {
		const { dir, move } = await moved();
		const journal = await journalIn(dir);
		journal.handOver(move);
		expect(await journal.recover(null)).toEqual({ kind: "none" });
		expect(await head(dir)).toBe(move.to);
		expect(journal.read()).toEqual({ state: "starting", move });
	});

	test("a rollback cut short after the reset finishes on the next recovery, whatever it is passed", async () => {
		const { dir, move } = await moved(true);
		const failing = await journalIn(dir, fakeBun(1).bun);
		failing.handOver(move);
		expect(await failing.recover(silent)).toMatchObject({ kind: "stuck", move });
		expect(await head(dir)).toBe(move.from);
		expect(failing.blocking(move.to)).toBeNull();

		const bun = fakeBun(0);
		const journal = await journalIn(dir, bun.bun);
		expect(await journal.recover(null)).toEqual({ kind: "reverted", move, blocked: true });
		expect(bun.runs()).toEqual(["install --frozen-lockfile"]);
		expect(journal.blocking(move.to)).toMatchObject({ failed: silent });
	});

	test("a file changed since the move keeps the checkout where it is until the change is gone", async () => {
		const { dir, move } = await moved();
		const journal = await journalIn(dir);
		journal.handOver(move);
		writeFileSync(join(dir, "app.ts"), "mine");
		const stuck = await journal.recover(exited);
		expect(stuck).toMatchObject({ kind: "stuck", move });
		expect(await head(dir)).toBe(move.to);
		expect(readFileSync(join(dir, "app.ts"), "utf8")).toBe("mine");

		await git(dir, "checkout", "--", "app.ts");
		expect(await journal.recover(null)).toEqual({ kind: "reverted", move, blocked: true });
		expect(await head(dir)).toBe(move.from);
	});

	test("a checkout moved on by hand stays where it is, and its record goes", async () => {
		const { dir, move } = await moved();
		const journal = await journalIn(dir);
		journal.handOver(move);
		const elsewhere = await commit(dir, "other.ts");
		expect(await journal.recover(exited)).toEqual({ kind: "none" });
		expect(await head(dir)).toBe(elsewhere);
		expect(journal.read()).toBeNull();
	});

	test("a checkout on another branch stays where it is, and its record goes", async () => {
		const { dir, move } = await moved();
		const journal = await journalIn(dir);
		journal.begin(move);
		await git(dir, "checkout", "--quiet", "-b", "feature");
		expect(await journal.recover(null)).toEqual({ kind: "none" });
		expect(await head(dir)).toBe(move.to);
		expect(journal.read()).toBeNull();
	});
});

describe("UpdateJournal.started", () => {
	test("an update's first start is told once, and clears the record", async () => {
		const { dir, move } = await moved();
		const journal = await journalIn(dir);
		journal.handOver(move);
		expect(journal.started(move.to)).toBe(true);
		expect(journal.read()).toBeNull();
		expect(journal.started(move.to)).toBe(false);
	});

	test("a rolled-back record stays while the commit that ran before runs, and goes once another does", async () => {
		const { dir, move } = await moved();
		const journal = await journalIn(dir);
		journal.handOver(move);
		await journal.recover(exited);
		expect(journal.started(move.from)).toBe(false);
		expect(journal.blocking(move.to)).not.toBeNull();
		expect(journal.started("0123456789abcdef")).toBe(false);
		expect(journal.blocking(move.to)).toBeNull();
	});

	test("servers on other ports keep their own records", async () => {
		const { dir, move } = await moved();
		const journal = await journalIn(dir);
		const other = (await UpdateJournal.at(dir, 5000, "bun"))!;
		journal.begin(move);
		expect(other.read()).toBeNull();
	});
});

describe("heldBack", () => {
	test("names the rolled-back update while origin still holds the commit that did not start", async () => {
		const { dir, move } = await moved();
		const journal = await journalIn(dir);
		journal.handOver(move);
		expect(await heldBack(dir, move.to)).toBeNull();
		await journal.recover(exited);
		expect(await heldBack(dir, move.to)).toMatchObject({ move });
		expect(await heldBack(dir, "0123456789abcdef")).toBeNull();
	});
});

test("UpdateJournal.at answers null outside a git checkout", async () => {
	expect(await UpdateJournal.at(scratch(), 4317, "bun")).toBeNull();
});
