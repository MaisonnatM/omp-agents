/**
 * A pull request fix sent to the session that owns the pull request, rather than to a new session: a running owner
 * gets it as a follow-up, which runs at once while it is idle and waits in its queue while a turn runs, and an ended one
 * is resumed first. See docs/decisions/2026-11-24-pull-request-fixes-go-to-the-owning-session.md.
 */
import { errorText } from "../json";
import type { LiveSession } from "../live-session";
import type { StartResult } from "../shared/sessions";

export interface OwnerEnv {
	/** The running session `sessionId`, if it runs. */
	live(sessionId: string): LiveSession | undefined;
	/** Resumes ended session `sessionId`, as **Resume** does. */
	resume(sessionId: string): Promise<StartResult>;
	/** The running session `instanceId`, once a resume listed it. */
	get(instanceId: string): LiveSession | undefined;
	/** The workspace directory `cwd` counts in. */
	workspaceOf(cwd: string): Promise<string>;
}

/**
 * Sends `text` to session `owner`, resuming it first when it ended; the session that took it, or `null` when it could
 * not, such as when it cannot resume because its directory is gone, so the caller starts a new session as asked.
 */
export async function sendToOwner(env: OwnerEnv, owner: string, text: string): Promise<StartResult | null> {
	let session = env.live(owner);
	if (!session) {
		const resumed = await env.resume(owner);
		if (!resumed.ok) {
			console.error(`omp-agents: session ${owner} does not resume, so a new session takes its pull request fix: ${resumed.error}`);
			return null;
		}
		session = env.get(resumed.instanceId);
		if (!session) return null;
	}
	try {
		// A follow-up runs at once on an idle session and waits for the running turn on a busy one, so it never interrupts.
		await session.prompt(null, text, [], "followUp");
	} catch (error) {
		console.error(`omp-agents: session ${owner} did not take its pull request fix, so a new session takes it: ${errorText(error)}`);
		return null;
	}
	return { ok: true, instanceId: session.instanceId, workspace: await env.workspaceOf(session.cwd), prompt: null };
}
