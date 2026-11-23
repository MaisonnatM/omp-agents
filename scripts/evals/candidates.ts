/**
 * Lists landed changes of a repository as eval tasks: each `Land <branch>` merge on the target branch whose branch
 * added or changed root `bun test` files becomes a prompt, its base, and a hidden check, the tests the landing brought.
 *
 * - The prompt is the branch's commit messages, plus the imports the hidden tests make of names the base lacks,
 *   so a run is not failed for naming a new function differently, and the other names and texts the tests share with
 *   the change and the base lacks, such as a setting's key, a tool parameter, or an error message.
 * - A landing is left out when it touches `desktop/` or dependencies, changes more than 300 non-test, non-doc lines,
 *   brings more than 3 test files, or its messages run past 4000 characters.
 * - `--verify` keeps a task only when its hidden check fails at the base and passes at the landed commit, run in one
 *   temporary worktree, and stops at `--limit` verified tasks.
 *
 * Usage:
 *   bun scripts/evals/candidates.ts [--repo <path>] [--scan 200] [--limit 20] [--verify] > scripts/evals/tasks.json
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";
import { parseArgs } from "node:util";
import { git, sh } from "./replay";

export interface EvalTask {
	/** Unique in the set: the landed branch's name, or `pr-<number>` for a merged pull request. */
	id: string;
	/** The repository the task comes from, when it is not the one `run.ts` sits in, such as yampa's checkout. */
	repo?: string;
	base: string;
	landed: string;
	landedAt: string;
	prompt: string;
	/** Test files, relative to the repository, that the runner writes from `landed` after the run. */
	hiddenTests: string[];
	/** The test ids the hidden tests hold, such as pytest node ids, for reading a run's failures against. */
	testIds?: string[];
	/** The command that must exit 0 once the hidden tests are in place. */
	check: string;
}

const MAX_SOURCE_LINES = 300;
const MAX_HIDDEN_TESTS = 3;
const MAX_MESSAGE_CHARS = 4000;
const TEST_FILE = /\.test\.tsx?$/;
const DOC_FILE = /(^docs\/|\.md$|^CHANGELOG)/;
const OFF_LIMITS = /^(desktop\/|package\.json$|bun\.lock$)/;

/** Each `{ a, b as c }` import from a relative module, by resolved module path without extension. */
export function namedImports(source: string, testPath: string): Map<string, string[]> {
	const found = new Map<string, string[]>();
	for (const [, list, from] of source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'](\.{1,2}\/[^"']+)["']/g)) {
		const names = list
			.split(",")
			.map(part => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim())
			.filter(Boolean);
		const module = normalize(join(dirname(testPath), from)).replace(/\.(tsx?|js)$/, "");
		found.set(module, [...(found.get(module) ?? []), ...names]);
	}
	return found;
}

/** Whether `source` exports `name`, by declaration or export list; an `export *` counts as yes. */
export function exportsName(source: string, name: string): boolean {
	const escaped = name.replace(/[$]/g, "\\$");
	if (/export\s*\*\s*from/.test(source)) return true;
	if (new RegExp(`export\\s+(?:declare\\s+)?(?:default\\s+)?(?:async\\s+)?(?:abstract\\s+)?(?:function\\*?|const|let|var|class|interface|type|enum)\\s+${escaped}\\b`).test(source)) return true;
	return [...source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)].some(([, list]) =>
		list!.split(",").some(part => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).at(-1)!.trim() === name),
	);
}

/**
 * Names and quoted texts in `tests`: words of 4 or more characters, and string literals without interpolation that
 * start with a word character and end with one or with sentence punctuation, which leaves out a template's fragments.
 */
