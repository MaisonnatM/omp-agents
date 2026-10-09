/**
 * The requests omp's `end_session` tool leaves for the server, one `<session id>.json` each in a directory: end that
 * session as **End session** does, which also removes the git worktree it works in. The tool writes its request once the
 * turn that asked is over, and deletes it when the session starts another turn or stops, so a request always names a
 * session that idles after asking. A request for a session this server does not act on stays for the server that does,
 * or for the next drain.
 * A request carries `v`, the version of its shape, now 1; an `end_session` tool installed before the field writes none,
 * which reads as 1. A request of any other version is set aside, so a newer tool's request never ends the wrong thing.
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

/** The shape of request this server reads. */
export const END_REQUEST_VERSION = 1;

/** The request file `name` holds, which must be named for its session and be of {@link END_REQUEST_VERSION}. */
function parseEndFile(name: string, value: unknown): InboxEntry<EndRequest> {
	if (!isObject(value)) return { invalid: "it is not an end request" };
	const version = value.v ?? END_REQUEST_VERSION;
	if (version !== END_REQUEST_VERSION) return { invalid: `it is an end request of version ${JSON.stringify(version)}, not ${END_REQUEST_VERSION}` };
	if (typeof value.sessionId !== "string" || !value.sessionId) return { invalid: "it is not an end request" };
	return `${value.sessionId}.json` === name ? { item: { sessionId: value.sessionId } } : { invalid: "its name is not its session id" };
}

export class EndInbox extends JsonInboxDir<EndRequest> {
	constructor(dir: string, env: EndInboxEnv) {
		super(dir, { parse: parseEndFile, apply: request => env.end(request.sessionId) });
	}
}
