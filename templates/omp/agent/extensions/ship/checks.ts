import { commands, positionals } from "../shell/commands";
import type { Contract, ShipState, Stage } from "./stages";

/** Whether `path` names a file inside the repository: relative, and never climbing out through `..`. */
export function repoRelative(path: string): boolean {
	return /\S/.test(path) && !/^(?:[\\/~]|[A-Za-z]:)/.test(path) && !path.split(/[\\/]/).includes("..");
}

/** The test files `contract` plans to change, unless a constraint names `test-change`, the reason an existing test may change on purpose. */
export function plannedTestEdits(contract: Contract): string[] {
	if (contract.constraints.some(constraint => /test-change/i.test(constraint))) return [];
	return contract.files_to_change.filter(path => /\.test\.tsx?$/.test(path));
}

/** Why `contract` may not stand for a run on `issue`: a run with a ticket drafts its contract from that ticket, and names it as the source. */
export function contractSourceRefusal(contract: Contract, issue: string | undefined): string | undefined {
	if (!issue || contract.source?.trim().toUpperCase() === issue.trim().toUpperCase()) return undefined;
	const found = contract.source ? `names ${contract.source} as its source` : "names no source";
	return `The contract is not recorded: this run ships ${issue}, but the contract ${found}. Draft its goal, files_to_change, and done_when from ${issue}'s description and acceptance criteria, then record it again with source: "${issue}".`;
}

/** The stages that claim the change works, so each needs a passing check after the last file change. */
export const VERIFIED_STAGES: readonly Stage[] = ["draft_pr", "ready_gate"];
/** Tools whose call may change files in the checkout; a `task` subagent may edit, so it counts too. */
const EDIT_TOOLS: Record<string, true> = { edit: true, write: true, ast_edit: true, notebook: true, task: true };
/** A package script that checks the change, such as `test`, `test:agent`, `typecheck`, or `lint`. */
const CHECK_SCRIPT = /^(?:test|typecheck|lint|check|tsc|verify)(?:[:._-]|$)/;
/** A program that is itself a check. */
const CHECK_PROGRAMS: Record<string, true> = { tsc: true, vitest: true, jest: true, pytest: true, eslint: true, biome: true, mypy: true, ruff: true };
/** Words in front of the program they run, which a check may sit behind. */
const PREFIXES: Record<string, true> = { time: true, nice: true, nohup: true, command: true, exec: true };

/** One tool call of the session, with whether its result was an error. */
export interface ToolRun {
	name: string;
	input: Record<string, unknown>;
	ok: boolean;
}

/** The fields of a session entry's message that `toolRuns` reads; omp's `SessionEntry` holds them. */
interface BranchMessage {
	role: string;
	content?: unknown;
	toolName?: string;
	toolCallId?: string;
	isError?: boolean;
}

/** The tool calls in `entries`, a session branch, in the order their results arrived. */
export function toolRuns(entries: readonly { type: string; message?: BranchMessage }[]): ToolRun[] {
	const inputs = new Map<string, Record<string, unknown>>();
	const runs: ToolRun[] = [];
	for (const { type, message } of entries) {
		if (type !== "message" || !message) continue;
		if (message.role === "assistant" && Array.isArray(message.content)) {
			for (const block of message.content) {
				if (block?.type === "toolCall" && typeof block.id === "string") inputs.set(block.id, block.arguments ?? {});
			}
		} else if (message.role === "toolResult" && message.toolName) {
			runs.push({ name: message.toolName, input: inputs.get(message.toolCallId ?? "") ?? {}, ok: message.isError !== true });
		}
	}
	return runs;
}

/** The single commands a repository's `.omp/land.json` lists as checks, each as its words; a shell line that runs several commands is left out. */
export function declaredChecks(landJson: string | undefined): string[][] {
	if (!landJson) return [];
	let checks: unknown;
	try {
		checks = (JSON.parse(landJson) as { checks?: unknown }).checks;
	} catch {
		return [];
	}
	if (!Array.isArray(checks)) return [];
	return checks.flat().flatMap(check => {
		if (typeof check !== "string") return [];
		const ran = commands(check);
		return ran.length === 1 && ran[0].length >= 2 ? ran : [];
	});
}

