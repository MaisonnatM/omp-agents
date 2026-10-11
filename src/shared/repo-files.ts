/** Every file of a git checkout, for the repository page. A file is read as the changes view reads one, `ChangedFileText` in `changes.ts`. */

/** `GET /api/repo?cwd=<dir>`: the files of the git checkout `cwd` is in, tracked and untracked but not ignored, by path. */
export interface RepoFiles {
	root: string;
	/** `root` with the home directory shortened to `~`. */
	rootDisplay: string;
	branch: string | null;
	files: string[];
}
