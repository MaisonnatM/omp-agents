/** omp's task-isolation sandboxes: where they live, which omp process owns each, and the teardown a retained native mount needs. */
import type { IsolationSweepDeps } from "../server/isolation-sweep";
import { dirs, isolationOwnership, worktreeCli } from "./modules";

/** The parts of {@link IsolationSweepDeps} that omp decides, read as omp's `omp worktree clear` reads them. */
export function ompSandboxes(): Pick<IsolationSweepDeps, "root" | "ownerFile" | "ownerLive" | "stopMount"> {
	return {
		root: dirs.getWorktreesDir(),
		ownerFile: isolationOwnership.ISOLATION_OWNER_FILE,
		ownerLive: dir => isolationOwnership.hasLiveIsolationOwner(dir),
		stopMount: async dir => {
			await worktreeCli.stopRetainedMount(dir);
		},
	};
}
