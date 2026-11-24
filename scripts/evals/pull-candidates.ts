/**
 * Lists merged GitHub pull requests of a Python repository as eval tasks, for a repository whose history has no
 * `Land` merges, such as yampa: each pull request that names a Linear ticket and changes tests becomes the ticket as
 * the prompt, the commit before its merge as the base, and the test files it added or changed as the hidden tests.
 *
 * - A pull request is kept when it names a ticket (`ENG-123`), changes Python under `--package` and a Python test
 *   under `tests/`, changes fewer than `--max-lines` lines outside `tests/`, and adds no migration.
 *   Picks run newest first, at most `--per-folder` per folder of the package until that runs short.
 * - The prompt is the ticket's title and description from `--tickets`, a JSON object keyed by ticket id that the
 *   calling session fills from Linear, since a script cannot reach it, or the pull request's title for a ticket missing
 *   there; then, under `## What the change did`, the pull request's description, so the prompt specifies what the
 *   hidden tests check. The description loses its code blocks, images, checkboxes, and every line that names a hidden
 *   test, a hidden file, or the pull request. A prompt that still names one is dropped.
 * - `--tickets-needed` prints the ticket ids of every kept pull request in pick order, to fill `--tickets` from.
 * - `--verify` runs the hidden test modules at the base with the hidden tests in place and at the merge commit, in one
 *   temporary clone, and keeps as `testIds` only the tests that fail at the base and pass at the merge commit; the
 *   check then runs only those. A task with none is dropped, and the run stops at `--limit` verified tasks.
 *
 * Usage:
 *   bun scripts/evals/pull-candidates.ts --repo ~/code/yampa --github yampa-ai/yampa [--tickets t.json] [--verify] > ~/.cache/omp-evalset/yampa-20.json
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type EvalTask, passedTests, writeHiddenTests } from "./candidates";
import { git, sh } from "./replay";

export interface PullFile {
	filename: string;
	status: string;
	additions: number;
	deletions: number;
}

export interface Pull {
	number: number;
	title: string;
	branch: string;
	body: string;
	mergedAt: string;
	mergeCommit: string;
}

const TICKET = /\bENG-\d+\b/i;

/** The Linear ticket a pull request names in its title, branch, or body, upper-cased; null when it names none. */
export function ticketOf(pull: Pick<Pull, "title" | "branch" | "body">): string | null {
	for (const text of [pull.title, pull.branch, pull.body]) {
		const match = text.match(TICKET);
		if (match) return match[0].toUpperCase();
	}
	return null;
}

const isTest = (path: string) => path.startsWith("tests/");

