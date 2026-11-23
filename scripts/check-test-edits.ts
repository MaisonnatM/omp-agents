/** Fails a landing that edits or deletes a test the base already had, unless a commit in the range says why on a `test-change: <reason>` line. */

const TEST_FILE = /\.test\.tsx?$|(^|\/)(__tests__|tests)\//;
const REASON = /^test-change:[ \t]*\S/m;

function git(repo: string, args: string[]): string {
	const done = Bun.spawnSync(["git", "-C", repo, ...args]);
	if (done.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${done.stderr.toString().trim()}`);
	return done.stdout.toString();
}

/** The tests that existed at `base` and that `base..head` modifies or deletes, or none when a commit in the range carries a `test-change:` line. */
export function editedTests(repo: string, base: string, head = "HEAD"): { path: string; change: "modified" | "deleted" }[] {
	// `--no-renames` reports a moved test as the deletion of its old path.
	const fields = git(repo, ["diff", "--name-status", "--no-renames", "-z", base, head]).split("\0");
	const edited: { path: string; change: "modified" | "deleted" }[] = [];
	for (let i = 0; i + 1 < fields.length; i += 2) {
		const status = fields[i]!;
		const path = fields[i + 1]!;
		if (status === "A" || !TEST_FILE.test(path)) continue;
		edited.push({ path, change: status === "D" ? "deleted" : "modified" });
	}
	if (edited.length === 0 || REASON.test(git(repo, ["log", "--format=%B", `${base}..${head}`]))) return [];
	return edited;
}

if (import.meta.main) {
	const base = process.argv[2] ?? process.env.LAND_BASE;
	if (!base) {
		console.error("Usage: bun scripts/check-test-edits.ts <base>, or set LAND_BASE.");
		process.exit(2);
	}
	const edited = editedTests(process.cwd(), base);
	for (const { path, change } of edited) console.error(`ERROR: ${path} existed at ${base.slice(0, 12)} and was ${change}.`);
	if (edited.length > 0) {
		console.error("A test that already passed guards behavior; change it only when that behavior changed on purpose, never to make a failing check pass.");
		console.error("If the change is intended, add a line `test-change: <reason>` to a commit message in this range.");
		process.exit(1);
	}
}
