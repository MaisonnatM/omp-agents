/** A project's agent code as trust keeps it: each piece omp would load, named and hashed so every checkout of a repository agrees. */
import { readdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { canonicalJson } from "../json";
import { discoverProjectCode, forgetReadFiles } from "../omp/discovery";
import { PROJECT_CODE_KINDS, type ProjectCode } from "../shared/project-trust";

/** The directories whose subdirectories each hold one extension, tool, or slash command package. */
const PACKAGE_PARENTS: Record<string, true> = { extensions: true, tools: true, commands: true };

const sha256 = (data: string | Uint8Array): string => new Bun.CryptoHasher("sha256").update(data).digest("hex");

/** The hash of `file`'s bytes; a file that cannot be read hashes as such, so it asks again once it can. */
const hashFile = async (file: string): Promise<string> => sha256(await readFile(file).catch(() => "unreadable"));

/** The hash of every file under `dir`, by path, leaving out installed dependencies and git's own files. */
async function hashDir(dir: string): Promise<string> {
	const lines: string[] = [];
	const walk = async (at: string): Promise<void> => {
		const entries = await readdir(at, { withFileTypes: true }).catch(() => []);
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (entry.name === "node_modules" || entry.name === ".git") continue;
			const path = join(at, entry.name);
			if (entry.isDirectory()) await walk(path);
			else lines.push(`${relative(dir, path)}\0${await hashFile(path)}`);
		}
	};
	await walk(dir);
	return sha256(lines.join("\n"));
}

/**
 * The package `file` is the entry of: the subdirectory of the nearest `extensions/`, `tools/`, or `commands/` above it
 * that holds it, or `null` when it sits directly in one or under none. Looks no higher than `stop`.
 */
function packageDirOf(file: string, stop: string | null): string | null {
	for (let child = file, dir = dirname(file); dir !== stop && dir !== dirname(dir); child = dir, dir = dirname(dir)) {
		if (PACKAGE_PARENTS[basename(dir)]) return child === file ? null : child;
	}
	return null;
}

/**
 * The agent code a session in `cwd` would load that the project put there, sorted by kind, then id. `top` is the realpath
 * of the top of `cwd`'s checkout: a file's id is its path from `top` with `/` separators, so every checkout of a
 * repository names a piece alike, and a file outside `top` keeps its absolute realpath.
 */
export async function projectCensus(cwd: string, top: string): Promise<ProjectCode[]> {
	// A branch pulled since the last start must show its code, and omp's cache keeps what it read for the process's life.
	forgetReadFiles();
	const { files, mcpServers } = await discoverProjectCode(cwd);
	const found = [
		...(await Promise.all(
			files.map(async ({ kind, path }): Promise<ProjectCode> => {
				const real = await realpath(path).catch(() => path);
				const rel = relative(top, real);
				const inside = rel !== "" && !rel.startsWith("..");
				const id = inside ? rel.split(sep).join("/") : real;
				// A package's entry runs the files beside it, so its whole package directory is what is hashed.
				const pkg = kind === "extension" || kind === "tool" || kind === "command" ? packageDirOf(real, inside ? top : null) : null;
				return { kind, id, name: id, hash: pkg ? await hashDir(pkg) : await hashFile(real) };
			}),
		)),
		...mcpServers.map(({ name, config }): ProjectCode => ({ kind: "mcp-server", id: `mcp:${name}`, name, hash: sha256(canonicalJson(config)) })),
	];
	// The kinds find disjoint files, so two pieces share an id only when a linked config directory reaches one file twice, with one kind and hash.
	const byId = new Map(found.map(code => [code.id, code]));
	return [...byId.values()].sort((a, b) => PROJECT_CODE_KINDS.indexOf(a.kind) - PROJECT_CODE_KINDS.indexOf(b.kind) || a.id.localeCompare(b.id));
}
