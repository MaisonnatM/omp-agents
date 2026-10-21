/** **Run locally**: a branch checked out where you test it, with the repository's services started in terminal tabs. */
import type { BranchRelease } from "./git";
import type { TerminalInfo } from "./terminals";

/** What **Run locally** runs in a repository, kept in its git config: the install command and one long-running command per service. */
export interface RunProfile {
	/** Runs before the services when a lockfile changed or `node_modules` is missing; empty for none. */
	install: string;
	/** One terminal tab each, such as `npm run dev`. */
	services: string[];
}

/** The most services one run starts, each in a terminal tab. */
export const MAX_RUN_SERVICES = 8;

/** The body of `PUT /api/run-locally`. */
export interface RunRequest {
	/** A directory in the repository. */
	cwd: string;
	branch: string;
	profile: RunProfile;
}

/** What `PUT /api/run-locally` did. */
export interface RunOutcome {
	/** Where the services run: the main checkout, or the linked worktree that kept the branch. */
	dir: string;
	/** What happened to the linked worktree that had the branch checked out. */
	release: BranchRelease;
	/** Whether the install command ran. */
	installed: boolean;
	/** The terminals of the services this run started. */
	terminals: TerminalInfo[];
	/** How many terminals of the repository's previous run it stopped. */
	stopped: number;
}
