/**
 * Personal sessions, the ones that run in `personalDir`: the join that loads the personal extension into every session but
 * a Bot's, so a session that moves into the directory turns personal on its next turn, and the `personal` message that
 * tells the page where they run and what they remember.
 */
import { resolve } from "node:path";
import { PERSONAL_FLAGS } from "../omp/personal-extension";
import { PLAIN_LAUNCH } from "../omp/rpc";
import { displayPath, expandHome, HOME, personalDir, personalMemoryFile } from "../paths";
import { readTail } from "../read-tail";
import { MAX_MEMORY_BYTES } from "../shared/bots";
import type { ServerMsg } from "../shared/protocol";
import { personalExtension } from "./resources";
import type { SessionJoin } from "./start";

const PERSONAL_LAUNCH = { ...PLAIN_LAUNCH, args: ["-e", personalExtension, `--${PERSONAL_FLAGS.dir}`, personalDir, `--${PERSONAL_FLAGS.memory}`, personalMemoryFile] };

/** How a start joins the server: with the personal extension unless it is a Bot's conversation, whose Bot keeps its own memory. */
export const personalJoin = (bot: boolean): SessionJoin => ({ rpc: bot ? PLAIN_LAUNCH : PERSONAL_LAUNCH, attach() {} });

/** Whether a session in `cwd`, as omp or the page names it, `~` included, is personal; `undefined` for a session that is gone. */
export const isPersonalDir = (cwd: string | undefined): boolean => cwd !== undefined && resolve(HOME, expandHome(cwd.trim())) === personalDir;

export function personalMessage(): Extract<ServerMsg, { t: "personal" }> {
	return { t: "personal", cwd: personalDir, cwdDisplay: displayPath(personalDir), memory: readTail(personalMemoryFile, MAX_MEMORY_BYTES)?.text ?? "" };
}
