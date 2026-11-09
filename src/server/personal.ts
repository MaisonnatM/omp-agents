/**
 * Personal sessions, the ones in the Personal space: the join that loads the personal extension into every session but a
 * Bot's, so a session that moves into the Personal space turns personal on its next turn, and the `personal` message that
 * tells the page where the personal directory is and what personal sessions remember.
 */
import { PERSONAL_FLAGS } from "../omp/personal-extension";
import { PLAIN_LAUNCH } from "../omp/rpc";
import { absoluteDir, displayPath, personalDir, personalMemoryFile, sportFile, sportInboxDir, workspacesFile } from "../paths";
import { readTail } from "../read-tail";
import { MAX_MEMORY_BYTES } from "../shared/bots";
import type { ServerMsg } from "../shared/protocol";
import type { StartRequest } from "../shared/sessions";
import { personalExtension } from "./resources";
import type { SessionJoin } from "./start";

const PERSONAL_LAUNCH = {
	...PLAIN_LAUNCH,
	args: [
		"-e",
		personalExtension,
		`--${PERSONAL_FLAGS.dir}`,
		personalDir,
		`--${PERSONAL_FLAGS.workspaces}`,
		workspacesFile,
		`--${PERSONAL_FLAGS.memory}`,
		personalMemoryFile,
		`--${PERSONAL_FLAGS.sport}`,
		sportFile,
		`--${PERSONAL_FLAGS.sportInbox}`,
		sportInboxDir,
	],
};

/** How a start joins the server: with the personal extension unless `isBot` holds of it, as of a Bot's conversation, whose Bot keeps its own memory. */
export const personalJoin =
	(isBot: (request: StartRequest) => boolean) =>
	(request: StartRequest): SessionJoin => ({ rpc: isBot(request) ? PLAIN_LAUNCH : PERSONAL_LAUNCH, attach() {} });

/** Whether `cwd`, as omp or the page names it, `~` included, is the personal directory itself; `undefined` for a session that is gone. */
export const isPersonalDir = (cwd: string | undefined): boolean => cwd !== undefined && absoluteDir(cwd) === personalDir;

export function personalMessage(): Extract<ServerMsg, { t: "personal" }> {
	return { t: "personal", cwd: personalDir, cwdDisplay: displayPath(personalDir), memory: readTail(personalMemoryFile, MAX_MEMORY_BYTES)?.text ?? "" };
}
