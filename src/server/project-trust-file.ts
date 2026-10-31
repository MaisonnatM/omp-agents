/** The project code the user trusted, saved in `project-trust.json`, and the check every dashboard start makes against it. */
import { ReducerFile } from "../fs";
import { canonical, mainCheckoutOf, worktreeAt } from "../git";
import { isObject } from "../json";
import { discoverProjectCode } from "../omp/discovery";
import { displayPath } from "../paths";
import { applyTrust, type ProjectCode, type ProjectTrust, type TrustAsk, type TrustChange, type TrustedProject, untrustedOf } from "../shared/project-trust";

const isHashes = (value: unknown): value is Record<string, string> => isObject(value) && Object.values(value).every(hash => typeof hash === "string");

export function parseProjectTrust(value: unknown): ProjectTrust | null {
	if (!isObject(value)) return null;
	const entries = Object.entries(value);
	return entries.every(([root, hashes]) => root.startsWith("/") && isHashes(hashes)) ? Object.fromEntries(entries) as ProjectTrust : null;
}

export class ProjectTrustFile extends ReducerFile<ProjectTrust, [TrustChange]> {
	constructor(path: string) {
		// Shared: every server on this computer trusts into one file, and a trust one page gives must not undo another's.
		super(path, { parse: parseProjectTrust, holds: "a list of trusted projects", empty: {}, reduce: applyTrust, shared: true });
	}

	/** The projects trusted, as Settings › Workspaces lists them. */
	projects(): TrustedProject[] {
		return Object.entries(this.value)
			.map(([root, hashes]) => ({ root, rootDisplay: displayPath(root), ids: Object.keys(hashes).sort() }))
			.sort((a, b) => a.rootDisplay.localeCompare(b.rootDisplay));
	}
}

/**
 * Where trust for `dir` is kept, `root`, and the top of its checkout, `top`, which piece ids are relative to, both resolved
 * through symlinks: a repository's linked worktrees keep trust in its main checkout; a bare repository's worktree, in
 * itself; a directory outside git, in itself.
 */
export async function projectOf(dir: string): Promise<{ root: string; top: string }> {
	const at = await worktreeAt(dir);
	if (!at) {
		const real = await canonical(dir);
		return { root: real, top: real };
	}
	const top = await canonical(at.top);
	const main = mainCheckoutOf(at);
	return { root: main ? await canonical(main) : top, top };
}

/**
 * The pieces of agent code a session in `dir` would run that `file` holds no trust for as they are now, `null` when there
 * are none. The file is read again first, for a trust another server on this computer saved.
 */
export async function untrustedCode(
	file: ProjectTrustFile,
	dir: string,
	census: (cwd: string, top: string) => Promise<ProjectCode[]> = discoverProjectCode,
): Promise<TrustAsk | null> {
	const { root, top } = await projectOf(dir);
	const code = await census(dir, top);
	if (code.length === 0) return null;
	file.reload();
	const untrusted = untrustedOf(code, file.value[root] ?? {});
	return untrusted.length === 0 ? null : { root, rootDisplay: displayPath(root), code: untrusted };
}
