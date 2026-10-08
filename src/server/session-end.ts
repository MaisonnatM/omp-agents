/**
 * Ending a session, from **End session** in the page or from omp's `end_session` tool: stop it, then remove the linked
 * git worktree it worked in, with the checks of Settings → Worktrees, and keep its branch. A main checkout or a directory
 * outside git stays as it is; a worktree those checks keep, such as a dirty one, stays listed there, and the server logs why.
 */
import { errorText } from "../json";
import { displayPath } from "../paths";
import type { WorktreeRemovalResult } from "../worktrees-shared";

export interface EndingSession {
	sessionId: string;
	/** Where it works: the linked worktree its bash calls last ran in, else its own directory. */
	workDir: string;
	end(): Promise<void>;
}

/** Removes the linked worktree `dir` is in; `null` when it is in none. */
export type RemoveCheckout = (dir: string) => Promise<WorktreeRemovalResult | null>;

export async function endSession(session: EndingSession, removeCheckout: RemoveCheckout): Promise<void> {
	try {
		await session.end();
	} catch (err) {
		console.error(`omp-agents: could not end session ${session.sessionId}: ${errorText(err)}`);
		return;
	}
	let why: string | null;
	try {
		const result = await removeCheckout(session.workDir);
		why = !result || result.removed ? null : (result.error ?? result.blockers.map(blocker => blocker.message).join(" "));
	} catch (err) {
		why = errorText(err);
	}
	if (why) console.error(`omp-agents: kept the worktree ${displayPath(session.workDir)} of ended session ${session.sessionId}: ${why}`);
}
