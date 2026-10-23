/**
 * Checks an omp release against this codebase before the version pins move to it: installs the release and the tested
 * one side by side, runs `src/omp/modules.ts` and `bun test` against the release, and writes a report with the result,
 * every omp file this app loads or `docs/architecture/omp-modules.md` names that changed between the two, and the changelogs between them.
 *
 *   bun run omp-release [version]
 *
 * The tested version is the one `.github/workflows/checks.yml` installs; the release defaults to npm's latest.
 * The report goes to `node_modules/.cache/`, which git ignores; `.agents/skills/omp-release/SKILL.md` says how to read it.
 * A failing test or a missing export is a finding, so the script exits non-zero only when it cannot produce the report.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { $ } from "bun";

const ROOT = join(import.meta.dir, "..");
const PACKAGE = "@oh-my-pi/pi-coding-agent";
const VERSION = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
/** A path inside an omp install, such as `pi-coding-agent/src/collab/registry.ts`, as `docs/architecture/omp-modules.md` writes it. */
const OMP_PATH = /^(?:pi|omp)-[a-z-]+\/src\//;

type Source = "modules.ts" | "omp-modules.md";
type FileState = "changed" | "unchanged" | `missing in ${string}`;
interface Run {
	exitCode: number;
	output: string;
}

const tested = readFileSync(join(ROOT, ".github", "workflows", "checks.yml"), "utf8").match(/pi-coding-agent@(\S+)/)?.[1] ?? "";
if (!VERSION.test(tested)) throw new Error(".github/workflows/checks.yml installs no pi-coding-agent@<version>");
const target = process.argv[2] ?? (await $`npm view ${PACKAGE} version`.text()).trim();
if (!VERSION.test(target)) throw new Error(`${target} is not an omp version`);
if (Bun.semver.order(target, tested) <= 0) {
	console.log(`omp ${tested} is the newest release; nothing to check`);
	process.exit(0);
}

async function run(command: $.ShellPromise): Promise<Run> {
	const { exitCode, stdout } = await command.nothrow().quiet();
	return { exitCode, output: stdout.toString() };
}

/** Installs `version` under `parent/<version>` and returns its `@oh-my-pi` directory, where its packages sit side by side as in a global install. */
async function install(parent: string, version: string): Promise<string> {
	const dir = join(parent, version);
	mkdirSync(dir);
	writeFileSync(join(dir, "package.json"), "{}");
	const { exitCode, output } = await run($`bun add --linker hoisted ${PACKAGE}@${version} 2>&1`.cwd(dir));
	if (exitCode !== 0) throw new Error(`cannot install ${PACKAGE}@${version}:\n${output}`);
	return join(dir, "node_modules", "@oh-my-pi");
}

