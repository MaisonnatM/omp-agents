/**
 * The requests omp's `end_session` tool leaves for the server, one `<session id>.json` each in a directory: end that
 * session as **End session** does, then, when it asked, remove the git worktree it works in. A worktree that the removal
 * checks keep stays, and Settings → Worktrees still lists it. The tool writes its request once the turn that
 * asked is over, and deletes it when the session starts another turn or stops, so a request always names a session that
 * idles after asking. A request for a session this server does not act on stays for the server that does, or for the next drain.
 */
import { errorText, isObject } from "../json";
import { displayPath } from "../paths";
import { type InboxEntry, JsonInboxDir } from "./json-inbox";

export interface EndRequest {
	sessionId: string;
	removeWorktree: boolean;
}

export interface EndInboxEnv {
	/**
	 * Live session `sessionId` that this server acts on, or `null` while it does not follow it, or another server is the one
	 * to end it. `workDir` is where it works: the linked worktree its bash calls last ran in, else its own directory.
	 */
	session(sessionId: string): { workDir: string; end(): Promise<void> } | null;
	/** Removes the worktree `dir` is in: why it stayed, or `null` once it is gone. */
	removeWorktree(dir: string): Promise<string | null>;
}

export function parseEndRequest(value: unknown): EndRequest | null {
	if (!isObject(value) || typeof value.sessionId !== "string" || !value.sessionId || typeof value.removeWorktree !== "boolean") return null;
	return { sessionId: value.sessionId, removeWorktree: value.removeWorktree };
}

/** The request file `name` holds, which must be named for its session. */
function parseEndFile(name: string, value: unknown): InboxEntry<EndRequest> {
	const request = parseEndRequest(value);
	if (!request) return { invalid: "it is not an end request" };
	return `${request.sessionId}.json` === name ? { item: request } : { invalid: "its name is not its session id" };
}

async function end(env: EndInboxEnv, request: EndRequest, session: { workDir: string; end(): Promise<void> }): Promise<void> {
	try {
		await session.end();
	} catch (err) {
		console.error(`omp-agents: could not end session ${request.sessionId}: ${errorText(err)}`);
		return;
	}
	if (!request.removeWorktree) return;
	let why: string | null;
	try {
		why = await env.removeWorktree(session.workDir);
	} catch (err) {
		why = errorText(err);
	}
	if (why) console.error(`omp-agents: kept the worktree ${displayPath(session.workDir)} that session ${request.sessionId} asked to remove: ${why}`);
}

export class EndInbox extends JsonInboxDir<EndRequest> {
	constructor(dir: string, env: EndInboxEnv) {
		super(dir, {
			parse: parseEndFile,
			async apply(request) {
				const session = env.session(request.sessionId);
				if (!session) return false;
				await end(env, request, session);
				return true;
			},
		});
	}
}