/** Why a pull request cannot be an eval task, or null when it can. */
export function rejection(pull: Pull, files: PullFile[], pkg: string, maxLines: number): string | null {
	if (!ticketOf(pull)) return "names no ticket";
	if (files.some(file => /(^|\/)(migrations|alembic)\//.test(file.filename))) return "adds a migration";
	if (!files.some(file => file.filename.startsWith(`${pkg}/`) && file.filename.endsWith(".py"))) return `changes no Python under ${pkg}/`;
	if (!files.some(file => isTest(file.filename) && file.filename.endsWith(".py") && file.status !== "removed")) return "adds or changes no test";
	const lines = files.filter(file => !isTest(file.filename)).reduce((sum, file) => sum + file.additions + file.deletions, 0);
	if (lines >= maxLines) return `changes ${lines} lines outside tests/`;
	return null;
}

/** The folder under `pkg/` with the most changed lines, such as `agents` for `yampa/agents/`. */
export function domainOf(files: PullFile[], pkg: string): string {
	const lines = new Map<string, number>();
	for (const file of files) {
		const parts = file.filename.split("/");
		if (parts[0] !== pkg || parts.length < 2) continue;
		const folder = parts.length > 2 ? parts[1]! : "(root)";
		lines.set(folder, (lines.get(folder) ?? 0) + file.additions + file.deletions);
	}
	return [...lines].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "(none)";
}

/**
 * The commit a pull request started from on the target branch: the first parent of its merge commit, which is
 * the branch before it for a merge commit and for a squash merge, whose subject ends with `(#<number>)`.
 * A rebase merge's last commit has the pull request's own commits behind it, so it has no single base: null.
 */
export function baseOf(merge: { parents: string[]; subject: string }, number: number): string | null {
	if (merge.parents.length > 1) return merge.parents[0]!;
	if (merge.parents.length === 1 && merge.subject.trimEnd().endsWith(`(#${number})`)) return merge.parents[0]!;
	return null;
}

/**
 * The pytest node ids a test file holds: module-level `test_` functions and `test_` methods of `Test` classes,
 * as `path::name` and `path::Class::name`. A file that is not a test module, such as `conftest.py`, holds none.
 */
export function testNodeIds(path: string, source: string): string[] {
	if (!/(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(path)) return [];
	const ids: string[] = [];
	let cls: { name: string; indent: number } | null = null;
	for (const line of source.split("\n")) {
		const code = line.trimStart();
		const indent = line.length - code.length;
		if (cls && code && indent <= cls.indent && !code.startsWith("@") && !code.startsWith("#")) cls = null;
		const klass = line.match(/^(\s*)class\s+(Test\w*)\s*[(:]/);
		if (klass) {
			cls = { name: klass[2]!, indent: klass[1]!.length };
			continue;
		}
		const fn = line.match(/^(\s*)(?:async\s+)?def\s+(test\w*)\s*\(/);
		if (!fn) continue;
		if (fn[1]!.length === 0) ids.push(`${path}::${fn[2]}`);
		else if (cls && fn[1]!.length > cls.indent) ids.push(`${path}::${cls.name}::${fn[2]}`);
	}
	return ids;
}

type Hidden = { files: string[]; testIds: string[] };

/**
 * What a merged pull request's description says the change did: its body without code blocks, images, HTML comments,
 * checkboxes, or the review bot's markup, without any line that names a hidden test, a hidden file, or the pull
 * request, and without the sections that leaves empty; headings go one level down to sit under the prompt's own.
 */
export function changeSummary(body: string, hidden: Hidden, pr: number): string {
	const lines = body
		.replace(/```[\s\S]*?```/g, "")
		.replace("<!-- CURSOR_SUMMARY -->", "## Review bot summary\n")
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<sup>[\s\S]*?<\/sup>/g, "")
		.replace(/<img\b[^>]*>|!\[[^\]]*\]\([^)]*\)/g, "")
		.split("\n")
		.map(line => line.replace(/^>\s?/, "").trimEnd())
		.filter(line => !/^\s*[-*] \[[ xX]\]|^\[!\w+\]$|^-{3,}$/.test(line) && leaks(line, hidden, pr).length === 0);
	return lines
		.join("\n")
		.split(/^(?=#{1,6} )/m)
		.filter(section => section.replace(/^#{1,6} .*/, "").trim())
		.join("")
		.replace(/^(#{1,5}) /gm, "#$1 ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** The prompt a run gets: what to do, the ticket with Linear's mention tags cut to their labels, then what the change did. */
export function ticketPrompt(ticket: string, text: string, change: string): string {
	const body = text.replace(/<[\w-]+\b[^>]*\blabel="([^"]*)"[^>]*\/>/g, "$1").trim();
	const done = change ? `\n\n## What the change did\n\n${change}` : "";
	return `Do Linear ticket ${ticket} in the repository in the current directory: change the code and add or update its tests. You cannot reach Linear or GitHub.\n\n${body}${done}\n`;
}

/** What in a prompt gives away the solution: a hidden test's name, a hidden file's path, the pull request, or a diff. */
export function leaks(prompt: string, hidden: { files: string[]; testIds: string[] }, pr: number): string[] {
	const found = new Set<string>();
	for (const id of hidden.testIds) {
		const test = id.split("::").at(-1)!;
		if (new RegExp(`\\b${test}\\b`).test(prompt)) found.add(test);
	}
	for (const file of hidden.files) if (prompt.includes(file) || prompt.includes(file.split("/").at(-1)!)) found.add(file);
	if (new RegExp(`(#|pull/)${pr}\\b`).test(prompt)) found.add(`#${pr}`);
	if (/^```|^diff --git|^@@ /m.test(prompt)) found.add("code block or diff");
	return [...found];
}

/**
 * Every item in pick order: first at most `perFolder` from each folder, in the given order, then the rest in
 * the same order, so the first picks cover many parts of the code before one repeats.
 */
export function spread<T extends { domain: string }>(items: T[], perFolder: number): T[] {
	const taken = new Map<string, number>();
	const first = items.filter(item => {
		const count = taken.get(item.domain) ?? 0;
		taken.set(item.domain, count + 1);
		return count < perFolder;
	});
	return [...first, ...items.filter(item => !first.includes(item))];
}

async function ghJson<T>(path: string): Promise<T> {
	const proc = Bun.spawn(["gh", "api", path], { stdout: "pipe", stderr: "pipe" });
	const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	if (code !== 0) throw new Error(`gh api ${path}: ${err}`);
	return JSON.parse(out) as T;
}

function spawnText(command: string[], cwd: string): string {
	const run = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
	return run.exitCode === 0 ? run.stdout.toString() : "";
}

const VERIFY_TIMEOUT_MS = 900_000;

const quote = (arg: string) => `'${arg.replaceAll("'", `'\\''`)}'`;

/** The hidden tests that fail at the base with the hidden tests in place and pass at the merge commit, by pytest node id. */
function failToPass(repo: string, task: EvalTask, clone: string): string[] {
	const passedAt = (rev: string) => {
		git(clone, "fetch", "--quiet", "--no-tags", repo, rev);
		git(clone, "checkout", "--force", "--quiet", "--detach", rev);
		// The virtual environment stays, so each check only syncs what changed.
		git(clone, "clean", "-fdxq", "-e", ".venv");
		if (rev === task.base) writeHiddenTests(repo, task, clone);
		const { output } = sh(task.check, clone, {}, VERIFY_TIMEOUT_MS);
		// A run that never reached pytest's last line, such as on a failed sync, would count every test as failing.
		if (!/\b(passed|failed|errors?|no tests ran)\b.* in [\d.]+s/.test(output)) throw new Error(`${task.id}: pytest did not finish at ${rev}: ${output.slice(-400)}`);
		return passedTests(output);
	};
	const atBase = passedAt(task.base);
	return [...passedAt(task.landed)].filter(id => !atBase.has(id));
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			repo: { type: "string", default: join(homedir(), "code", "yampa") },
			github: { type: "string", default: "yampa-ai/yampa" },
			branch: { type: "string", default: "main" },
			package: { type: "string", default: "yampa" },
			pages: { type: "string", default: "8" },
			limit: { type: "string", default: "20" },
			"max-lines": { type: "string", default: "400" },
			"per-folder": { type: "string", default: "2" },
			tickets: { type: "string" },
			"tickets-needed": { type: "boolean", default: false },
			check: { type: "string" },
			verify: { type: "boolean", default: false },
		},
	});
	const repo = resolve(values.repo);
	// The main checkout's compose file starts its database container or leaves it running; a clone's own compose
	// file can differ at an old base and recreate the container. TEST_GROUP gives the run its own test database.
	// `-rfEp` lists each test's outcome by node id, which `--verify` and a run's share read; a module that fails to
	// import at the base must not stop the others.
	const check =
		values.check ??
		`docker compose -f ${join(repo, "compose.yml")} up -d db >/dev/null && touch envs/local.env envs/shared-secrets.env && TEST_GROUP=evals DB_HOST=localhost uv run --quiet --group dev pytest -p no:cacheprovider -q -rfEp --continue-on-collection-errors {tests}`;
	const tickets: Record<string, { title: string; description: string }> = values.tickets ? JSON.parse(readFileSync(values.tickets, "utf8")) : {};

	type Raw = { number: number; title: string; body: string | null; head: { ref: string }; merged_at: string | null; merge_commit_sha: string };
	const raw: Raw[] = [];
	for (let page = 1; page <= Number(values.pages); page++) {
		raw.push(...(await ghJson<Raw[]>(`repos/${values.github}/pulls?state=closed&base=${values.branch}&sort=updated&direction=desc&per_page=100&page=${page}`)));
	}
	const pulls: Pull[] = raw
		.filter(pr => pr.merged_at && ticketOf({ title: pr.title, branch: pr.head.ref, body: pr.body ?? "" }))
		.map(pr => ({ number: pr.number, title: pr.title, branch: pr.head.ref, body: pr.body ?? "", mergedAt: pr.merged_at!, mergeCommit: pr.merge_commit_sha }))
		.filter(pr => spawnText(["git", "cat-file", "-t", pr.mergeCommit], repo).trim() === "commit")
		.sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
	const files: PullFile[][] = [];
	for (let i = 0; i < pulls.length; i += 8) {
		files.push(...(await Promise.all(pulls.slice(i, i + 8).map(pull => ghJson<PullFile[]>(`repos/${values.github}/pulls/${pull.number}/files?per_page=100`)))));
	}
	// A ticket split over several pull requests asks for more than any one of them did, so none of them is a task.
	const perTicket = Map.groupBy(pulls, pull => ticketOf(pull)!);
	const eligible = pulls.flatMap((pull, i) => {
		const changed = files[i]!;
		if (perTicket.get(ticketOf(pull)!)!.length > 1 || rejection(pull, changed, values.package, Number(values["max-lines"]))) return [];
		const [parents = "", subject = ""] = git(repo, "log", "-1", "--format=%P%n%s", pull.mergeCommit).split("\n");
		const base = baseOf({ parents: parents.split(" ").filter(Boolean), subject }, pull.number);
		return base ? [{ pull, files: changed, base, domain: domainOf(changed, values.package) }] : [];
	});
	const ordered = spread(eligible, Number(values["per-folder"]));
	console.error(`${pulls.length} merged pull requests name a ticket; ${eligible.length} qualify`);
	if (values["tickets-needed"]) {
		console.log(ordered.map(({ pull }) => ticketOf(pull)).join("\n"));
		process.exit(0);
	}

	const picked: EvalTask[] = [];
	const clone = join(mkdtempSync(join(tmpdir(), "omp-eval-verify-")), "repo");
	if (values.verify) git(tmpdir(), "init", "--quiet", clone);
	try {
		for (const { pull, files: changed, base } of ordered) {
			if (picked.length >= Number(values.limit)) break;
			const ticket = ticketOf(pull)!;
			const hiddenTests = changed.filter(file => isTest(file.filename) && file.status !== "removed").map(file => file.filename);
			const testIds = hiddenTests.flatMap(file => testNodeIds(file, spawnText(["git", "show", `${pull.mergeCommit}:${file}`], repo)));
			const testFiles = hiddenTests.filter(file => testIds.some(id => id.startsWith(`${file}::`)));
			const hidden = { files: hiddenTests, testIds };
			const known = tickets[ticket];
			const text = known ? `${known.title}\n\n${known.description}` : pull.title.replace(/\s*\(ENG-\d+\)\s*/i, " ").trim();
			const prompt = ticketPrompt(ticket, text, changeSummary(pull.body, hidden, pull.number));
			const leaked = leaks(prompt, hidden, pull.number);
			const id = `pr-${pull.number}`;
			if (testFiles.length === 0 || leaked.length > 0) {
				console.error(`drop ${id}: ${testFiles.length === 0 ? "its test changes hold no test" : `the prompt names ${leaked.join(", ")}`}`);
				continue;
			}
			if (!known) console.error(`${id}: ${ticket} is not in --tickets, so the prompt holds only the pull request's title and description`);
			const task: EvalTask = {
				id,
				repo,
				base,
				landed: pull.mergeCommit,
				landedAt: pull.mergedAt.slice(0, 10),
				prompt,
				hiddenTests,
				testIds,
				check: check.replace("{tests}", testFiles.join(" ")),
			};
			if (!values.verify) {
				picked.push(task);
				continue;
			}
			const ids = failToPass(repo, task, clone);
			console.error(`${ids.length > 0 ? "keep" : "drop"} ${id}: ${ids.length} tests fail at the base and pass at the merge commit`);
			if (ids.length > 0) picked.push({ ...task, testIds: ids, check: check.replace("{tests}", ids.map(quote).join(" ")) });
		}
	} finally {
		rmSync(join(clone, ".."), { recursive: true, force: true });
	}
	if (picked.length < Number(values.limit)) console.error(`only ${picked.length} tasks; raise --pages for older pull requests`);
	console.log(JSON.stringify(picked, null, "\t"));
}
