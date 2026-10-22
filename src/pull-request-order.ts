/**
 * The Code tab's reading order, after T3 Code's: source files with each file's imports before it, then tests in the
 * order of the sources they test, then generated files. Imports come from GitHub's patch, so ordering reads no blob.
 */

type Tier = "source" | "test" | "generated";

const GENERATED_NAMES = new Set(["pnpm-lock.yaml", "yarn.lock", "package-lock.json", "bun.lock", "bun.lockb", "Cargo.lock", "go.sum", "composer.lock", "Gemfile.lock"]);
const GENERATED_DIRECTORIES = new Set(["__snapshots__", "__generated__", "dist", "build", "vendor"]);
const TEST_DIRECTORIES = new Set(["__tests__", "tests", "test"]);
const MODULE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const IMPORT_SPECIFIER = /(?:\bfrom|\bimport|\brequire\s*\()\s*\(?\s*["']([^"']+)["']/g;

function tier(path: string): Tier {
	const segments = path.split("/");
	const name = segments.at(-1) ?? "";
	const directories = segments.slice(0, -1);
	if (GENERATED_NAMES.has(name) || /(?:\.snap|\.min\.js|\.min\.css)$|\.generated\./.test(name) || directories.some(segment => GENERATED_DIRECTORIES.has(segment))) return "generated";
	return /\.(?:test|spec)\./.test(name) || directories.some(segment => TEST_DIRECTORIES.has(segment)) ? "test" : "source";
}

function stripExtension(path: string): string {
	const dot = path.lastIndexOf(".");
	return dot > path.lastIndexOf("/") ? path.slice(0, dot) : path;
}

const baseName = (path: string): string => stripExtension(path.split("/").at(-1) ?? "");

const testedName = (path: string): string => (path.split("/").at(-1) ?? "").replace(/\.(?:test|spec)\..*$/, "").replace(/\.[^.]+$/, "");

function resolveRelative(path: string, specifier: string): string {
	const segments = path.split("/").slice(0, -1);
	for (const part of specifier.split("/")) {
		if (part === "." || part === "") continue;
		if (part === "..") segments.pop();
		else segments.push(part);
	}
	return segments.join("/");
}

/** The paths among `modules` and the unambiguous `names` that the patch's code lines of `path` import. */
function importedPaths(path: string, patch: string | null, modules: ReadonlyMap<string, string>, names: ReadonlyMap<string, string>): ReadonlySet<string> {
	const imported = new Set<string>();
	for (const line of (patch ?? "").split("\n")) {
		if (!/^[ +-]/.test(line) || line.startsWith("+++") || line.startsWith("---")) continue;
		for (const match of line.slice(1).matchAll(IMPORT_SPECIFIER)) {
			const specifier = match[1] ?? "";
			const resolved = specifier.startsWith(".") ? resolveRelative(path, specifier) : specifier;
			const extension = MODULE_EXTENSIONS.find(candidate => resolved.endsWith(candidate));
			const module = extension ? resolved.slice(0, -extension.length) : resolved;
			const target = modules.get(module) ?? modules.get(`${module}/index`) ?? names.get(baseName(module));
			if (target !== undefined && target !== path) imported.add(target);
		}
	}
	return imported;
}

function insertSorted(paths: string[], path: string): void {
	let low = 0;
	let high = paths.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if ((paths[middle] ?? "").localeCompare(path) < 0) low = middle + 1;
		else high = middle;
	}
	paths.splice(low, 0, path);
}

/** Kahn's order, taking the alphabetically first ready path each step; a cycle releases its alphabetically first path. */
export function orderByImports(paths: readonly string[], imports: ReadonlyMap<string, ReadonlySet<string>>): string[] {
	const sorted = paths.toSorted((a, b) => a.localeCompare(b));
	const waiting = new Map(sorted.map(path => [path, imports.get(path)?.size ?? 0]));
	const dependents = new Map<string, string[]>();
	for (const [path, dependencies] of imports) {
		for (const dependency of dependencies) {
			const list = dependents.get(dependency);
			if (list) list.push(path);
			else dependents.set(dependency, [path]);
		}
	}
	const ready = sorted.filter(path => waiting.get(path) === 0);
	const ordered: string[] = [];
	let cycle = 0;
	while (waiting.size > 0) {
		let next = ready.shift();
		if (next === undefined) {
			while (!waiting.has(sorted[cycle] ?? "")) cycle++;
			next = sorted[cycle] ?? "";
		}
		waiting.delete(next);
		ordered.push(next);
		for (const dependent of dependents.get(next) ?? []) {
			const left = waiting.get(dependent);
			if (left === undefined) continue;
			waiting.set(dependent, left - 1);
			if (left === 1) insertSorted(ready, dependent);
		}
	}
	return ordered;
}

export function orderPullRequestFiles<T extends { path: string; patch: string | null }>(files: readonly T[]): T[] {
	const byPath = new Map(files.map(file => [file.path, file]));
	const paths = { source: [] as string[], test: [] as string[], generated: [] as string[] };
	for (const path of byPath.keys()) paths[tier(path)].push(path);
	const modules = new Map<string, string>();
	const names = new Map<string, string>();
	const ambiguous = new Set<string>();
	for (const path of paths.source) {
		modules.set(stripExtension(path), path);
		const name = baseName(path);
		if (names.has(name)) ambiguous.add(name);
		names.set(name, path);
	}
	for (const name of ambiguous) names.delete(name);
	const imports = new Map(paths.source.map(path => [path, importedPaths(path, byPath.get(path)?.patch ?? null, modules, names)]));
	const sources = orderByImports(paths.source, imports);
	const positions = new Map<string, number>();
	sources.forEach((path, index) => {
		const name = baseName(path);
		if (!positions.has(name)) positions.set(name, index);
	});
	const position = (path: string): number => positions.get(testedName(path)) ?? Number.MAX_SAFE_INTEGER;
	const tests = paths.test.toSorted((a, b) => position(a) - position(b) || a.localeCompare(b));
	const generated = paths.generated.toSorted((a, b) => a.localeCompare(b));
	return [...sources, ...tests, ...generated].flatMap(path => byPath.get(path) ?? []);
}
