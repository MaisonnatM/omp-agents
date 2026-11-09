/**
 * Sessions and their spaces: the join that loads the personal extension into every session, so each learns which
 * Google account its space uses and a session that moves into the Personal space turns personal on its next turn, and
 * the `personal` message that tells the page where the personal directory is and what personal sessions remember.
 */
import { PERSONAL_FLAGS } from "../omp/personal-extension";
import { PLAIN_LAUNCH } from "../omp/rpc";
import { googleAccountsFile, personalDir, personalMemoryFile, sportFile, sportInboxDir, workspaceFor, workspacesFile } from "../paths";
import { readTail } from "../read-tail";
import { MAX_MEMORY_BYTES } from "../shared/bots";
import type { ServerMsg } from "../shared/protocol";
import type { StartRequest } from "../shared/sessions";
import { personalExtension } from "./resources";
import type { SessionJoin } from "./start";

/** A Bot's conversation: the extension with only the flags that place the session and its Google accounts in a space. */
const PLACED_LAUNCH = {
	...PLAIN_LAUNCH,
	args: ["-e", personalExtension, `--${PERSONAL_FLAGS.dir}`, personalDir, `--${PERSONAL_FLAGS.workspaces}`, workspacesFile, `--${PERSONAL_FLAGS.googleAccounts}`, googleAccountsFile],
};

/** Any other session: the personal memory and the Sport module's files too. */
const PERSONAL_LAUNCH = {
	...PLACED_LAUNCH,
	args: [...PLACED_LAUNCH.args, `--${PERSONAL_FLAGS.memory}`, personalMemoryFile, `--${PERSONAL_FLAGS.sport}`, sportFile, `--${PERSONAL_FLAGS.sportInbox}`, sportInboxDir],
};

/** How a start joins the server: with the personal extension, without the personal memory and Sport when `isBot` holds of it, as of a Bot's conversation, whose Bot keeps its own memory. */
export const personalJoin =
	(isBot: (request: StartRequest) => boolean) =>
	(request: StartRequest): SessionJoin => ({ rpc: isBot(request) ? PLACED_LAUNCH : PERSONAL_LAUNCH, attach() {} });

/** The personal directory as the page shows it, which `spaces` takes so a `~` path names it too. */
export const personalWorkspace = workspaceFor(personalDir);

export function personalMessage(): Extract<ServerMsg, { t: "personal" }> {
	return { t: "personal", ...personalWorkspace, memory: readTail(personalMemoryFile, MAX_MEMORY_BYTES)?.text ?? "" };
}
