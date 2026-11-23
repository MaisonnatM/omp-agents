/**
 * Scores the harness gates on labeled past tool calls: each case in `cases.json` goes through the real rule function,
 * and the run prints precision and recall per gate plus every case whose verdict differs from its label.
 * `bun scripts/gate-eval/run.ts`
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBash, checkRead } from "../../templates/omp/agent/extensions/bash-guard/rules";
import { located } from "../../templates/omp/agent/extensions/shell/commands";
import { untrustedFetch } from "../../templates/omp/agent/extensions/untrusted-reader/rules";

type Stage = string;
type ToolRun = { name: string; input: Record<string, unknown>; ok: boolean };
// Imported by path, not statically: a static import pulls the extension into `tsc`, where its `@oh-my-pi/pi-coding-agent` import does not resolve.
const { opensLivePr, verificationRefusal }: {
	opensLivePr(words: string[]): boolean;
	verificationRefusal(stage: Stage, runs: ToolRun[], declared: string[][]): string | undefined;
} = await import(join(import.meta.dir, "../../templates/omp/agent/extensions/ship.ts"));

/** A recorded bash call inside a ship_stage case: the tool runs since the session's last edit. */
interface Run {
	name: string;
	ok: boolean;
	command?: string;
	async?: boolean;
}

export interface Case {
	id: string;
	gate: "bash-guard" | "untrusted-reader" | "ship";
	/** The rule the case exercises: `secret`, `hooks`, `port`, `kill`, `push` for bash-guard, `gh` for the reader, `draft` or `verify` for ship. */
	rule: string;
	tool: "bash" | "read" | "ship_stage";
	input: { command?: string; path?: string; stage?: Stage; runs?: Run[] };
	/** `block` for bash-guard and ship, `nudge` for the reader; `allow` when the gate should stay silent. */
	expected: "allow" | "block" | "nudge";
	why: string;
	source: string;
}

export interface GateScore {
	gate: string;
	cases: number;
	truePositives: number;
	falsePositives: number;
	falseNegatives: number;
	precision: number;
	recall: number;
	accuracy: number;
}

export interface Mismatch {
	id: string;
	gate: string;
	expected: string;
	actual: string;
	why: string;
	detail: string;
}

/** Runs one case through its gate. `repo` replaces `{repo}` in commands: a scratch git repository on a feature branch. */
function verdict(c: Case, repo: string): { fired: boolean; detail: string } {
	if (c.gate === "bash-guard") {
		const v = c.tool === "read" ? checkRead(c.input.path ?? "") : checkBash((c.input.command ?? "").replaceAll("{repo}", repo), repo);
		return { fired: v !== undefined, detail: v?.reason ?? "" };
	}
	if (c.gate === "untrusted-reader") {
		const fetch = untrustedFetch(c.input.command ?? "");
		return { fired: fetch !== undefined, detail: fetch ?? "" };
	}
	if (c.rule === "draft") {
		const live = located((c.input.command ?? "").replaceAll("{repo}", repo), repo).some(({ words }) => opensLivePr(words));
		return { fired: live, detail: live ? "opens a PR that is not a draft" : "" };
	}
	const runs: ToolRun[] = (c.input.runs ?? []).map(run => ({ name: run.name, ok: run.ok, input: run.command === undefined ? {} : { command: run.command, async: run.async ?? false } }));
	const refusal = verificationRefusal(c.input.stage ?? "draft_pr", runs, []);
	return { fired: refusal !== undefined, detail: refusal ?? "" };
}

export async function loadCases(): Promise<Case[]> {
	return (await Bun.file(join(import.meta.dir, "cases.json")).json()) as Case[];
}

export function evaluate(cases: Case[]): { scores: GateScore[]; mismatches: Mismatch[] } {
	const repo = mkdtempSync(join(tmpdir(), "gate-eval-"));
	try {
		execFileSync("git", ["init", "-q", "-b", "gate-eval", repo]);
		const tallies = new Map<string, GateScore>();
		const mismatches: Mismatch[] = [];
		for (const c of cases) {
			const { fired, detail } = verdict(c, repo);
			const positive = c.expected !== "allow";
			const s = tallies.get(c.gate) ?? { gate: c.gate, cases: 0, truePositives: 0, falsePositives: 0, falseNegatives: 0, precision: 0, recall: 0, accuracy: 0 };
			s.cases++;
			if (fired && positive) s.truePositives++;
			if (fired && !positive) s.falsePositives++;
			if (!fired && positive) s.falseNegatives++;
			tallies.set(c.gate, s);
			if (fired !== positive) mismatches.push({ id: c.id, gate: c.gate, expected: c.expected, actual: fired ? (c.gate === "untrusted-reader" ? "nudge" : "block") : "allow", why: c.why, detail });
		}
		const scores = [...tallies.values()].map(s => {
			const wrong = s.falsePositives + s.falseNegatives;
			return {
				...s,
				precision: s.truePositives + s.falsePositives === 0 ? 1 : s.truePositives / (s.truePositives + s.falsePositives),
				recall: s.truePositives + s.falseNegatives === 0 ? 1 : s.truePositives / (s.truePositives + s.falseNegatives),
				accuracy: (s.cases - wrong) / s.cases,
			};
		});
		return { scores, mismatches };
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	const { scores, mismatches } = evaluate(await loadCases());
	const pct = (n: number) => `${(n * 100).toFixed(0)}%`.padStart(5);
	console.log("gate              cases  precision  recall  accuracy");
	for (const s of scores) console.log(`${s.gate.padEnd(17)} ${String(s.cases).padStart(5)}  ${pct(s.precision).padStart(9)}  ${pct(s.recall).padStart(6)}  ${pct(s.accuracy).padStart(8)}`);
	console.log(`\n${mismatches.length} mismatch${mismatches.length === 1 ? "" : "es"}`);
	for (const m of mismatches) console.log(`- ${m.id} (${m.gate}): expected ${m.expected}, got ${m.actual}. ${m.why}${m.detail ? `\n  gate said: ${m.detail.slice(0, 240)}` : ""}`);
}