/** Whether a command's `words` run a test, typecheck, or lint: one `declared` by the repository, a package `test` script or one named like a check, or a checker such as `tsc`; `heavy.py` and prefixes like `time` are looked through. */
export function isCheckCommand(words: string[], declared: string[][]): boolean {
	let w = words;
	while (w.length > 0 && PREFIXES[w[0]]) w = w.slice(1);
	if (w[0] === "timeout") w = w.slice(2);
	const heavy = w.findIndex(word => word.endsWith("heavy.py"));
	if (heavy !== -1 && heavy <= 1) {
		const rest = w.slice(heavy + 1);
		// The shell applies redirections such as `2>&1`, so heavy.py gets the script alone.
		const script = positionals(rest);
		return script.length === 1 ? commands(script[0]).some(inner => isCheckCommand(inner, declared)) : isCheckCommand(rest, declared);
	}
	if (w.length === 0) return false;
	if (declared.some(check => check.every((word, i) => w[i] === word))) return true;
	const [run, sub = "", script = ""] = w;
	const name = run.split("/").pop() ?? run;
	if (CHECK_PROGRAMS[name]) return true;
	if (/^(?:bunx|npx|pnpx|uvx)$/.test(name)) return isCheckCommand(w.slice(1), declared);
	if (/^(?:bun|npm|pnpm|yarn)$/.test(name)) return sub === "test" || (sub === "run" ? CHECK_SCRIPT.test(script) : name !== "bun" && name !== "npm" && CHECK_SCRIPT.test(sub));
	if (name === "cargo") return /^(?:test|check|clippy|nextest)$/.test(sub);
	if (name === "go") return sub === "test" || sub === "vet";
	if (name === "make" || name === "just") return CHECK_SCRIPT.test(sub);
	if (/^python3?$/.test(name)) return sub === "-m" && CHECK_PROGRAMS[script] === true;
	if (name === "astro") return sub === "check";
	if (name === "playwright") return sub === "test";
	if (name === "uv") return sub === "run" && isCheckCommand(w.slice(2), declared);
	return false;
}

/**
 * Why `stage` may not be recorded yet, or `undefined` when it may: a stage that claims the change works needs a bash check,
 * such as the tests or the typecheck, that exited 0 in this session after the last tool call that may have changed files.
 */
export function verificationRefusal(stage: Stage, runs: ToolRun[], declared: string[][]): string | undefined {
	let lastEdit: ToolRun | undefined;
	let checked = false;
	for (const run of runs) {
		if (EDIT_TOOLS[run.name] && (run.ok || run.name === "task")) {
			lastEdit = run;
			checked = false;
		} else if (run.name === "bash" && run.ok && run.input.async !== true && typeof run.input.command === "string" && commands(run.input.command).some(words => isCheckCommand(words, declared))) {
			checked = true;
		}
	}
	if (checked) return undefined;
	const since = lastEdit ? ` since the last \`${lastEdit.name}\` call` : "";
	const checks = declared.length > 0 ? `, such as ${declared.map(words => `\`${words.join(" ")}\``).join(", ")} from .omp/land.json,` : "";
	return `${stage} is not recorded: no test, typecheck, or lint command passed in this session${since}, so nothing shows the change works. Run the repository's checks${checks} in this session with bash and without async, fix what fails, then record ${stage} again and quote each check's result line in your report.`;
}

/** One commit of the branch with the files it changes. */
export interface BranchCommit {
	sha: string;
	files: string[];
}

/** The commits of `git log --reverse --no-merges --format=%x00%h --name-only`, oldest first. */
export function parseBranchLog(stdout: string): BranchCommit[] {
	return stdout.split("\0").slice(1).map(chunk => {
		const [sha, ...files] = chunk.split("\n").map(line => line.trim()).filter(Boolean);
		return { sha, files };
	});
}

/** Whether `path` is a test file by its name or directory. */
export function isTestFile(path: string): boolean {
	return /(?:^|\/)(?:tests?|__tests__|spec)\/|[._-](?:test|spec)\.[^/]+$|(?:^|\/)test_[^/]+\.py$/.test(path);
}

/**
 * Why a branch with a `test_first` contract may not get its draft PR, or `undefined` when it may: a commit changing only the test
 * `test_first` names, or any test file when it names no path the branch changes, must come before the first commit changing code; Markdown is not code.
 */
export function testFirstRefusal(contract: Contract, commits: BranchCommit[], base: string): string | undefined {
	const test = contract.test_first;
	if (!test) return undefined;
	const changed = [...new Set(commits.flatMap(commit => commit.files))];
	const named = changed.filter(path => test.includes(path));
	const isTest = named.length > 0 ? (path: string) => named.includes(path) : isTestFile;
	const isCode = (path: string) => !isTestFile(path) && !/\.mdx?$/i.test(path);
	const firstTest = commits.findIndex(commit => commit.files.some(isTest) && !commit.files.some(isCode));
	const firstCode = commits.findIndex(commit => commit.files.some(isCode));
	if (firstTest !== -1 && (firstCode === -1 || firstTest < firstCode)) return undefined;
	const tests = (named.length > 0 ? named : changed.filter(isTestFile)).map(path => `\`${path}\``).join(", ");
	const found = firstCode === -1 || !tests
		? `no commit on this branch changes ${tests || "a test file"} on its own`
		: `${commits[firstCode].sha} changes code before any commit that changes only ${tests}`;
	return `draft_pr is not recorded: the contract's test_first is "${test}", but ${found}. A bug fix commits its failing test first, so the history shows the test failing before the fix. Run \`git reset --soft ${base}\`, commit only the test (\`git commit -m "<test subject>" -- <test file>\`), check that it fails, commit the rest, then record draft_pr again.`;
}