/** The omp files `src/omp/modules.ts` loads, read from each `load(join(<base>, ...))` it makes. */
function loadedFiles(): string[] {
	const source = readFileSync(join(ROOT, "src", "omp", "modules.ts"), "utf8");
	const bases: Record<string, string> = { srcDir: "pi-coding-agent/src", utilsSrc: "pi-utils/src", statsSrc: "omp-stats/src", "dirname(packageDir)": "" };
	const files = [...source.matchAll(/join\((srcDir|utilsSrc|statsSrc|dirname\(packageDir\)),((?:\s*"[^"]+",?)+)\s*\)/g)]
		.map(([, base, parts]) => [bases[base!], ...[...parts!.matchAll(/"([^"]+)"/g)].map(([, part]) => part)].filter(Boolean).join("/"))
		.filter(file => file.endsWith(".ts"));
	const loads = source.match(/await load</g)?.length ?? 0;
	if (files.length !== loads) throw new Error(`src/omp/modules.ts makes ${loads} loads but ${files.length} read as join(<base>, "...") paths; update loadedFiles()`);
	return files;
}

/**
 * The omp files `docs/architecture/omp-modules.md` names.
 * A name without a package, such as `protocol.ts` or `task/executor.ts`, is a file already named, else one beside an
 * earlier full path in the same bullet or under that path's `src/`; a name that resolves to none of them is returned as unresolved.
 */
function documentedFiles(scopes: string[]): { files: string[]; unresolved: string[] } {
	const section = readFileSync(join(ROOT, "docs", "architecture", "omp-modules.md"), "utf8");
	const files: string[] = [];
	const unresolved: string[] = [];
	for (const bullet of section.split(/\n(?=\S)/)) {
		const named: string[] = [];
		for (const [, name] of bullet.matchAll(/`([^`\s]+\.tsx?)`/g)) {
			if (OMP_PATH.test(name!)) {
				named.unshift(name!);
				files.push(name!);
				continue;
			}
			if (existsSync(join(ROOT, name!))) continue;
			const found =
				files.find(file => file.endsWith(`/${name}`)) ??
				named.flatMap(path => [join(dirname(path), name!), `${path.slice(0, path.indexOf("/src/"))}/src/${name}`]).find(path => scopes.some(scope => existsSync(join(scope, path))));
			if (found) files.push(found);
			else unresolved.push(name!);
		}
	}
	return { files: [...new Set(files)], unresolved: [...new Set(unresolved)] };
}

/** The `## [x.y.z]` sections of a changelog with `tested < x.y.z <= target`, headings moved down two levels to nest under the package's. */
function releaseNotes(changelog: string): string[] {
	return changelog
		.split(/^(?=## )/m)
		.filter(part => {
			const version = part.match(/^## \[([^\]]+)\]/)?.[1];
			return version !== undefined && VERSION.test(version) && Bun.semver.order(version, tested) > 0 && Bun.semver.order(version, target) <= 0;
		})
		.map(part => part.trimEnd().replace(/^(#+) /gm, "$1## "));
}

const loaded = loadedFiles();
const parent = mkdtempSync(join(tmpdir(), "omp-release-"));
try {
	console.log(`installing omp ${target} and ${tested}`);
	const targetScope = await install(parent, target);
	const testedScope = await install(parent, tested);
	const env = { ...process.env, OMP_PACKAGE_DIR: join(targetScope, "pi-coding-agent") };

	console.log(`loading src/omp/modules.ts and running bun test against omp ${target}`);
	const moduleCheck = await run($`bun src/omp/modules.ts 2>&1`.cwd(ROOT).env(env));
	const tests = await run($`bun test 2>&1`.cwd(ROOT).env(env));
	const testCounts = tests.output.split("\n").filter(line => /^\s*\d+ (?:pass|fail|skip|todo)$|^Ran \d+ tests?/.test(line)).map(line => line.trim());

	const documented = documentedFiles([testedScope, targetScope]);
	const sources = new Map<string, Set<Source>>();
	for (const [source, files] of [["modules.ts", loaded], ["omp-modules.md", documented.files]] as const) {
		for (const file of files) sources.set(file, (sources.get(file) ?? new Set<Source>()).add(source));
	}
	const states = [...sources.keys()].sort().map(file => {
		const before = join(testedScope, file);
		const after = join(targetScope, file);
		const state: FileState = !existsSync(after) ? `missing in ${target}` : !existsSync(before) ? `missing in ${tested}` : readFileSync(before).equals(readFileSync(after)) ? "unchanged" : "changed";
		return { file, state, from: [...sources.get(file)!].join(", ") };
	});
	const changed = states.filter(({ state }) => state === "changed");
	const diffs = await Promise.all(
		changed.map(async ({ file }) => {
			const { output } = await run($`git diff --no-index --no-ext-diff --no-color -- ${join(tested, "node_modules", "@oh-my-pi", file)} ${join(target, "node_modules", "@oh-my-pi", file)}`.cwd(parent));
			return { file, diff: output.replaceAll(`/${tested}/node_modules/@oh-my-pi/`, "/").replaceAll(`/${target}/node_modules/@oh-my-pi/`, "/").trimEnd() };
		}),
	);

	const changelogs = readdirSync(targetScope)
		.filter(pkg => existsSync(join(targetScope, pkg, "CHANGELOG.md")))
		.sort()
		.map(pkg => ({ pkg, notes: releaseNotes(readFileSync(join(targetScope, pkg, "CHANGELOG.md"), "utf8")) }))
		.filter(({ notes }) => notes.length > 0);

	const fence = (lang: string, text: string) => `\`\`\`${lang}\n${text}\n\`\`\``;
	const report = [
		`# omp ${target} against omp-agents`,
		"",
		`Tested version: ${tested}, from \`.github/workflows/checks.yml\`.`,
		`Release checked: ${target}.`,
		"",
		"## Tests",
		"",
		`\`bun test\` with \`OMP_PACKAGE_DIR\` on omp ${target} ${tests.exitCode === 0 ? "passed" : `failed with exit code ${tests.exitCode}`}.`,
		"",
		fence("text", testCounts.join("\n")),
		...(tests.exitCode === 0 ? [] : ["", "The last 80 lines of its output:", "", fence("text", tests.output.trimEnd().split("\n").slice(-80).join("\n"))]),
		"",
		"## Module check",
		"",
		moduleCheck.exitCode === 0 ? `\`bun src/omp/modules.ts\` loads every export this app uses from omp ${target}.` : `\`bun src/omp/modules.ts\` failed against omp ${target}:\n\n${fence("text", moduleCheck.output.trimEnd())}`,
		"",
		"## omp files",
		"",
		`Each omp file \`src/omp/modules.ts\` loads or \`docs/architecture/omp-modules.md\` names, compared between ${tested} and ${target}.`,
		"",
		...states.map(({ file, state, from }) => `- ${state}: \`${file}\` (${from})`),
		...(documented.unresolved.length ? ["", `Names in \`docs/architecture/omp-modules.md\` that resolved to no omp file: ${documented.unresolved.map(name => `\`${name}\``).join(", ")}.`] : []),
		"",
		"## Changelogs",
		"",
		`The sections after ${tested} up to ${target} in each \`@oh-my-pi\` package's CHANGELOG.md.`,
		...changelogs.flatMap(({ pkg, notes }) => ["", `### @oh-my-pi/${pkg}`, "", notes.join("\n\n")]),
		"",
		"## Source diffs",
		"",
		`Each changed file, from ${tested} (\`a/\`) to ${target} (\`b/\`); a hunk's \`+\` line numbers are ${target}'s.`,
		...diffs.flatMap(({ file, diff }) => ["", `### ${file}`, "", fence("diff", diff)]),
		"",
	].join("\n");

	const reportPath = join(ROOT, "node_modules", ".cache", `omp-release-${target}.md`);
	mkdirSync(dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, report);
	console.log(reportPath);
	console.log(`tests: ${tests.exitCode === 0 ? "pass" : "FAIL"} (${testCounts.join(", ")}); module check: ${moduleCheck.exitCode === 0 ? "pass" : "FAIL"}`);
	console.log(`omp files: ${changed.length} changed, ${states.filter(({ state }) => state.startsWith("missing")).length} missing, ${states.length} checked`);
	console.log(`changelogs: ${changelogs.reduce((sum, { notes }) => sum + notes.length, 0)} release sections across ${changelogs.length} packages`);
} finally {
	rmSync(parent, { recursive: true, force: true });
}
