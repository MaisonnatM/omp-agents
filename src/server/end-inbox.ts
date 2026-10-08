/**
 * The requests omp's `end_session` tool leaves for the server, one `<session id>.json` each in a directory: end that
 * session as **End session** does, which also removes the git worktree it works in. The tool writes its request once the
 * turn that asked is over, and deletes it when the session starts another turn or stops, so a request always names a
 * session that idles after asking. A request for a session this server does not act on stays for the server that does,
 * or for the next drain.
 */
import { isObject } from "../json";
import { type InboxEntry, JsonInboxDir } from "./json-inbox";

export interface EndRequest {
	sessionId: string;
}

export interface EndInboxEnv {
	/**
	 * Ends live session `sessionId` as **End session** does; `false`, ending nothing, while this server does not follow it,
	 * or another server is the one to end it.
	 */
	end(sessionId: string): Promise<boolean>;
}

function parseEndRequest(value: unknown): EndRequest | null {
	if (!isObject(value) || typeof value.sessionId !== "string" || !value.sessionId) return null;
	return { sessionId: value.sessionId };
}

/** The request file `name` holds, which must be named for its session. */
function parseEndFile(name: string, value: unknown): InboxEntry<EndRequest> {
	const request = parseEndRequest(value);
	if (!request) return { invalid: "it is not an end request" };
	return `${request.sessionId}.json` === name ? { item: request } : { invalid: "its name is not its session id" };
}

export class EndInbox extends JsonInboxDir<EndRequest> {
	constructor(dir: string, env: EndInboxEnv) {
		super(dir, { parse: parseEndFile, apply: request => env.end(request.sessionId) });
	}
}
