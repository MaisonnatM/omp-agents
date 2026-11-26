/**
 * Runs the repository's own lint rules, `RULES` in `scripts/lint/rules.ts`, on every tracked or new file, and holds them to `lint-baseline.json`.
 * The baseline counts the findings each rule may still have in each file; a count may fall but never grow, so a new rule lands with its old findings listed and every later change only removes them.
 *
 * `bun scripts/lint/run.ts [--write] [--base=<ref>]`, which `bun run lint` runs after Biome:
 * - fails when a file has more findings than its baseline count, printing that file's findings;
 * - fails when a count fell and the baseline still holds the old one: `--write` rewrites it to today's counts;
 * - fails when the baseline raises a count above the one at `--base` (default `HEAD`; `land` passes `$LAND_BASE`), unless a commit in `<base>..HEAD` has a `lint-baseline: <reason>` line.
 * Its last line is `RESULT: PASS` or `RESULT: FAIL (<what failed>)`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Change, type Counts, compare, parseCounts, sorted, tally } from "./ratchet";
import type { Finding, Rule } from "./rule";
import { RULES } from "./rules";

export const BASELINE = "lint-baseline.json";
export const CANARIES = "scripts/lint/canaries/";
const REASON = /^lint-baseline:[ \t]*\S/m;

function git(cwd: string, args: string[]): { ok: boolean; out: string; err: string } {
	const done = Bun.spawnSync(["git", "-C", cwd, ...args]);
	return { ok: done.exitCode === 0, out: done.stdout.toString(), err: done.stderr.toString().trim() };
}

/** Every file git tracks or would add in `root`, canaries left out, since each canary breaks its rule on purpose. */
export function lintedFiles(root: string): string[] {
	const listed = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
	if (!listed.ok) throw new Error(`git ls-files failed: ${listed.err}`);
	const files = new Set(listed.out.split("\0").filter(file => file !== "" && !file.startsWith(CANARIES)));
	return [...files].filter(file => existsSync(join(root, file))).sort();
}

export function findings(root: string, files: string[], rules: Rule[]): (Finding & { rule: string; file: string })[] {
	return rules.flatMap(rule =>
		files.filter(file => rule.appliesTo(file)).flatMap(file => rule.check(readFileSync(join(root, file), "utf8"), file).map(found => ({ ...found, rule: rule.id, file }))),
	);
}

function baselineAt(root: string, base: string): Counts {
	if (!git(root, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]).ok) throw new Error(`base ref ${base} does not exist; fetch it or pass --base=<ref>`);
	const shown = git(root, ["show", `${base}:${BASELINE}`]);
	return shown.ok ? parseCounts(shown.out, `${BASELINE} at ${base}`) : {};
}

const describe = (change: Change) => `${change.file} ${change.rule}: ${change.from} → ${change.to}`;

/** Runs the check in `root` and returns its report lines, the last being the verdict, and whether it passed. */
export function run(root: string, options: { write: boolean; base: string }, rules: Rule[] = RULES): { lines: string[]; ok: boolean } {
	const found = findings(root, lintedFiles(root), rules);
	const actual = tally(found);
	const path = join(root, BASELINE);
	if (options.write) writeFileSync(path, `${JSON.stringify(sorted(actual), null, "\t")}\n`);
	const baseline = existsSync(path) ? parseCounts(readFileSync(path, "utf8"), BASELINE) : {};
	const lines: string[] = [];
	const failed: string[] = [];

	const { grew, fell } = compare(baseline, actual);
	if (grew.length > 0) {
		failed.push("new findings");
		for (const change of grew) {
			const why = rules.find(rule => rule.id === change.rule)?.why ?? "";
			lines.push(`${change.file}: ${change.rule} has ${change.to} findings, ${change.from} allowed. ${why}`);
			for (const f of found.filter(f => f.rule === change.rule && f.file === change.file)) lines.push(`  ${f.file}:${f.line} ${f.message}`);
		}
	}
	if (fell.length > 0) {
		failed.push("stale baseline");
		lines.push(`${BASELINE} allows more findings than are left; run bun scripts/lint/run.ts --write and commit it:`, ...fell.map(change => `  ${describe(change)}`));
	}

	const raised = compare(baselineAt(root, options.base), baseline).grew;
	const log = git(root, ["log", "--format=%B", `${options.base}..HEAD`]);
	if (raised.length > 0 && !(log.ok && REASON.test(log.out))) {
		failed.push("raised baseline");
		lines.push(
			`${BASELINE} raises counts above ${options.base}; fix the new findings instead, or say why in a commit line "lint-baseline: <reason>":`,
			...raised.map(change => `  ${describe(change)}`),
		);
	}

	const total = Object.values(actual).reduce((sum, byFile) => sum + Object.values(byFile).reduce((a, b) => a + b, 0), 0);
	lines.push(`${rules.length} rules, ${total} baseline findings left.`);
	lines.push(failed.length === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failed.join(", ")})`);
	return { lines, ok: failed.length === 0 };
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const base = args.find(arg => arg.startsWith("--base="))?.slice("--base=".length) || "HEAD";
	const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).out.trim();
	const report = run(root, { write: args.includes("--write"), base });
	for (const line of report.lines) console.log(line);
	process.exit(report.ok ? 0 : 1);
}