/** Lockfiles and generated files, which a change rewrites as a side effect of the files it plans. */
const SIDE_EFFECT_FILE = /(?:^|\/)(?:bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|uv\.lock|poetry\.lock|Pipfile\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$|(?:^|\/)(?:__generated__|generated|__snapshots__)\/|\.(?:generated|gen)\.[^/]+$|\.snap$/;

/** Whether `path` is `entry`, lies under the directory `entry`, or matches `entry` as a glob, where `**` spans directories and `*` and `?` do not. */
export function inScope(path: string, entry: string): boolean {
	const glob = entry.trim().replace(/^\.\//, "").replace(/\/+$/, "");
	const pattern = glob.replace(/\*\*\/|\*\*|\*|\?|[.+^${}()|[\]\\]/g, token => ({ "**/": "(?:.*/)?", "**": ".*", "*": "[^/]*", "?": "[^/]" })[token] ?? `\\${token}`);
	return new RegExp(`^${pattern}(?:/.*)?$`).test(path);
}

/** The files of `changed` outside `contract`'s files_to_change, apart from lockfiles and generated files; none when a constraint names `scope-change`. */
export function strayFiles(contract: Contract, changed: string[]): string[] {
	if (contract.constraints.some(constraint => /scope-change/i.test(constraint))) return [];
	return changed.filter(path => !SIDE_EFFECT_FILE.test(path) && !contract.files_to_change.some(entry => inScope(path, entry)));
}

/** Why `stage` may not be recorded for a branch changing `changed` against `base`, or `undefined` when every file is one the contract plans. */
export function scopeRefusal(stage: Stage, contract: Contract, changed: string[], base: string): string | undefined {
	const stray = strayFiles(contract, changed);
	if (stray.length === 0) return undefined;
	return `${stage} is not recorded: the branch changes ${stray.map(path => `\`${path}\``).join(", ")} against ${base}, outside the contract's files_to_change. Take them out of the branch, undoing each one's changes against ${base} and deleting the ones it adds, then commit; or, when the change needs them, record the contract again with ship_stage({contract}), listing them or a glob that covers them in files_to_change, or adding a constraint \`scope-change: <why the change grew>\`. Then record ${stage} again.`;
}

/** `rejected` with `approach` appended, unless it already holds it, ignoring case and spacing. */
export function withRejected(rejected: string[] | undefined, approach: string): string[] {
	const key = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
	const list = rejected ?? [];
	return list.some(entry => key(entry) === key(approach)) ? list : [...list, approach.trim()];
}

/** The contract and the rejected approaches as the agent reads them, or `undefined` when the run recorded neither. */
export function planBrief(s: Pick<ShipState, "contract" | "rejected">): string | undefined {
	const lines: string[] = [];
	const list = (label: string, items: string[]) => {
		if (items.length > 0) lines.push(`${label}:`, ...items.map(item => `- ${item}`));
	};
	if (s.contract) {
		lines.push(`Contract goal: ${s.contract.goal}`);
		list("Constraints", s.contract.constraints);
		list("Files to change", s.contract.files_to_change);
		lines.push(`Test first: ${s.contract.test_first ?? "none"}`);
		list("Done when", s.contract.done_when);
	}
	list("Rejected approaches, never to propose again", s.rejected ?? []);
	return lines.length > 0 ? lines.join("\n") : undefined;
}
