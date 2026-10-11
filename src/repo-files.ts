/**
 * The repository page's reads: every file of the git checkout a directory is in, tracked and untracked but not ignored,
 * and one such file in full. A file read asks git whether it lists that one path, so the page opens only a file the list would show.
 */
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { git, worktreeAt } from "./git";
import { displayPath, within } from "./paths";
import { run } from "./proc";
import { type ChangedFileText, MAX_CHANGED_FILE_BYTES, tooLargeNote, wholeFileRows } from "./shared/changes";
import type { RepoFiles } from "./shared/repo-files";
import { deniedDirOf } from "./text-file";

const LS_FILES = ["ls-files", "-z", "--cached", "--others", "--exclude-standard"];

/** The files of the checkout `dir` is in; `null` outside git. */
export async function listRepoFiles(dir: string): Promise<RepoFiles | null> {
	const at = await worktreeAt(dir);
	if (!at) return null;
	const listed = await git(at.top, ...LS_FILES);
	// A file with a merge conflict is listed once per stage.
	const files = [...new Set(listed.split("\0").filter(Boolean))].sort((a, b) => a.localeCompare(b));
	return { root: at.top, rootDisplay: displayPath(at.top), branch: at.branch, files };
}

/**
 * The file at `path` in full, every line unchanged; `null` when git does not list that exact path, such as an ignored
 * file, a directory, or a path that leaves the checkout. A file whose real path, past any link, leaves the checkout or
 * lies in a directory of sign-ins and config shows a note instead, as do a file that is not one, such as a submodule,
 * and a tracked file deleted from disk.
 */
export async function readRepoFile(dir: string, path: string): Promise<ChangedFileText | null> {
	const at = await worktreeAt(dir);
	if (!at) return null;
	// git refuses a path outside the checkout, and answers each file under a directory or a path with `..` by its own name.
	const listed = await run(["git", "-C", at.top, ...LS_FILES, "--", `:(literal)${path}`]);
	if (listed.code !== 0 || !listed.stdout.split("\0").filter(Boolean).includes(path)) return null;
	const shown = (rows: ChangedFileText["rows"], note: string | null = null): ChangedFileText => ({ path, rows, note });
	const real = await realpath(join(at.top, path)).catch(() => null);
	if (real === null) return shown(null, "Deleted");
	if (!(await within(at.top, real))) return shown(null, "Links to a file outside the checkout");
	const denied = await deniedDirOf(real);
	if (denied !== null) return shown(null, `In ${denied}, which holds sign-ins and config and does not open here`);
	const info = await stat(real);
	if (!info.isFile()) return shown(null, "Not a file");
	if (info.size > MAX_CHANGED_FILE_BYTES) return shown(null, tooLargeNote(info.size));
	if (info.size === 0) return shown(null, "Empty file");
	return { path, ...wholeFileRows(await Bun.file(real).bytes()) };
}
