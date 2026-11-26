import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Rule } from "./rule";
import { run } from "./run";

/** Flags each line of a `.ts` file that says `BAD`. */
const bad: Rule = {
	id: "no-bad",
	why: "Say good.",
	appliesTo: path => path.endsWith(".ts"),
	check: source => source.split("\n").flatMap((text, i) => (text.includes("BAD") ? [{ line: i + 1, message: "says BAD" }] : [])),
};

let repo = "";
afterEach(() => rmSync(repo, { recursive: true, force: true }));

function git(...args: string[]) {
	const done = Bun.spawnSync(["git", "-C", repo, ...args]);
	if (done.exitCode !== 0) throw new Error(done.stderr.toString());
}

/** A scratch repository whose HEAD holds `a.ts` with `lines` and the baseline those lines give. */
function scratch(lines: string) {
	repo = mkdtempSync(join(tmpdir(), "lint-ratchet-"));
	git("init", "-q", "-b", "main");
	git("config", "user.email", "t@example.com");
	git("config", "user.name", "t");
	writeFileSync(join(repo, "a.ts"), lines);
	git("add", ".");
	git("commit", "-q", "-m", "start");
	run(repo, { write: true, base: "HEAD" }, [bad]);
	git("add", ".");
	git("commit", "-q", "-m", "baseline", "-m", "lint-baseline: the starting findings");
}

const check = (base = "HEAD") => run(repo, { write: false, base }, [bad]);

test("findings the baseline lists pass, and a new one fails with its line", () => {
	scratch("BAD\nok\n");
	expect(check().ok).toBe(true);
	writeFileSync(join(repo, "a.ts"), "BAD\nok\nBAD\n");
	const report = check();
	expect(report.ok).toBe(false);
	expect(report.lines).toContain("  a.ts:3 says BAD");
	expect(report.lines.at(-1)).toBe("RESULT: FAIL (new findings)");
});

test("a new file's findings fail even though the file has no baseline entry", () => {
	scratch("ok\n");
	writeFileSync(join(repo, "b.ts"), "BAD\n");
	expect(check().lines.at(-1)).toBe("RESULT: FAIL (new findings)");
});

test("a fixed finding fails until --write tightens the baseline", () => {
	scratch("BAD\nBAD\n");
	writeFileSync(join(repo, "a.ts"), "BAD\n");
	expect(check().lines.at(-1)).toBe("RESULT: FAIL (stale baseline)");
	expect(run(repo, { write: true, base: "HEAD" }, [bad]).ok).toBe(true);
});

test("raising the baseline above the base fails unless a commit says why", () => {
	scratch("BAD\n");
	writeFileSync(join(repo, "a.ts"), "BAD\nBAD\n");
	expect(run(repo, { write: true, base: "HEAD" }, [bad]).lines.at(-1)).toBe("RESULT: FAIL (raised baseline)");
	git("commit", "-qam", "more");
	expect(check("HEAD~1").lines.at(-1)).toBe("RESULT: FAIL (raised baseline)");
	git("commit", "-q", "--allow-empty", "-m", "why\n\nlint-baseline: the rule is new and these predate it");
	expect(check("HEAD~2").ok).toBe(true);
});
