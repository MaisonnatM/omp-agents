/**
 * The repository page's reads: every file of the git checkout a directory is in, tracked and untracked but not ignored,
 * and each such file in full. The page names a file by the path the list gave it, and the server reads only a path the list holds.
 */
import { realpath, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { createCache } from "./cache";
import { decode } from "./changes";
import { git } from "./git";
import { displayPath } from "./paths";
import { run } from "./proc";
import { type ChangedFileText, contextRows, MAX_CHANGED_FILE_BYTES } from "./shared/changes";
import type { RepoFiles } from "./shared/repo-files";
import { deniedDirOf, within } from "./text-file";

/** The list with its paths as a set, which the file read checks a request against. */
interface Listed {
	answer: RepoFiles;
	paths: ReadonlySet<string>;
}

/** The checkout `dir` is in and its files; `null` outside git. */
async function scan(dir: string): Promise<Listed | null> {
	const top = await run(["git", "-C", dir, "rev-parse", "--show-toplevel"]).catch(() => null);
	if (!top || top.code !== 0) return null;
	const root = top.stdout.trim();
	const [branch, listed] = await Promise.all([
		run(["git", "-C", root, "symbolic-ref", "--quiet", "--short", "HEAD"]),
		git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"),
	]);
	// A file with a merge conflict is listed once per stage.
	const paths = new Set(listed.split("\0").filter(Boolean));
	const files = [...paths].sort((a, b) => a.localeCompare(b));
	return { answer: { root, rootDisplay: displayPath(root), branch: branch.code === 0 ? branch.stdout.trim() : null, files }, paths };
}

/** The last list of each directory for a few seconds, so opening several files of one list scans the checkout once. */
const lists = createCache<Listed | null>(3_000);

/** The files of the checkout `dir` is in; `null` outside git. It always scans anew and keeps the answer for the file reads that follow it. */
export async function listRepoFiles(dir: string): Promise<RepoFiles | null> {
	return (await lists.get(dir, () => scan(dir), true))?.answer ?? null;
}

/**
 * The file of the list at `path` in full, every line unchanged; `null` when the list holds no such path. The list is the
 * one `listRepoFiles` last made, up to three seconds old. A file whose real path, past any link, leaves the checkout or
 * lies in a directory of sign-ins and config shows a note instead, as do a file that is not one, such as a submodule, and
 * a file deleted since.
 */
export async function readRepoFile(dir: string, path: string): Promise<ChangedFileText | null> {
	const listed = await lists.get(dir, () => scan(dir));
	if (!listed?.paths.has(path)) return null;
	const shown = (rows: ChangedFileText["rows"], note: string | null = null): ChangedFileText => ({ path, rows, note });
	const real = await realpath(join(listed.answer.root, path)).catch(() => null);
	if (real === null) return shown(null, "Deleted");
	if (!(await within(listed.answer.root, real))) return shown(null, "Links to a file outside the checkout");
	const denied = await deniedDirOf(real, extname(real).slice(1).toLowerCase());
	if (denied !== null) return shown(null, `In ${denied}, which holds sign-ins and config and does not open here`);
	const info = await stat(real);
	if (!info.isFile()) return shown(null, "Not a file");
	if (info.size > MAX_CHANGED_FILE_BYTES) return shown(null, `Too large to show: ${Math.round(info.size / 1024)} KB`);
	const read = decode(await Bun.file(real).bytes());
	if ("note" in read) return shown(null, read.note);
	return read.text === "" ? shown(null, "Empty file") : shown(contextRows(read.text));
}