export function testTerms(tests: string): { names: Set<string>; texts: Set<string> } {
	const names = new Set([...tests.matchAll(/(?<![\w$])[A-Za-z_$][\w$]{3,}/g)].map(([name]) => name));
	const literals = [...tests.matchAll(/(["'`])((?:(?!\1|\$\{)[^\\\n]|\\.){8,}?)\1/g)].map(match => match[2]!);
	return { names, texts: new Set(literals.filter(text => /^\w(.*[\w.!?)])?$/.test(text))) };
}

/** The prompt for a landing: its commit messages, then the imports of names the base does not export yet, then other new names and texts. */
export function buildPrompt(messages: string, missing: { module: string; names: string[] }[], terms: string[] = []): string {
	const lines = ["Make this change in the repository in the current directory. Its author described it in these commit messages:", "", messages.trim()];
	if (missing.length > 0) {
		lines.push("", "Tests will check it through these imports, so give the new code these names and paths:");
		for (const { module, names } of missing) lines.push(`- import { ${names.join(", ")} } from "${module}"`);
	}
	if (terms.length > 0) {
		lines.push("", "The tests also expect these names and texts, word for word:");
		for (const term of terms) lines.push(`- ${JSON.stringify(term)}`);
	}
	return `${lines.join("\n")}\n`;
}

function show(repo: string, rev: string, path: string): string | null {
	try {
		return git(repo, "show", `${rev}:${path}`);
	} catch {
		return null;
	}
}

function missingImports(repo: string, base: string, landed: string, hidden: string[]): { module: string; names: string[] }[] {
	const missing: { module: string; names: string[] }[] = [];
	for (const test of hidden) {
		const source = show(repo, landed, test) ?? "";
		for (const [module, names] of namedImports(source, test)) {
			if (hidden.some(path => path.replace(/\.tsx?$/, "") === module)) continue;
			const path = [".ts", ".tsx", "/index.ts", ""].map(ext => `${module}${ext}`).find(candidate => show(repo, base, candidate) !== null);
			const atBase = path ? (show(repo, base, path) ?? "") : "";
			const lacking = [...new Set(names)].filter(name => !atBase || !exportsName(atBase, name));
			if (lacking.length > 0) {
				const shown = path ?? `${module}${[".ts", ".tsx"].find(ext => show(repo, landed, `${module}${ext}`) !== null) ?? ".ts"}`;
				const entry = missing.find(m => m.module === shown);
				if (entry) entry.names.push(...lacking.filter(name => !entry.names.includes(name)));
				else missing.push({ module: shown, names: lacking });
			}
		}
	}
	return missing;
}

/**
 * Names and texts the hidden tests use that the landed change adds outside tests and docs and the base never has,
 * such as a setting's key, a tool parameter, or an error message; imported names are left to `missingImports`.
 */
function newTerms(repo: string, base: string, landed: string, hidden: string[], imported: Set<string>): string[] {
	const { names, texts } = testTerms(hidden.map(test => show(repo, landed, test) ?? "").join("\n"));
	const added = git(repo, "diff", "--no-renames", "-U0", base, landed, "--", ".", ...hidden.map(path => `:!${path}`), ":!docs", ":!*.md")
		.split("\n")
		.filter(line => line.startsWith("+") && !line.startsWith("+++"))
		.join("\n");
	const addedWords = new Set(added.match(/[A-Za-z_$][\w$]*/g));
	const fresh = new Set([...[...names].filter(name => !imported.has(name) && addedWords.has(name)), ...[...texts].filter(text => added.includes(text))]);
	return [...fresh].filter(term => !sh(`git grep -q -F ${/^[\w$]+$/.test(term) ? "-w " : ""}-e "$TERM" ${base}`, repo, { TERM: term }).ok);
}

export function candidates(repo: string, scan: number): EvalTask[] {
	const tasks: EvalTask[] = [];
	const rows = git(repo, "log", "--first-parent", "main", "--merges", `-n${scan}`, "--format=%H%x09%P%x09%cs%x09%s").split("\n").filter(Boolean);
	for (const row of rows) {
		const [landed, parents, landedAt, subject] = row.split("\t") as [string, string, string, string];
		const [base, tip] = parents.split(" ") as [string, string];
		const branch = /^Land (\S+)$/.exec(subject)?.[1];
		if (!branch || !tip) continue;
		const changes = git(repo, "diff", "--numstat", "--no-renames", base, landed)
			.split("\n")
			.filter(Boolean)
			.map(line => line.split("\t") as [string, string, string]);
		if (changes.some(([, , path]) => OFF_LIMITS.test(path))) continue;
		const added = new Set(git(repo, "diff", "--name-only", "--no-renames", "--diff-filter=AM", base, landed).split("\n"));
		const hidden = changes.map(([, , path]) => path).filter(path => TEST_FILE.test(path) && added.has(path));
		if (hidden.length === 0 || hidden.length > MAX_HIDDEN_TESTS) continue;
		const sourceLines = changes
			.filter(([, , path]) => !TEST_FILE.test(path) && !DOC_FILE.test(path))
			.reduce((sum, [plus, minus]) => sum + (Number(plus) || 0) + (Number(minus) || 0), 0);
		if (sourceLines === 0 || sourceLines > MAX_SOURCE_LINES) continue;
		const messages = git(repo, "log", "--reverse", "--no-merges", "--format=%B", `${base}..${tip}`)
			.split("\n")
			.filter(line => !/^(test-change|omp-session|co-authored-by|signed-off-by):/i.test(line))
			.join("\n")
			.replace(/\n{3,}/g, "\n\n");
		if (!messages.trim() || messages.length > MAX_MESSAGE_CHARS) continue;
		const imports = missingImports(repo, base, landed, hidden);
		const terms = newTerms(repo, base, landed, hidden, new Set(imports.flatMap(({ names }) => names)));
		tasks.push({
			id: branch,
			base,
			landed,
			landedAt,
			prompt: buildPrompt(messages, imports, terms),
			hiddenTests: hidden,
			check: `bun test ${hidden.map(path => `./${path}`).join(" ")}`,
		});
	}
	return tasks;
}

/** Writes each hidden test as the landed commit has it into `checkout`. */
export function writeHiddenTests(repo: string, task: EvalTask, checkout: string): void {
	for (const path of task.hiddenTests) {
		mkdirSync(dirname(join(checkout, path)), { recursive: true });
		writeFileSync(join(checkout, path), `${git(repo, "show", `${task.landed}:${path}`)}\n`);
	}
}

const CHECK_TIMEOUT_MS = 300_000;

/** Whether the hidden check fails at the base with the tests in place and passes at the landed commit. */
function verify(repo: string, task: EvalTask, worktree: string): { ok: boolean; why: string } {
	const at = (rev: string) => {
		git(worktree, "checkout", "--force", "--quiet", "--detach", rev);
		git(worktree, "clean", "-fdq");
		const install = sh("bun install --frozen-lockfile", worktree);
		if (!install.ok) throw new Error(`bun install at ${rev}: ${install.output}`);
	};
	at(task.base);
	writeHiddenTests(repo, task, worktree);
	if (sh(task.check, worktree, {}, CHECK_TIMEOUT_MS).ok) return { ok: false, why: "hidden check already passes at the base" };
	at(task.landed);
	const landed = sh(task.check, worktree, {}, CHECK_TIMEOUT_MS);
	return landed.ok ? { ok: true, why: "" } : { ok: false, why: `hidden check fails at the landed commit: ${landed.output.slice(-300)}` };
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			repo: { type: "string", default: "." },
			scan: { type: "string", default: "200" },
			limit: { type: "string", default: "20" },
			verify: { type: "boolean", default: false },
		},
	});
	const repo = dirname(git(resolve(values.repo), "rev-parse", "--path-format=absolute", "--git-common-dir"));
	const found = candidates(repo, Number(values.scan));
	console.error(`${found.length} candidate landings`);
	let picked = found.slice(0, Number(values.limit));
	if (values.verify) {
		picked = [];
		const worktree = join(mkdtempSync(join(tmpdir(), "omp-eval-verify-")), "repo");
		git(repo, "worktree", "add", "--quiet", "--detach", worktree, found[0]?.base ?? "HEAD");
		try {
			for (const task of found) {
				if (picked.length >= Number(values.limit)) break;
				const { ok, why } = verify(repo, task, worktree);
				console.error(`${ok ? "keep" : "drop"} ${task.id}${why ? `: ${why}` : ""}`);
				if (ok) picked.push(task);
			}
		} finally {
			git(repo, "worktree", "remove", "--force", worktree);
			rmSync(dirname(worktree), { recursive: true, force: true });
		}
	}
	console.log(JSON.stringify(picked, null, "\t"));
}
