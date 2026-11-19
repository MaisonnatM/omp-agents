/** What the Memory page reads from its data: the repository the Project memory tab shows. */
import type { ProjectMemoryRepo } from "../../../src/shared/memory-page";

/**
 * The repository the Project memory tab shows: `wanted`, which the address names, else the one holding `cwd`, the sidebar's
 * workspace, else the first; `null` with none.
 */
export function shownRepo(repos: readonly ProjectMemoryRepo[], wanted: string | null, cwd: string | null): ProjectMemoryRepo | null {
	const named = wanted === null ? undefined : repos.find(repo => repo.root === wanted);
	if (named) return named;
	const holding = cwd === null ? undefined : repos.find(repo => cwd === repo.root || cwd.startsWith(`${repo.root}/`));
	return holding ?? repos[0] ?? null;
}
